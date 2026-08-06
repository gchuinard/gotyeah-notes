import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";

// Mock PARTIEL : seul getSession est simulé. Le module exporte aussi hashToken
// et createSession, dont dépendent des chemins réels (ex. les jetons de
// connexion par email) — un mock total les remplacerait par undefined.
vi.mock("@/lib/session", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/session")>()),
  getSession: vi.fn(),
}));

import { getSession } from "@/lib/session";
import { GET } from "@/app/api/databases/[id]/records/route";
import { prisma } from "@/lib/prisma";
import { CURRENT_USER_TOKEN } from "@/lib/db";
import { seedUserWithWorkspace, seedMember } from "../helpers/seed";

const mockGetSession = vi.mocked(getSession);

let userId: string;
let workspaceId: string;
let otherId: string;

function asUser(id: string) {
  mockGetSession.mockResolvedValue({
    id,
    email: "u",
    displayName: "U",
    currentWorkspaceId: workspaceId,
    isService: false,
  });
}

const getReq = (dbId: string, query = "") =>
  new Request(
    `http://localhost/api/databases/${dbId}/records${query ? `?${query}` : ""}`,
    { method: "GET" }
  );
const getParams = (dbId: string) => ({ params: Promise.resolve({ id: dbId }) });

async function mkDatabase() {
  const page = await prisma.page.create({
    data: { title: "db", workspaceId, ownerId: userId, visibility: "team", position: 1000 },
  });
  return prisma.database.create({ data: { pageId: page.id } });
}

beforeAll(async () => {
  const seeded = await seedUserWithWorkspace(`filterme-${Date.now()}@x.tld`);
  userId = seeded.user.id;
  workspaceId = seeded.workspace.id;
  otherId = (await seedMember(workspaceId, "editor")).user.id;
  asUser(userId);
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe("GET /api/databases/[id]/records — jeton « @me » dans ?filter", () => {
  async function setup() {
    const db = await mkDatabase();
    const prop = await prisma.databaseProperty.create({
      data: {
        databaseId: db.id,
        name: "Assigné",
        type: "user",
        position: 1000,
        config: JSON.stringify({ type: "user" }),
      },
    });
    await prisma.record.create({
      data: {
        databaseId: db.id,
        title: "à moi",
        position: 1000,
        properties: JSON.stringify({ [prop.id]: [userId] }),
      },
    });
    await prisma.record.create({
      data: {
        databaseId: db.id,
        title: "à l'autre",
        position: 2000,
        properties: JSON.stringify({ [prop.id]: [otherId] }),
      },
    });
    await prisma.record.create({
      data: {
        databaseId: db.id,
        title: "aux deux",
        position: 3000,
        properties: JSON.stringify({ [prop.id]: [userId, otherId] }),
      },
    });
    const filter = encodeURIComponent(
      JSON.stringify([{ propertyId: prop.id, operator: "contains", value: CURRENT_USER_TOKEN }])
    );
    return { db, prop, filter };
  }

  it("le jeton est résolu sur l'APPELANT, pas sur l'auteur du filtre", async () => {
    const { db, filter } = await setup();

    asUser(userId);
    const mine = await (await GET(getReq(db.id, `filter=${filter}`), getParams(db.id))).json();
    expect(mine.map((r: { title: string }) => r.title)).toEqual(["à moi", "aux deux"]);

    // MÊME URL, MÊME filtre : c'est tout l'intérêt du jeton.
    asUser(otherId);
    const theirs = await (await GET(getReq(db.id, `filter=${filter}`), getParams(db.id))).json();
    expect(theirs.map((r: { title: string }) => r.title)).toEqual(["à l'autre", "aux deux"]);
  });

  it("X-Total-Count reflète le total APRÈS résolution", async () => {
    const { db, filter } = await setup();
    asUser(userId);
    const res = await GET(getReq(db.id, `filter=${filter}`), getParams(db.id));
    expect(res.headers.get("X-Total-Count")).toBe("2");
  });

  it("régression : non résolu, le jeton filtrerait sur la chaîne littérale → 0 record", async () => {
    const { db, prop } = await setup();
    asUser(userId);
    const literal = encodeURIComponent(
      JSON.stringify([{ propertyId: prop.id, operator: "contains", value: "@nobody" }])
    );
    const res = await GET(getReq(db.id, `filter=${literal}`), getParams(db.id));
    expect((await res.json()).length).toBe(0);
  });

  it("un filtre sans jeton reste littéral (aucune résolution parasite)", async () => {
    const { db, prop } = await setup();
    asUser(userId);
    const byOther = encodeURIComponent(
      JSON.stringify([{ propertyId: prop.id, operator: "contains", value: otherId }])
    );
    const res = await GET(getReq(db.id, `filter=${byOther}`), getParams(db.id));
    const data = await res.json();
    expect(data.map((r: { title: string }) => r.title)).toEqual(["à l'autre", "aux deux"]);
  });
});
