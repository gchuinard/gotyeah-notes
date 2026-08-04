import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";

vi.mock("@/lib/session", () => ({ getSession: vi.fn() }));

import { getSession } from "@/lib/session";
import { PATCH, DELETE } from "@/app/api/records/[id]/route";
import { GET } from "@/app/api/records/[id]/revisions/route";
import { prisma } from "@/lib/prisma";
import { seedUserWithWorkspace } from "../helpers/seed";

const mockGetSession = vi.mocked(getSession);

let userId: string;
let workspaceId: string;

function asUser(id: string) {
  mockGetSession.mockResolvedValue({ id, email: "u", displayName: "U", currentWorkspaceId: workspaceId , isService: false});
}
const asMe = () => asUser(userId);

const patchReq = (id: string, body: unknown) =>
  new Request(`http://localhost/api/records/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
const params = (id: string) => ({ params: Promise.resolve({ id }) });

async function mkDatabase(ownerId = userId, wsId = workspaceId) {
  const page = await prisma.page.create({
    data: { title: "db", workspaceId: wsId, ownerId, visibility: "team", position: 1000 },
  });
  return prisma.database.create({ data: { pageId: page.id } });
}

async function mkRecord(dbId: string, title = "A", properties: Record<string, unknown> = {}) {
  return prisma.record.create({
    data: { databaseId: dbId, title, properties: JSON.stringify(properties), position: 1000 },
  });
}

const revsOf = (recordId: string) =>
  prisma.recordRevision.findMany({ where: { recordId }, orderBy: { createdAt: "asc" } });

beforeAll(async () => {
  const s = await seedUserWithWorkspace(`recrev-${Date.now()}@x.tld`);
  userId = s.user.id;
  workspaceId = s.workspace.id;
  asMe();
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe("PATCH /api/records/[id] — journalisation RecordRevision", () => {
  it("AC1 : PATCH title → une révision field=title, actorId session, before/after, createdAt", async () => {
    asMe();
    const db = await mkDatabase();
    const rec = await mkRecord(db.id, "A");

    const res = await PATCH(patchReq(rec.id, { title: "B" }), params(rec.id));
    expect(res.status).toBe(200);

    const revs = await revsOf(rec.id);
    expect(revs).toHaveLength(1);
    expect(revs[0].field).toBe("title");
    expect(revs[0].actorId).toBe(userId);
    expect(JSON.parse(revs[0].before)).toBe("A");
    expect(JSON.parse(revs[0].after)).toBe("B");
    expect(revs[0].createdAt).toBeInstanceOf(Date);
  });

  it("AC2 : title + 2 properties distinctes → 3 révisions ; re-PATCH inchangé → 0 ajout", async () => {
    asMe();
    const db = await mkDatabase();
    const rec = await mkRecord(db.id, "A", { p1: "x", p2: "y" });

    await PATCH(
      patchReq(rec.id, { title: "B", properties: { p1: "x2", p2: "y2" } }),
      params(rec.id)
    );
    let revs = await revsOf(rec.id);
    expect(revs).toHaveLength(3);
    expect(revs.map((r) => r.field).sort()).toEqual(["p1", "p2", "title"]);
    const byField = Object.fromEntries(revs.map((r) => [r.field, r]));
    expect(JSON.parse(byField.title.before)).toBe("A");
    expect(JSON.parse(byField.title.after)).toBe("B");
    expect(JSON.parse(byField.p1.after)).toBe("x2");
    expect(JSON.parse(byField.p2.after)).toBe("y2");

    // Re-PATCH avec des valeurs identiques à l'existant → aucune nouvelle révision.
    await PATCH(
      patchReq(rec.id, { title: "B", properties: { p1: "x2", p2: "y2" } }),
      params(rec.id)
    );
    revs = await revsOf(rec.id);
    expect(revs).toHaveLength(3);
  });

  it("AC3 : coalescence < 2 min, même acteur/champ → fusion (before d'origine, after màj, date rafraîchie)", async () => {
    asMe();
    const db = await mkDatabase();
    const rec = await mkRecord(db.id, "A");

    await PATCH(patchReq(rec.id, { title: "B" }), params(rec.id));
    const first = (await revsOf(rec.id))[0];

    await PATCH(patchReq(rec.id, { title: "C" }), params(rec.id));
    const revs = await revsOf(rec.id);

    expect(revs).toHaveLength(1); // fusion : pas de nouvelle ligne
    expect(revs[0].id).toBe(first.id);
    expect(JSON.parse(revs[0].before)).toBe("A"); // before d'origine conservé
    expect(JSON.parse(revs[0].after)).toBe("C"); // after mis à jour
    expect(revs[0].createdAt.getTime()).toBeGreaterThanOrEqual(first.createdAt.getTime());
  });

  it("AC4a : dernière révision > 2 min → nouvelle ligne (pas de fusion)", async () => {
    asMe();
    const db = await mkDatabase();
    const rec = await mkRecord(db.id, "A");

    await PATCH(patchReq(rec.id, { title: "B" }), params(rec.id));
    const first = (await revsOf(rec.id))[0];
    // Antidater la révision au-delà de la fenêtre de coalescence.
    await prisma.recordRevision.update({
      where: { id: first.id },
      data: { createdAt: new Date(Date.now() - 3 * 60 * 1000) },
    });

    await PATCH(patchReq(rec.id, { title: "C" }), params(rec.id));
    const revs = await revsOf(rec.id);
    expect(revs).toHaveLength(2);
    expect(JSON.parse(revs[1].before)).toBe("B");
    expect(JSON.parse(revs[1].after)).toBe("C");
  });

  it("AC4b : autre acteur → nouvelle ligne distincte", async () => {
    asMe();
    const db = await mkDatabase();
    const rec = await mkRecord(db.id, "A");
    await PATCH(patchReq(rec.id, { title: "B" }), params(rec.id));

    const other = await prisma.user.create({
      data: {
        email: `recrev-other-${Date.now()}@x.tld`,
        firstName: "O", lastName: "Ther", displayName: "Autre", passwordHash: "x",
      },
    });
    await prisma.membership.create({ data: { userId: other.id, workspaceId, role: "editor" } });

    asUser(other.id);
    await PATCH(patchReq(rec.id, { title: "C" }), params(rec.id));

    const revs = await revsOf(rec.id);
    expect(revs).toHaveLength(2);
    expect(revs[0].actorId).toBe(userId);
    expect(revs[1].actorId).toBe(other.id);
    expect(JSON.parse(revs[1].after)).toBe("C");
    asMe();
  });

  it("cas limite : PATCH d'une section → révision field = id de section ; passage corps libre journalisé", async () => {
    asMe();
    const db = await mkDatabase();
    const rec = await prisma.record.create({
      data: {
        databaseId: db.id, title: "Sec", properties: "{}", position: 1000,
        sectionsBody: JSON.stringify([{ id: "s1", label: "Contexte", content: [] }]),
      },
    });

    await PATCH(
      patchReq(rec.id, { sectionsBody: [{ id: "s1", label: "Contexte", content: [{ t: "x" }] }] }),
      params(rec.id)
    );
    let revs = await revsOf(rec.id);
    expect(revs).toHaveLength(1);
    expect(revs[0].field).toBe("s1");

    // > 2 min pour éviter la coalescence avec la révision "sectionsBody" suivante.
    await prisma.recordRevision.update({
      where: { id: revs[0].id },
      data: { createdAt: new Date(Date.now() - 3 * 60 * 1000) },
    });

    await PATCH(patchReq(rec.id, { sectionsBody: null }), params(rec.id));
    revs = await revsOf(rec.id);
    expect(revs.some((r) => r.field === "sectionsBody")).toBe(true);
  });

  it("cas limite : suppression définitive du record efface ses révisions en cascade", async () => {
    asMe();
    const db = await mkDatabase();
    const rec = await mkRecord(db.id, "A");
    await PATCH(patchReq(rec.id, { title: "B" }), params(rec.id));
    expect(await revsOf(rec.id)).toHaveLength(1);

    const delReq = new Request(`http://localhost/api/records/${rec.id}?permanent=1`, { method: "DELETE" });
    await DELETE(delReq, params(rec.id));

    expect(await revsOf(rec.id)).toHaveLength(0);
  });
});

