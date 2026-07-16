import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";

vi.mock("@/lib/session", () => ({ getSession: vi.fn() }));

import { getSession } from "@/lib/session";
import { PATCH } from "@/app/api/views/[id]/route";
import { GET as GET_DB } from "@/app/api/databases/[id]/route";
import { prisma } from "@/lib/prisma";
import { serializeView } from "@/lib/db";
import { seedUserWithWorkspace } from "../helpers/seed";

const mockGetSession = vi.mocked(getSession);

let userId: string;
let workspaceId: string;

function asMe() {
  mockGetSession.mockResolvedValue({ id: userId, email: "u", displayName: "U", currentWorkspaceId: workspaceId });
}

function patchReq(body: unknown) {
  return new Request("http://localhost/api/views/x", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}
const params = (id: string) => ({ params: Promise.resolve({ id }) });

/** Database + 3 vues aux positions 1000 / 2000 / 3000 (ordre de création). */
async function mkDatabaseWith3Views() {
  const page = await prisma.page.create({
    data: { title: "db", workspaceId, ownerId: userId, visibility: "team", position: 1000 },
  });
  const db = await prisma.database.create({ data: { pageId: page.id } });
  const mkView = (name: string, position: number) =>
    prisma.view.create({
      data: {
        databaseId: db.id,
        name,
        type: "table",
        position,
        ...serializeView({ config: {} }),
      },
    });
  const v1 = await mkView("V1", 1000);
  const v2 = await mkView("V2", 2000);
  const v3 = await mkView("V3", 3000);
  return { dbId: db.id, v1, v2, v3 };
}

beforeAll(async () => {
  const seeded = await seedUserWithWorkspace(`viewreorder-${Date.now()}@x.tld`);
  userId = seeded.user.id;
  workspaceId = seeded.workspace.id;
  asMe();
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe("PATCH /api/views/[id] { position } — réordonnancement des onglets", () => {
  it("AC1 : renvoie la vue parsée avec la nouvelle position, sans toucher les autres", async () => {
    asMe();
    const { v1, v2, v3 } = await mkDatabaseWith3Views();

    // Déplacer V3 en tête → position intermédiaire < 1re position (1000).
    const res = await PATCH(patchReq({ position: 500 }), params(v3.id));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.id).toBe(v3.id);
    expect(body.position).toBe(500);
    // config reste un objet parsé (pas une string JSON).
    expect(body.config).toEqual({});

    // Aucune autre vue n'a bougé.
    expect((await prisma.view.findUniqueOrThrow({ where: { id: v1.id } })).position).toBe(1000);
    expect((await prisma.view.findUniqueOrThrow({ where: { id: v2.id } })).position).toBe(2000);
  });

  it("AC4 : le re-GET de la database restitue le nouvel ordre trié (persistance/partage)", async () => {
    asMe();
    const { dbId, v1, v2, v3 } = await mkDatabaseWith3Views();

    // Déplacer V1 entre V2 et V3 → (2000 + 3000) / 2 = 2500.
    const res = await PATCH(patchReq({ position: 2500 }), params(v1.id));
    expect(res.status).toBe(200);

    const getRes = await GET_DB(new Request(`http://localhost/api/databases/${dbId}`), params(dbId));
    expect(getRes.status).toBe(200);
    const db = await getRes.json();
    // GET trie par position asc → V2, V1, V3.
    expect(db.views.map((v: { id: string }) => v.id)).toEqual([v2.id, v1.id, v3.id]);
    // Positions inchangées pour V2 et V3.
    expect(db.views.find((v: { id: string }) => v.id === v2.id).position).toBe(2000);
    expect(db.views.find((v: { id: string }) => v.id === v3.id).position).toBe(3000);
  });

  it("un PATCH position n'altère ni le nom ni le type ni la config de la vue déplacée", async () => {
    asMe();
    const { v2 } = await mkDatabaseWith3Views();

    await PATCH(patchReq({ position: 1500 }), params(v2.id));
    const after = await prisma.view.findUniqueOrThrow({ where: { id: v2.id } });
    expect(after.name).toBe("V2");
    expect(after.type).toBe("table");
    expect(after.position).toBe(1500);
  });

  it("401 sans session ; 404 sans accès (vue d'un autre workspace)", async () => {
    const { v1 } = await mkDatabaseWith3Views();

    mockGetSession.mockResolvedValueOnce(null);
    expect((await PATCH(patchReq({ position: 42 }), params(v1.id))).status).toBe(401);

    const stranger = await seedUserWithWorkspace(`viewreorder-str-${Date.now()}@x.tld`);
    const otherPage = await prisma.page.create({
      data: { title: "x", workspaceId: stranger.workspace.id, ownerId: stranger.user.id, visibility: "team", position: 1000 },
    });
    const otherDb = await prisma.database.create({ data: { pageId: otherPage.id } });
    const otherView = await prisma.view.create({
      data: { databaseId: otherDb.id, name: "X", type: "table", position: 1000, ...serializeView({ config: {} }) },
    });
    asMe();
    expect((await PATCH(patchReq({ position: 42 }), params(otherView.id))).status).toBe(404);
  });
});
