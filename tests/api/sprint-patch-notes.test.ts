import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";

// Mock PARTIEL : seul getSession est simulé. Le module exporte aussi hashToken
// et createSession, dont dépendent des chemins réels (ex. les jetons de
// connexion par email) — un mock total les remplacerait par undefined.
vi.mock("@/lib/session", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/session")>()),
  getSession: vi.fn(),
}));

import { getSession } from "@/lib/session";
import { PATCH } from "@/app/api/sprints/[id]/route";
import { prisma } from "@/lib/prisma";
import { seedUserWithWorkspace } from "../helpers/seed";
import { releaseNotesBlockId } from "@/lib/db";

const mockGetSession = vi.mocked(getSession);

let userId: string;
let workspaceId: string;

function asMe() {
  mockGetSession.mockResolvedValue({ id: userId, email: "u", displayName: "U", currentWorkspaceId: workspaceId , isService: false});
}

const req = (body: unknown) =>
  new Request("http://localhost/api/sprints/x", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
const params = (id: string) => ({ params: Promise.resolve({ id }) });

const preBlock = {
  id: "pre-1",
  type: "paragraph",
  props: {},
  content: [{ type: "text", text: "Contenu préexistant", styles: {} }],
  children: [],
};

/** Crée une database + (optionnellement) une page « Patch notes » mappée. */
async function mkDatabase(opts: { patch?: boolean; patchContent?: string } = {}) {
  const dbPage = await prisma.page.create({
    data: { title: "db", workspaceId, ownerId: userId, visibility: "team", position: 1000 },
  });
  let patchPageId: string | null = null;
  if (opts.patch) {
    const patchPage = await prisma.page.create({
      data: {
        title: "📓 Patch notes",
        content: opts.patchContent ?? JSON.stringify([preBlock]),
        workspaceId,
        ownerId: userId,
        visibility: "team",
        position: 2000,
      },
    });
    patchPageId = patchPage.id;
  }
  const db = await prisma.database.create({
    data: { pageId: dbPage.id, ...(patchPageId && { patchNotesPageId: patchPageId }) },
  });
  return { db, patchPageId };
}

async function mkRecord(dbId: string, sprintId: string, title: string, props: Record<string, string>, pos: number) {
  return prisma.record.create({
    data: { databaseId: dbId, sprintId, title, properties: JSON.stringify(props), position: pos },
  });
}

async function pageContent(pageId: string): Promise<string> {
  const p = await prisma.page.findUniqueOrThrow({ where: { id: pageId }, select: { content: true } });
  return p.content;
}

beforeAll(async () => {
  const s = await seedUserWithWorkspace(`sprintpn-${Date.now()}@x.tld`);
  userId = s.user.id;
  workspaceId = s.workspace.id;
  asMe();
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe("PATCH /api/sprints/[id] — auto-append des notes de version (page Patch notes)", () => {
  it("AC1 : la clôture appende un bloc daté EN FIN de la page, sans écraser l'existant", async () => {
    asMe();
    const { db, patchPageId } = await mkDatabase({ patch: true });
    const sprint = await prisma.sprint.create({
      data: { databaseId: db.id, name: "Sprint Alpha", state: "active", position: 1000 },
    });
    await mkRecord(db.id, sprint.id, "Feature X", {}, 1000);
    await mkRecord(db.id, sprint.id, "Bug Y", {}, 2000);

    const res = await PATCH(req({ state: "completed" }), params(sprint.id));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.state).toBe("completed");
    expect(body.patchNotesAppend).toBe("appended");

    const content = await pageContent(patchPageId!);
    const blocks = JSON.parse(content) as Array<{ id: string }>;
    const marker = releaseNotesBlockId(sprint.id);
    const preIdx = blocks.findIndex((b) => b.id === "pre-1");
    const markerIdx = blocks.findIndex((b) => b.id === marker);
    expect(preIdx).toBe(0); // préexistant intact, toujours en tête
    expect(markerIdx).toBeGreaterThan(preIdx); // nouveau bloc APRÈS l'existant
    expect(content).toContain("Sprint Alpha");
    expect(content).toContain("Feature X");
    expect(content).toContain("Bug Y");
  });

  it("AC2 : mismatch livrées vs done → rollback (422, page inchangée, sprint non terminé)", async () => {
    asMe();
    const { db, patchPageId } = await mkDatabase({ patch: true });
    const before = await pageContent(patchPageId!);
    const sprint = await prisma.sprint.create({
      data: { databaseId: db.id, name: "Sprint Beta", state: "active", position: 1000 },
    });
    await mkRecord(db.id, sprint.id, "Done 1", { status: "done" }, 1000);
    await mkRecord(db.id, sprint.id, "Done 2", { status: "done" }, 2000);
    // Une issue non terminée reste rattachée (pas de moveIncompleteToBacklog).
    await mkRecord(db.id, sprint.id, "Todo 3", { status: "todo" }, 3000);

    const res = await PATCH(
      req({ state: "completed", statusPropertyId: "status", doneStatusOptionId: "done" }),
      params(sprint.id)
    );
    expect(res.status).toBe(422);
    const body = await res.json();
    expect(body.error).toBeTruthy();

    // Rollback : sprint toujours actif, notes non écrites, page inchangée.
    const after = await prisma.sprint.findUniqueOrThrow({ where: { id: sprint.id } });
    expect(after.state).toBe("active");
    expect(after.releaseNotes).toBeNull();
    expect(await pageContent(patchPageId!)).toBe(before);
  });

  it("AC3 : issues reportées comptées à part, absentes des livrées", async () => {
    asMe();
    const { db, patchPageId } = await mkDatabase({ patch: true });
    const sprint = await prisma.sprint.create({
      data: { databaseId: db.id, name: "Sprint Gamma", state: "active", position: 1000 },
    });
    await mkRecord(db.id, sprint.id, "Livrée A", { status: "done" }, 1000);
    await mkRecord(db.id, sprint.id, "Livrée B", { status: "done" }, 2000);
    const reported = await mkRecord(db.id, sprint.id, "Reportée Z", { status: "todo" }, 3000);

    const res = await PATCH(
      req({
        state: "completed",
        moveIncompleteToBacklog: true,
        statusPropertyId: "status",
        doneStatusOptionId: "done",
      }),
      params(sprint.id)
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.patchNotesAppend).toBe("appended");

    const content = await pageContent(patchPageId!);
    expect(content).toContain("Livrée A");
    expect(content).toContain("Livrée B");
    expect(content).toContain("1 issue reportée"); // compteur distinct
    expect(content).not.toContain("Reportée Z"); // pas listée comme livrée

    // L'issue reportée est bien retournée au backlog.
    const z = await prisma.record.findUniqueOrThrow({ where: { id: reported.id } });
    expect(z.sprintId).toBeNull();
  });

  it("AC4 : double clôture (dont record tardif) → un seul bloc, contenu identique", async () => {
    asMe();
    const { db, patchPageId } = await mkDatabase({ patch: true });
    const sprint = await prisma.sprint.create({
      data: { databaseId: db.id, name: "Sprint Delta", state: "active", position: 1000 },
    });
    await mkRecord(db.id, sprint.id, "Issue 1", {}, 1000);

    const first = await PATCH(req({ state: "completed" }), params(sprint.id));
    expect(first.status).toBe(200);
    const contentAfterFirst = await pageContent(patchPageId!);

    // Record ajouté APRÈS la 1re clôture puis re-clôture (retry / double appel).
    await mkRecord(db.id, sprint.id, "Issue tardive", {}, 2000);
    const second = await PATCH(req({ state: "completed" }), params(sprint.id));
    expect(second.status).toBe(200);
    const secondBody = await second.json();
    expect(secondBody.patchNotesAppend).toBe("already");

    const contentAfterSecond = await pageContent(patchPageId!);
    expect(contentAfterSecond).toBe(contentAfterFirst); // strictement identique
    expect(contentAfterSecond).not.toContain("Issue tardive");

    const marker = releaseNotesBlockId(sprint.id);
    const blocks = JSON.parse(contentAfterSecond) as Array<{ id: string }>;
    expect(blocks.filter((b) => b.id === marker)).toHaveLength(1); // un seul bloc titre
  });

  it("AC5 : un titre livré vide rend « Sans titre » dans la page (pas de puce vide)", async () => {
    asMe();
    const { db, patchPageId } = await mkDatabase({ patch: true });
    const sprint = await prisma.sprint.create({
      data: { databaseId: db.id, name: "Sprint Epsilon", state: "active", position: 1000 },
    });
    // title vide au niveau colonne SQL.
    await prisma.record.create({
      data: { databaseId: db.id, sprintId: sprint.id, title: "", properties: "{}", position: 1000 },
    });

    const res = await PATCH(req({ state: "completed" }), params(sprint.id));
    expect(res.status).toBe(200);
    const content = await pageContent(patchPageId!);
    expect(content).toContain("Sans titre");
  });

  it("AC6 : database non mappée → clôture OK + flag « no_page », aucune page modifiée", async () => {
    asMe();
    const { db } = await mkDatabase({ patch: false });
    // Page témoin du workspace : doit rester intacte.
    const witness = await prisma.page.create({
      data: { title: "Témoin", content: JSON.stringify([preBlock]), workspaceId, ownerId: userId, visibility: "team", position: 3000 },
    });
    const sprint = await prisma.sprint.create({
      data: { databaseId: db.id, name: "Sprint Zeta", state: "active", position: 1000 },
    });
    await mkRecord(db.id, sprint.id, "Feature W", {}, 1000);

    const res = await PATCH(req({ state: "completed" }), params(sprint.id));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.state).toBe("completed");
    expect(body.releaseNotes).toBeTruthy(); // notes tout de même générées
    expect(body.patchNotesAppend).toBe("no_page");

    expect(await pageContent(witness.id)).toBe(JSON.stringify([preBlock])); // intacte
  });

  it("Cas limite : page cible au content illisible → rollback (422, page non écrasée)", async () => {
    asMe();
    const corrupt = "not-a-json-array";
    const { db, patchPageId } = await mkDatabase({ patch: true, patchContent: corrupt });
    const sprint = await prisma.sprint.create({
      data: { databaseId: db.id, name: "Sprint Eta", state: "active", position: 1000 },
    });
    await mkRecord(db.id, sprint.id, "Feature V", {}, 1000);

    const res = await PATCH(req({ state: "completed" }), params(sprint.id));
    expect(res.status).toBe(422);

    // Rollback intégral : page inchangée, sprint non terminé, notes non écrites.
    expect(await pageContent(patchPageId!)).toBe(corrupt);
    const after = await prisma.sprint.findUniqueOrThrow({ where: { id: sprint.id } });
    expect(after.state).toBe("active");
    expect(after.releaseNotes).toBeNull();
  });
});