describe("GET /api/records/[id]/revisions", () => {
  const getParams = (id: string) => ({ params: Promise.resolve({ id }) });

  it("AC5 : tri décroissant + payload complet (acteur id/displayName, field, before, after, createdAt)", async () => {
    asMe();
    const db = await mkDatabase();
    const rec = await mkRecord(db.id, "A");
    await PATCH(patchReq(rec.id, { title: "B" }), params(rec.id));
    await prisma.recordRevision.updateMany({
      where: { recordId: rec.id },
      data: { createdAt: new Date(Date.now() - 3 * 60 * 1000) },
    });
    await PATCH(patchReq(rec.id, { properties: { p1: "v" } }), params(rec.id));

    const res = await GET(new Request("http://localhost"), getParams(rec.id));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toHaveLength(2);
    // Plus récent en tête : la révision de property précède celle de titre.
    expect(body[0].field).toBe("p1");
    expect(body[1].field).toBe("title");
    expect(new Date(body[0].createdAt).getTime()).toBeGreaterThanOrEqual(
      new Date(body[1].createdAt).getTime()
    );
    expect(body[0].actor).toEqual({ id: userId, displayName: "Test User" });
    expect(body[1].before).toBe("A");
    expect(body[1].after).toBe("B");
  });

  it("AC5 : 401 sans session, 404 pour un non-membre", async () => {
    asMe();
    const db = await mkDatabase();
    const rec = await mkRecord(db.id, "A");
    await PATCH(patchReq(rec.id, { title: "B" }), params(rec.id));

    mockGetSession.mockResolvedValueOnce(null);
    expect((await GET(new Request("http://localhost"), getParams(rec.id))).status).toBe(401);

    const stranger = await seedUserWithWorkspace(`recrev-str-${Date.now()}@x.tld`);
    asUser(stranger.user.id);
    expect((await GET(new Request("http://localhost"), getParams(rec.id))).status).toBe(404);
    asMe();
  });
});
