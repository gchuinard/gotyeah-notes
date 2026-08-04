import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";

vi.mock("@/lib/session", () => ({ getSession: vi.fn() }));

import { getSession } from "@/lib/session";
import { POST as createProperty } from "@/app/api/databases/[id]/properties/route";
import { POST as createRecord } from "@/app/api/databases/[id]/records/route";
import { PATCH as patchRecord } from "@/app/api/records/[id]/route";
import { prisma } from "@/lib/prisma";
import { seedUserWithWorkspace, seedMember } from "../helpers/seed";

const mockGetSession = vi.mocked(getSession);

let userId: string;
let workspaceId: string;

function asMe() {
  mockGetSession.mockResolvedValue({
    id: userId,
    email: "u",
    displayName: "U",
    currentWorkspaceId: workspaceId,
  });
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

async function mkUserProperty(databaseId: string, name = "Assigné") {
  return prisma.databaseProperty.create({
    data: {
      databaseId,
      name,
      type: "user",
      position: 1000,
      config: JSON.stringify({ type: "user" }),
    },
  });
}

beforeAll(async () => {
  const seeded = await seedUserWithWorkspace(`usr-prop-${Date.now()}@x.tld`);
  userId = seeded.user.id;
  workspaceId = seeded.workspace.id;
  asMe();
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe("POST /api/databases/[id]/properties — type user", () => {
  it("AC1 : type `user` accepté → 201, config par défaut { type: 'user' }", async () => {
    asMe();
    const db = await mkDatabase();

    const res = await createProperty(
      jsonReq("POST", { name: "Assigné", type: "user" }),
      withId(db.id)
    );
    expect(res.status).toBe(201);

    const prop = await res.json();
    expect(prop.type).toBe("user");
    expect(prop.config).toEqual({ type: "user" });
  });
});

describe("Écriture des valeurs user — garde-fou d'appartenance", () => {
  it("AC2 : membre de l'espace → 200 et la valeur est le tableau d'ids", async () => {
    asMe();
    const db = await mkDatabase();
    const prop = await mkUserProperty(db.id);
    const other = await seedMember(workspaceId, "editor");
    const record = await mkRecord(db.id, "carte");

    const res = await patchRecord(
      jsonReq("PATCH", { properties: { [prop.id]: [userId, other.user.id] } }),
      withId(record.id)
    );
    expect(res.status).toBe(200);
    expect((await res.json()).properties[prop.id]).toEqual([userId, other.user.id]);
  });

  it("AC3 : utilisateur d'un AUTRE espace → 400 et aucune écriture", async () => {
    asMe();
    const db = await mkDatabase();
    const prop = await mkUserProperty(db.id);
    const record = await mkRecord(db.id, "carte", { [prop.id]: [userId] });

    // Un vrai User, membre d'un autre espace : le seul cas qui ferait fuiter
    // une identité inter-espaces si le garde-fou se contentait d'exister.
    const foreign = await seedUserWithWorkspace(`foreign-${Date.now()}@x.tld`);

    const res = await patchRecord(
      jsonReq("PATCH", { properties: { [prop.id]: [userId, foreign.user.id] } }),
      withId(record.id)
    );
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/ne sont pas membres/i);

    const after = await prisma.record.findUniqueOrThrow({ where: { id: record.id } });
    expect(JSON.parse(after.properties)[prop.id]).toEqual([userId]);
  });

  it("AC3 : id inexistant → 400", async () => {
    asMe();
    const db = await mkDatabase();
    const prop = await mkUserProperty(db.id);
    const record = await mkRecord(db.id, "carte");

    const res = await patchRecord(
      jsonReq("PATCH", { properties: { [prop.id]: ["fantome"] } }),
      withId(record.id)
    );
    expect(res.status).toBe(400);
  });

  it("AC3 : valeur non-tableau (string) → 400", async () => {
    asMe();
    const db = await mkDatabase();
    const prop = await mkUserProperty(db.id);
    const record = await mkRecord(db.id, "carte");

    const res = await patchRecord(
      jsonReq("PATCH", { properties: { [prop.id]: userId } }),
      withId(record.id)
    );
    expect(res.status).toBe(400);
  });

  it("AC2 : null retire la clé (mergeRecordProperties)", async () => {
    asMe();
    const db = await mkDatabase();
    const prop = await mkUserProperty(db.id);
    const record = await mkRecord(db.id, "carte", { [prop.id]: [userId] });

    const res = await patchRecord(
      jsonReq("PATCH", { properties: { [prop.id]: null } }),
      withId(record.id)
    );
    expect(res.status).toBe(200);
    expect((await res.json()).properties[prop.id]).toBeUndefined();
  });

  it("POST record : mêmes garde-fous (membre → 201, étranger → 400)", async () => {
    asMe();
    const db = await mkDatabase();
    const prop = await mkUserProperty(db.id);
    const foreign = await seedUserWithWorkspace(`foreign2-${Date.now()}@x.tld`);

    const ok = await createRecord(
      jsonReq("POST", { title: "s", properties: { [prop.id]: [userId] } }),
      withId(db.id)
    );
    expect(ok.status).toBe(201);

    const ko = await createRecord(
      jsonReq("POST", { title: "s", properties: { [prop.id]: [foreign.user.id] } }),
      withId(db.id)
    );
    expect(ko.status).toBe(400);
  });

  it("AC6 : membre retiré de l'espace → lien mort toléré, le record reste modifiable", async () => {
    asMe();
    const db = await mkDatabase();
    const prop = await mkUserProperty(db.id);
    const leaving = await seedMember(workspaceId, "editor");
    const record = await mkRecord(db.id, "carte", { [prop.id]: [leaving.user.id] });

    await prisma.membership.delete({ where: { id: leaving.membership.id } });

    // La validation ne porte QUE sur le patch entrant : sans cela, un membre
    // parti gèlerait toute écriture ultérieure sur les cartes qu'il occupait.
    const res = await patchRecord(jsonReq("PATCH", { title: "renommé" }), withId(record.id));
    expect(res.status).toBe(200);

    const after = await prisma.record.findUniqueOrThrow({ where: { id: record.id } });
    expect(JSON.parse(after.properties)[prop.id]).toEqual([leaving.user.id]);
  });
});
