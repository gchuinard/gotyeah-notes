import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";

vi.mock("@/lib/session", () => ({ getSession: vi.fn() }));

import { getSession } from "@/lib/session";
import { PATCH } from "@/app/api/databases/[id]/route";
import { prisma } from "@/lib/prisma";
import { seedUserWithWorkspace } from "../helpers/seed";

const mockGetSession = vi.mocked(getSession);

let userId: string;
let workspaceId: string;

function asMe() {
  mockGetSession.mockResolvedValue({ id: userId, email: "u", displayName: "U", currentWorkspaceId: workspaceId , isService: false});
}

const req = (body: unknown) =>
  new Request("http://localhost/api/databases/x", {
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
  const s = await seedUserWithWorkspace(`dbmap-${Date.now()}@x.tld`);
  userId = s.user.id;
  workspaceId = s.workspace.id;
  asMe();
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe("PATCH /api/databases/[id] — mapping patchNotesPageId (contrôle d'accès)", () => {
  it("refuse la page PRIVÉE d'un autre membre du workspace (400, mapping non posé)", async () => {
    asMe();
    const db = await mkDatabase();
    const other = await prisma.user.create({
      data: {
        email: `other-${Date.now()}@x.tld`,
        firstName: "Other",
        lastName: "Member",
        displayName: "Other",
        passwordHash: "x",
      },
    });
    await prisma.membership.create({ data: { userId: other.id, workspaceId, role: "editor" } });
    const privatePage = await prisma.page.create({
      data: { title: "Privée de l'autre", workspaceId, ownerId: other.id, visibility: "private", position: 3000 },
    });

    const res = await PATCH(req({ patchNotesPageId: privatePage.id }), params(db.id));
    expect(res.status).toBe(400);
    const fresh = await prisma.database.findUnique({
      where: { id: db.id },
      select: { patchNotesPageId: true },
    });
    expect(fresh?.patchNotesPageId).toBeNull();
  });

  it("refuse une page d'un AUTRE workspace (400)", async () => {
    asMe();
    const db = await mkDatabase();
    const otherWs = await prisma.workspace.create({ data: { name: "Autre WS", createdBy: userId } });
    const foreignPage = await prisma.page.create({
      data: { title: "Ailleurs", workspaceId: otherWs.id, ownerId: userId, visibility: "team", position: 1000 },
    });

    const res = await PATCH(req({ patchNotesPageId: foreignPage.id }), params(db.id));
    expect(res.status).toBe(400);
  });

  it("accepte une page team accessible (200) et pose le mapping", async () => {
    asMe();
    const db = await mkDatabase();
    const teamPage = await prisma.page.create({
      data: { title: "📓 Patch notes", workspaceId, ownerId: userId, visibility: "team", position: 4000 },
    });

    const res = await PATCH(req({ patchNotesPageId: teamPage.id }), params(db.id));
    expect(res.status).toBe(200);
    const fresh = await prisma.database.findUnique({
      where: { id: db.id },
      select: { patchNotesPageId: true },
    });
    expect(fresh?.patchNotesPageId).toBe(teamPage.id);
  });

  it("accepte MA propre page privée (200) — accessible à son propriétaire", async () => {
    asMe();
    const db = await mkDatabase();
    const myPrivate = await prisma.page.create({
      data: { title: "Mes notes", workspaceId, ownerId: userId, visibility: "private", position: 5000 },
    });

    const res = await PATCH(req({ patchNotesPageId: myPrivate.id }), params(db.id));
    expect(res.status).toBe(200);
  });
});
