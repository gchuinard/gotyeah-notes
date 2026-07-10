import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";

vi.mock("@/lib/session", () => ({ getSession: vi.fn() }));

import { getSession } from "@/lib/session";
import { GET } from "@/app/api/databases/[id]/records/route";
import { prisma } from "@/lib/prisma";
import { seedUserWithWorkspace } from "../helpers/seed";

const mockGetSession = vi.mocked(getSession);

let userId: string;
let workspaceId: string;

function asMe() {
  mockGetSession.mockResolvedValue({ id: userId, email: "u", displayName: "U", currentWorkspaceId: workspaceId });
}

function getReq(dbId: string, query = "") {
  return new Request(`http://localhost/api/databases/${dbId}/records${query ? `?${query}` : ""}`, {
    method: "GET",
  });
}
const getParams = (dbId: string) => ({ params: Promise.resolve({ id: dbId }) });

async function mkDatabase(ownerId = userId) {
  const page = await prisma.page.create({
    data: { title: "db", workspaceId, ownerId, visibility: "team", position: 1000 },
  });
  return prisma.database.create({ data: { pageId: page.id } });
}

beforeAll(async () => {
  const seeded = await seedUserWithWorkspace(`reclist-${Date.now()}@x.tld`);
  userId = seeded.user.id;
  workspaceId = seeded.workspace.id;
  asMe();
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe("GET /api/databases/[id]/records — filtre / pagination / projection", () => {
  it("AC1 : sans query param → intégral, content + sectionsBody inclus, position asc", async () => {
    asMe();
    const db = await mkDatabase();
    await prisma.record.create({
      data: { databaseId: db.id, title: "libre", content: '[{"x":1}]', position: 1000, properties: "{}" },
    });
    await prisma.record.create({
      data: { databaseId: db.id, title: "templaté", sectionsBody: '[{"id":"s","label":"L","content":[]}]', position: 2000, properties: "{}" },
    });

    const res = await GET(getReq(db.id), getParams(db.id));
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.map((r: { title: string }) => r.title)).toEqual(["libre", "templaté"]);
    expect(data[0].content).toBe('[{"x":1}]');
    expect(data[1].sectionsBody).toBe('[{"id":"s","label":"L","content":[]}]');
    expect("content" in data[0]).toBe(true);
  });

  it("AC2 : includeContent=false omet content/sectionsBody, garde title/properties/sprintId", async () => {
    asMe();
    const db = await mkDatabase();
    await prisma.record.create({
      data: { databaseId: db.id, title: "r", content: '[{"big":"x"}]', position: 1000, properties: '{"p1":"v"}' },
    });

    const res = await GET(getReq(db.id, "includeContent=false"), getParams(db.id));
    const data = await res.json();
    expect("content" in data[0]).toBe(false);
    expect("sectionsBody" in data[0]).toBe(false);
    expect(data[0].title).toBe("r");
    expect(data[0].properties).toEqual({ p1: "v" });
    expect("sprintId" in data[0]).toBe(true);
  });

  it("AC3 : limit/offset bornent + X-Total-Count = total pré-pagination ; offset > total → []", async () => {
    asMe();
    const db = await mkDatabase();
    for (let i = 0; i < 5; i++) {
      await prisma.record.create({
        data: { databaseId: db.id, title: `r${i}`, position: (i + 1) * 1000, properties: "{}" },
      });
    }

    const res = await GET(getReq(db.id, "limit=2&offset=1"), getParams(db.id));
    const data = await res.json();
    expect(res.headers.get("X-Total-Count")).toBe("5");
    expect(data.map((r: { title: string }) => r.title)).toEqual(["r1", "r2"]);

    const empty = await GET(getReq(db.id, "offset=99"), getParams(db.id));
    expect((await empty.json()).length).toBe(0);
    expect(empty.headers.get("X-Total-Count")).toBe("5");
  });

  it("AC4 : ?filter par propriété select → sous-ensemble (parité applyFilters)", async () => {
    asMe();
    const db = await mkDatabase();
    const prop = await prisma.databaseProperty.create({
      data: {
        databaseId: db.id,
        name: "Statut",
        type: "select",
        position: 1000,
        config: JSON.stringify({ type: "select", options: [{ id: "done", name: "Fait", color: "green" }, { id: "todo", name: "À faire", color: "blue" }] }),
      },
    });
    for (let i = 0; i < 3; i++)
      await prisma.record.create({ data: { databaseId: db.id, title: `d${i}`, position: (i + 1) * 1000, properties: JSON.stringify({ [prop.id]: "done" }) } });
    for (let i = 0; i < 2; i++)
      await prisma.record.create({ data: { databaseId: db.id, title: `t${i}`, position: (i + 4) * 1000, properties: JSON.stringify({ [prop.id]: "todo" }) } });

    const filter = encodeURIComponent(JSON.stringify([{ propertyId: prop.id, operator: "eq", value: "done" }]));
    const res = await GET(getReq(db.id, `filter=${filter}`), getParams(db.id));
    const data = await res.json();
    expect(data.length).toBe(3);
    expect(data.every((r: { properties: Record<string, unknown> }) => r.properties[prop.id] === "done")).toBe(true);
    expect(res.headers.get("X-Total-Count")).toBe("3");
  });

  it("AC5 : query params invalides → 400", async () => {
    asMe();
    const db = await mkDatabase();
    expect((await GET(getReq(db.id, "limit=-5"), getParams(db.id))).status).toBe(400);
    expect((await GET(getReq(db.id, "offset=abc"), getParams(db.id))).status).toBe(400);
    expect((await GET(getReq(db.id, "filter=not-json"), getParams(db.id))).status).toBe(400);
    expect((await GET(getReq(db.id, `filter=${encodeURIComponent('{"bad":1}')}`), getParams(db.id))).status).toBe(400);
  });

  it("AC6 : 401 sans session ; 404 sans accès (quels que soient les params)", async () => {
    const db = await mkDatabase();
    mockGetSession.mockResolvedValueOnce(null);
    expect((await GET(getReq(db.id, "limit=2"), getParams(db.id))).status).toBe(401);

    // Database d'un autre user/workspace : accès refusé → 404.
    const stranger = await seedUserWithWorkspace(`reclist-str-${Date.now()}@x.tld`);
    const otherPage = await prisma.page.create({
      data: { title: "x", workspaceId: stranger.workspace.id, ownerId: stranger.user.id, visibility: "team", position: 1000 },
    });
    const otherDb = await prisma.database.create({ data: { pageId: otherPage.id } });
    asMe();
    expect((await GET(getReq(otherDb.id, "includeContent=false"), getParams(otherDb.id))).status).toBe(404);
  });
});
