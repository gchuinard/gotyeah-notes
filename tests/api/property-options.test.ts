import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";

// Mock PARTIEL : seul getSession est simulé. Le module exporte aussi hashToken
// et createSession, dont dépendent des chemins réels (ex. les jetons de
// connexion par email) — un mock total les remplacerait par undefined.
vi.mock("@/lib/session", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/session")>()),
  getSession: vi.fn(),
}));

import { getSession } from "@/lib/session";
import { PATCH } from "@/app/api/properties/[id]/route";
import { POST } from "@/app/api/databases/[id]/properties/route";
import { prisma } from "@/lib/prisma";
import { seedUserWithWorkspace } from "../helpers/seed";

const mockGetSession = vi.mocked(getSession);

let userId: string;
let workspaceId: string;

function asMe() {
  mockGetSession.mockResolvedValue({ id: userId, email: "u", displayName: "U", currentWorkspaceId: workspaceId , isService: false});
}

const patchReq = (body: unknown) =>
  new Request("http://localhost/api/properties/x", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
const postReq = (body: unknown) =>
  new Request("http://localhost/api/databases/x/properties", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
const withId = (id: string) => ({ params: Promise.resolve({ id }) });

async function mkDatabase(ws = workspaceId, owner = userId) {
  const page = await prisma.page.create({
    data: { title: "db", workspaceId: ws, ownerId: owner, visibility: "team", position: 1000 },
  });
  return prisma.database.create({ data: { pageId: page.id } });
}

async function mkSelectProp(databaseId: string, options: { id: string; name: string; color: string }[]) {
  return prisma.databaseProperty.create({
    data: {
      databaseId,
      name: "Statut",
      type: "select",
      position: 1000,
      config: JSON.stringify({ type: "select", options }),
    },
  });
}

const O1 = { id: "o1", name: "À faire", color: "blue" };
const O2 = { id: "o2", name: "Fait", color: "green" };

beforeAll(async () => {
  const seeded = await seedUserWithWorkspace(`propopt-${Date.now()}@x.tld`);
  userId = seeded.user.id;
  workspaceId = seeded.workspace.id;
  asMe();
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe("PATCH /api/properties/[id] — options de select", () => {
  it("AC1 : rename + recolor en conservant les ids → 200, records intacts", async () => {
    asMe();
    const db = await mkDatabase();
    const prop = await mkSelectProp(db.id, [O1, O2]);
    const record = await prisma.record.create({
      data: { databaseId: db.id, title: "r", position: 1000, properties: JSON.stringify({ [prop.id]: "o1" }) },
    });

    const res = await PATCH(
      patchReq({ config: { type: "select", options: [{ id: "o1", name: "En cours", color: "orange" }, O2] } }),
      withId(prop.id)
    );
    expect(res.status).toBe(200);
    const updated = await res.json();
    expect(updated.config.options[0]).toEqual({ id: "o1", name: "En cours", color: "orange" });
    expect(updated.config.options[1]).toEqual(O2);

    // Le record référence toujours o1 (id stable).
    const after = await prisma.record.findUniqueOrThrow({ where: { id: record.id } });
    expect(JSON.parse(after.properties)[prop.id]).toBe("o1");
  });

  it("AC2 : option sans id / id vide / name vide → 400", async () => {
    asMe();
    const db = await mkDatabase();
    const prop = await mkSelectProp(db.id, [O1]);

    for (const options of [
      [{ name: "x", color: "blue" }],
      [{ id: "", name: "x", color: "blue" }],
      [{ id: "o1", name: "", color: "blue" }],
    ]) {
      const res = await PATCH(patchReq({ config: { type: "select", options } }), withId(prop.id));
      expect(res.status).toBe(400);
    }
    // Rien n'a été écrit.
    const row = await prisma.databaseProperty.findUniqueOrThrow({ where: { id: prop.id } });
    expect(JSON.parse(row.config).options).toEqual([O1]);
  });

  it("AC3 : couleur hors palette → 400 (plus de repli gris silencieux)", async () => {
    asMe();
    const db = await mkDatabase();
    const prop = await mkSelectProp(db.id, [O1]);
    const res = await PATCH(
      patchReq({ config: { type: "select", options: [{ id: "o1", name: "X", color: "chartreuse" }] } }),
      withId(prop.id)
    );
    expect(res.status).toBe(400);
  });

  it("AC5 : retirer une option référencée par un record → 400 ; non référencée → 200", async () => {
    asMe();
    const db = await mkDatabase();
    const prop = await mkSelectProp(db.id, [O1, O2]);
    await prisma.record.create({
      data: { databaseId: db.id, title: "r", position: 1000, properties: JSON.stringify({ [prop.id]: "o1" }) },
    });

    // o1 référencée → refus.
    const refused = await PATCH(patchReq({ config: { type: "select", options: [O2] } }), withId(prop.id));
    expect(refused.status).toBe(400);
    expect((await refused.json()).error).toMatch(/référencée/i);

    // o2 non référencée → autorisé (l'UI doit pouvoir supprimer une option inutilisée).
    const ok = await PATCH(patchReq({ config: { type: "select", options: [O1] } }), withId(prop.id));
    expect(ok.status).toBe(200);
    expect((await ok.json()).config.options).toEqual([O1]);
  });

  it("AC5 : retirer une option référencée par View.config.doneStatusOptionId → 400", async () => {
    asMe();
    const db = await mkDatabase();
    const prop = await mkSelectProp(db.id, [O1, O2]);
    await prisma.view.create({
      data: {
        databaseId: db.id,
        name: "Backlog",
        type: "backlog",
        position: 1000,
        config: JSON.stringify({ statusPropertyId: prop.id, doneStatusOptionId: "o2" }),
      },
    });

    const res = await PATCH(patchReq({ config: { type: "select", options: [O1] } }), withId(prop.id));
    expect(res.status).toBe(400);
    expect((await res.json()).details.optionIds).toEqual(["o2"]);
  });

  it("AC5 : retirer une option référencée par un FILTRE de vue → 400 (aucun record ne l'utilise)", async () => {
    asMe();
    const db = await mkDatabase();
    const prop = await mkSelectProp(db.id, [O1, O2]);
    await prisma.view.create({
      data: {
        databaseId: db.id,
        name: "Tout",
        type: "table",
        position: 1000,
        config: JSON.stringify({ filters: [{ propertyId: prop.id, operator: "eq", value: "o1" }] }),
      },
    });

    const res = await PATCH(patchReq({ config: { type: "select", options: [O2] } }), withId(prop.id));
    expect(res.status).toBe(400);
    expect((await res.json()).details.optionIds).toEqual(["o1"]);
  });

  it("AC7 : champ type → 400 ; config.type != type → 400 (non-régression)", async () => {
    asMe();
    const db = await mkDatabase();
    const prop = await mkSelectProp(db.id, [O1]);
    expect((await PATCH(patchReq({ type: "text" }), withId(prop.id))).status).toBe(400);
    expect(
      (await PATCH(patchReq({ config: { type: "text" } }), withId(prop.id))).status
    ).toBe(400);
  });

  it("AC6 : propriété d'un autre workspace → 404 (anti-leak)", async () => {
    const stranger = await seedUserWithWorkspace(`propopt-str-${Date.now()}@x.tld`);
    const otherDb = await mkDatabase(stranger.workspace.id, stranger.user.id);
    const otherProp = await mkSelectProp(otherDb.id, [O1]);
    asMe();
    const res = await PATCH(patchReq({ config: { type: "select", options: [O1] } }), withId(otherProp.id));
    expect(res.status).toBe(404);
  });
});

describe("POST /api/databases/[id]/properties — création de select", () => {
  it("AC4 : options valides → 201, ids préservés", async () => {
    asMe();
    const db = await mkDatabase();
    const res = await POST(
      postReq({ name: "Statut", type: "select", config: { type: "select", options: [O1, O2] } }),
      withId(db.id)
    );
    expect(res.status).toBe(201);
    const created = await res.json();
    expect(created.config.options).toEqual([O1, O2]);
  });

  it("option invalide à la création → 400", async () => {
    asMe();
    const db = await mkDatabase();
    const res = await POST(
      postReq({ name: "Statut", type: "select", config: { type: "select", options: [{ id: "o1", name: "X", color: "fuchsia" }] } }),
      withId(db.id)
    );
    expect(res.status).toBe(400);
  });

  it("sans config (cas AddPropertyModal) → 201 avec defaultConfig", async () => {
    asMe();
    const db = await mkDatabase();
    const res = await POST(postReq({ name: "Statut", type: "select" }), withId(db.id));
    expect(res.status).toBe(201);
    expect((await res.json()).config).toEqual({ type: "select", options: [] });
  });

  it("AC6 : database d'un autre workspace → 404", async () => {
    const stranger = await seedUserWithWorkspace(`propopt-str2-${Date.now()}@x.tld`);
    const otherDb = await mkDatabase(stranger.workspace.id, stranger.user.id);
    asMe();
    const res = await POST(postReq({ name: "X", type: "select" }), withId(otherDb.id));
    expect(res.status).toBe(404);
  });
});
