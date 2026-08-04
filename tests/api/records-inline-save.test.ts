import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";

vi.mock("@/lib/session", () => ({ getSession: vi.fn() }));

import { getSession } from "@/lib/session";
import { PATCH } from "@/app/api/records/[id]/route";
import { prisma } from "@/lib/prisma";
import { seedUserWithWorkspace } from "../helpers/seed";

const mockGetSession = vi.mocked(getSession);

let userId: string;
let workspaceId: string;

function asMe() {
  mockGetSession.mockResolvedValue({ id: userId, email: "u", displayName: "U", currentWorkspaceId: workspaceId , isService: false});
}

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

beforeAll(async () => {
  const seeded = await seedUserWithWorkspace(`recinline-${Date.now()}@x.tld`);
  userId = seeded.user.id;
  workspaceId = seeded.workspace.id;
  asMe();
});

afterAll(async () => {
  await prisma.$disconnect();
});

// Le save inline de la carte kanban réutilise EXACTEMENT ce contrat PATCH
// (titre ↔ { title }, valeur de propriété ↔ { properties: { [id]: value } }),
// avec merge des properties (une valeur null retire la clé).
describe("PATCH /api/records/[id] — contrat de sauvegarde inline (carte kanban)", () => {
  it("titre : { title } met à jour Record.title et renvoie l'objet parsé", async () => {
    asMe();
    const db = await mkDatabase();
    const rec = await prisma.record.create({
      data: { databaseId: db.id, title: "Avant", properties: "{}", position: 1000 },
    });

    const res = await PATCH(patchReq(rec.id, { title: "Après" }), params(rec.id));
    expect(res.status).toBe(200);
    const parsed = await res.json();
    expect(parsed.title).toBe("Après");
    expect(parsed.properties).toEqual({});
  });

  it("select : { properties: { [id]: optionId } } écrit la valeur (merge, pas écrasement)", async () => {
    asMe();
    const db = await mkDatabase();
    const rec = await prisma.record.create({
      data: {
        databaseId: db.id,
        title: "Carte",
        properties: JSON.stringify({ autre: "conserve" }),
        position: 1000,
      },
    });

    const res = await PATCH(
      patchReq(rec.id, { properties: { statut: "opt-a" } }),
      params(rec.id)
    );
    expect(res.status).toBe(200);
    const parsed = await res.json();
    // La clé existante est CONSERVÉE (merge), la nouvelle est ajoutée.
    expect(parsed.properties).toEqual({ autre: "conserve", statut: "opt-a" });
  });

  it("une valeur null supprime la clé (mergeRecordProperties)", async () => {
    asMe();
    const db = await mkDatabase();
    const rec = await prisma.record.create({
      data: {
        databaseId: db.id,
        title: "Carte",
        properties: JSON.stringify({ statut: "opt-a", autre: "conserve" }),
        position: 1000,
      },
    });

    const res = await PATCH(
      patchReq(rec.id, { properties: { statut: null } }),
      params(rec.id)
    );
    expect(res.status).toBe(200);
    const parsed = await res.json();
    expect(parsed.properties).toEqual({ autre: "conserve" });
    expect(parsed.properties.statut).toBeUndefined();
  });

  it("401 sans session ; 404 sans accès", async () => {
    asMe();
    const db = await mkDatabase();
    const rec = await prisma.record.create({
      data: { databaseId: db.id, title: "r", properties: "{}", position: 1000 },
    });

    mockGetSession.mockResolvedValueOnce(null);
    expect((await PATCH(patchReq(rec.id, { title: "x" }), params(rec.id))).status).toBe(401);

    const stranger = await seedUserWithWorkspace(`recinline-str-${Date.now()}@x.tld`);
    const otherDb = await mkDatabase(stranger.user.id, stranger.workspace.id);
    const otherRec = await prisma.record.create({
      data: { databaseId: otherDb.id, title: "o", properties: "{}", position: 1000 },
    });
    asMe();
    expect((await PATCH(patchReq(otherRec.id, { title: "x" }), params(otherRec.id))).status).toBe(404);
  });
});
