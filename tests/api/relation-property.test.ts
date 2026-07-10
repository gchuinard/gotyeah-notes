import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";

vi.mock("@/lib/session", () => ({ getSession: vi.fn() }));

import { getSession } from "@/lib/session";
import { POST as createProperty } from "@/app/api/databases/[id]/properties/route";
import { POST as createRecord } from "@/app/api/databases/[id]/records/route";
import { PATCH as patchRecord } from "@/app/api/records/[id]/route";
import { prisma } from "@/lib/prisma";
import { seedUserWithWorkspace } from "../helpers/seed";

const mockGetSession = vi.mocked(getSession);

let userId: string;
let workspaceId: string;

function asMe() {
  mockGetSession.mockResolvedValue({ id: userId, email: "u", displayName: "U", currentWorkspaceId: workspaceId });
}

const jsonReq = (method: string, body: unknown) =>
  new Request("http://localhost/x", {
    method,
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
const mkRecord = (databaseId: string, title: string, properties: Record<string, unknown> = {}) =>
  prisma.record.create({
    data: { databaseId, title, position: 1000, properties: JSON.stringify(properties) },
  });

beforeAll(async () => {
  const seeded = await seedUserWithWorkspace(`rel-${Date.now()}@x.tld`);
  userId = seeded.user.id;
  workspaceId = seeded.workspace.id;
  asMe();
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe("POST /api/databases/[id]/properties — type relation", () => {
  it("AC1 : targetDatabaseId valide (même workspace) → 201", async () => {
    asMe();
    const a = await mkDatabase();
    const b = await mkDatabase();

    const res = await createProperty(
      jsonReq("POST", { name: "Épic", type: "relation", config: { type: "relation", targetDatabaseId: b.id } }),
      withId(a.id)
    );
    expect(res.status).toBe(201);
    const prop = await res.json();
    expect(prop.type).toBe("relation");
    expect(prop.config.targetDatabaseId).toBe(b.id);
  });

  it("AC1 : targetDatabaseId absent → 400", async () => {
    asMe();
    const a = await mkDatabase();
    const res = await createProperty(
      jsonReq("POST", { name: "Épic", type: "relation", config: { type: "relation" } }),
      withId(a.id)
    );
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/targetDatabaseId/i);
  });

  it("AC1 : database cible hors workspace → 400 (pas de lien traversant une frontière d'accès)", async () => {
    const stranger = await seedUserWithWorkspace(`rel-str-${Date.now()}@x.tld`);
    const foreign = await mkDatabase(stranger.workspace.id, stranger.user.id);
    asMe();
    const a = await mkDatabase();

    const res = await createProperty(
      jsonReq("POST", { name: "Épic", type: "relation", config: { type: "relation", targetDatabaseId: foreign.id } }),
      withId(a.id)
    );
    expect(res.status).toBe(400);
  });

  it("AC1 : database cible inexistante → 400 ; config.type ≠ type → 400", async () => {
    asMe();
    const a = await mkDatabase();
    expect(
      (await createProperty(
        jsonReq("POST", { name: "X", type: "relation", config: { type: "relation", targetDatabaseId: "nope" } }),
        withId(a.id)
      )).status
    ).toBe(400);
    expect(
      (await createProperty(
        jsonReq("POST", { name: "X", type: "relation", config: { type: "text" } }),
        withId(a.id)
      )).status
    ).toBe(400);
  });
});

describe("Écriture des valeurs de relation — garde-fou référentiel", () => {
  async function setup() {
    const a = await mkDatabase();
    const b = await mkDatabase();
    const rel = await prisma.databaseProperty.create({
      data: {
        databaseId: a.id,
        name: "Épic",
        type: "relation",
        position: 1000,
        config: JSON.stringify({ type: "relation", targetDatabaseId: b.id }),
      },
    });
    const r1 = await mkRecord(b.id, "cible 1");
    const r2 = await mkRecord(b.id, "cible 2");
    return { a, b, rel, r1, r2 };
  }

  it("AC2 : PATCH avec [r1, r2] → 200 et la valeur est le tableau d'ids", async () => {
    asMe();
    const { a, rel, r1, r2 } = await setup();
    const source = await mkRecord(a.id, "source");

    const res = await patchRecord(jsonReq("PATCH", { properties: { [rel.id]: [r1.id, r2.id] } }), withId(source.id));
    expect(res.status).toBe(200);
    expect((await res.json()).properties[rel.id]).toEqual([r1.id, r2.id]);
  });

  it("AC2 : null retire la clé (mergeRecordProperties)", async () => {
    asMe();
    const { a, rel, r1 } = await setup();
    const source = await mkRecord(a.id, "source", { [rel.id]: [r1.id] });

    const res = await patchRecord(jsonReq("PATCH", { properties: { [rel.id]: null } }), withId(source.id));
    expect(res.status).toBe(200);
    expect((await res.json()).properties[rel.id]).toBeUndefined();
  });

  it("AC3 : id cible d'une AUTRE database → 400 et aucune écriture", async () => {
    asMe();
    const { a, rel, r1 } = await setup();
    const other = await mkDatabase();
    const intrus = await mkRecord(other.id, "intrus");
    const source = await mkRecord(a.id, "source", { [rel.id]: [r1.id] });

    const res = await patchRecord(
      jsonReq("PATCH", { properties: { [rel.id]: [r1.id, intrus.id] } }),
      withId(source.id)
    );
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/n'appartiennent pas/i);

    // Valeur inchangée en base.
    const after = await prisma.record.findUniqueOrThrow({ where: { id: source.id } });
    expect(JSON.parse(after.properties)[rel.id]).toEqual([r1.id]);
  });

  it("AC3 : id cible inexistant → 400", async () => {
    asMe();
    const { a, rel } = await setup();
    const source = await mkRecord(a.id, "source");
    const res = await patchRecord(jsonReq("PATCH", { properties: { [rel.id]: ["fantome"] } }), withId(source.id));
    expect(res.status).toBe(400);
  });

  it("AC3 : valeur non-tableau (string) → 400", async () => {
    asMe();
    const { a, rel, r1 } = await setup();
    const source = await mkRecord(a.id, "source");
    const res = await patchRecord(jsonReq("PATCH", { properties: { [rel.id]: r1.id } }), withId(source.id));
    expect(res.status).toBe(400);
  });

  it("POST record : mêmes garde-fous (valide → 201, intrus → 400)", async () => {
    asMe();
    const { a, rel, r1 } = await setup();
    const other = await mkDatabase();
    const intrus = await mkRecord(other.id, "intrus");

    const ok = await createRecord(jsonReq("POST", { title: "s", properties: { [rel.id]: [r1.id] } }), withId(a.id));
    expect(ok.status).toBe(201);

    const ko = await createRecord(jsonReq("POST", { title: "s", properties: { [rel.id]: [intrus.id] } }), withId(a.id));
    expect(ko.status).toBe(400);
  });

  it("AC6 : record cible supprimé → lien mort toléré, la donnée reste lisible (aucune 500)", async () => {
    asMe();
    const { a, rel, r1 } = await setup();
    const source = await mkRecord(a.id, "source", { [rel.id]: [r1.id] });
    await prisma.record.delete({ where: { id: r1.id } });

    const after = await prisma.record.findUniqueOrThrow({ where: { id: source.id } });
    expect(JSON.parse(after.properties)[rel.id]).toEqual([r1.id]);

    // Un PATCH qui NE touche pas la relation passe toujours (le lien mort n'est pas revalidé).
    const res = await patchRecord(jsonReq("PATCH", { title: "renommé" }), withId(source.id));
    expect(res.status).toBe(200);
  });
});
