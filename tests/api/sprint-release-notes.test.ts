import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";

vi.mock("@/lib/session", () => ({ getSession: vi.fn() }));

import { getSession } from "@/lib/session";
import { PATCH } from "@/app/api/sprints/[id]/route";
import { prisma } from "@/lib/prisma";
import { seedUserWithWorkspace } from "../helpers/seed";

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

async function mkDatabase() {
  const page = await prisma.page.create({
    data: { title: "db", workspaceId, ownerId: userId, visibility: "team", position: 1000 },
  });
  return prisma.database.create({ data: { pageId: page.id } });
}

beforeAll(async () => {
  const s = await seedUserWithWorkspace(`sprintrn-${Date.now()}@x.tld`);
  userId = s.user.id;
  workspaceId = s.workspace.id;
  asMe();
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe("PATCH /api/sprints/[id] — notes de version auto à la clôture", () => {
  it("AC1 : clôture génère releaseNotes depuis les issues livrées", async () => {
    asMe();
    const db = await mkDatabase();
    const sprint = await prisma.sprint.create({
      data: { databaseId: db.id, name: "Sprint Alpha", state: "active", position: 1000 },
    });
    await prisma.record.create({ data: { databaseId: db.id, sprintId: sprint.id, title: "Feature X", properties: "{}", position: 1000 } });
    await prisma.record.create({ data: { databaseId: db.id, sprintId: sprint.id, title: "Bug Y", properties: "{}", position: 2000 } });

    const res = await PATCH(req({ state: "completed" }), params(sprint.id));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.state).toBe("completed");
    expect(body.releaseNotes).toBeTruthy();
    expect(body.releaseNotes).toContain("Sprint Alpha");
    expect(body.releaseNotes).toContain("Feature X");
    expect(body.releaseNotes).toContain("Bug Y");
    expect(body.releaseNotes).toContain("2 issues livrées");
  });

  it("AC2 : idempotent — re-clôture ne régénère pas les notes", async () => {
    asMe();
    const db = await mkDatabase();
    const sprint = await prisma.sprint.create({
      data: { databaseId: db.id, name: "Sprint Beta", state: "active", position: 1000 },
    });
    await prisma.record.create({ data: { databaseId: db.id, sprintId: sprint.id, title: "T1", properties: "{}", position: 1000 } });

    const first = await (await PATCH(req({ state: "completed" }), params(sprint.id))).json();
    // Un record ajouté après coup ne doit PAS réapparaître dans des notes déjà générées.
    await prisma.record.create({ data: { databaseId: db.id, sprintId: sprint.id, title: "T2 tardif", properties: "{}", position: 2000 } });
    const second = await (await PATCH(req({ state: "completed" }), params(sprint.id))).json();

    expect(second.releaseNotes).toBe(first.releaseNotes);
    expect(second.releaseNotes).not.toContain("T2 tardif");
  });

  it("AC3 : 401 sans session", async () => {
    const db = await mkDatabase();
    const sprint = await prisma.sprint.create({
      data: { databaseId: db.id, name: "S", state: "active", position: 1000 },
    });
    mockGetSession.mockResolvedValueOnce(null);
    expect((await PATCH(req({ state: "completed" }), params(sprint.id))).status).toBe(401);
  });
});
