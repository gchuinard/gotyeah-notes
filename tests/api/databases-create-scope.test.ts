import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";

// Mock PARTIEL : seul getSession est simulé. Le module exporte aussi hashToken
// et createSession, dont dépendent des chemins réels (ex. les jetons de
// connexion par email) — un mock total les remplacerait par undefined.
vi.mock("@/lib/session", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/session")>()),
  getSession: vi.fn(),
}));

import { getSession } from "@/lib/session";
import { POST } from "@/app/api/databases/route";
import { prisma } from "@/lib/prisma";
import { seedUserWithWorkspace } from "../helpers/seed";

const mockGetSession = vi.mocked(getSession);

function postDatabase(pageId: string) {
  return POST(
    new Request("http://localhost/api/databases", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pageId }),
    })
  );
}

describe("POST /api/databases — garde page privée", () => {
  let A: string;
  let B: string;
  let workspaceId: string;
  let privatePageOfA: string;

  beforeAll(async () => {
    const seeded = await seedUserWithWorkspace(`dbowner-${Date.now()}@x.tld`);
    A = seeded.user.id;
    workspaceId = seeded.workspace.id;
    const b = await prisma.user.create({
      data: { email: `dbmember-${Date.now()}@x.tld`, firstName: "B", lastName: "B", displayName: "B", passwordHash: "x" },
    });
    B = b.id;
    await prisma.membership.create({ data: { userId: B, workspaceId, role: "admin" } });
    const page = await prisma.page.create({
      data: { title: "Privée de A", workspaceId, ownerId: A, visibility: "private", position: 1000 },
    });
    privatePageOfA = page.id;
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("B (membre non-propriétaire) → 404 sur la page privée de A", async () => {
    mockGetSession.mockResolvedValue({ id: B, email: "b", displayName: "B", currentWorkspaceId: workspaceId , isService: false});
    const res = await postDatabase(privatePageOfA);
    expect(res.status).toBe(404);
    const still = await prisma.database.findUnique({ where: { pageId: privatePageOfA } });
    expect(still).toBeNull();
  });

  it("A (propriétaire) → 201 sur sa propre page privée", async () => {
    mockGetSession.mockResolvedValue({ id: A, email: "a", displayName: "A", currentWorkspaceId: workspaceId , isService: false});
    const res = await postDatabase(privatePageOfA);
    expect(res.status).toBe(201);
  });
});
