import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";

vi.mock("@/lib/session", () => ({ getSession: vi.fn() }));

import { getSession } from "@/lib/session";
import { GET } from "@/app/api/search/route";
import { prisma } from "@/lib/prisma";
import { seedUserWithWorkspace } from "../helpers/seed";

const mockGetSession = vi.mocked(getSession);
const TERM = `ZorglubScope${Date.now()}`;

describe("GET /api/search — scope workspace", () => {
  let userId: string;
  let myWorkspaceId: string;
  let otherWorkspaceId: string;

  beforeAll(async () => {
    const seeded = await seedUserWithWorkspace(`searcher-${Date.now()}@x.tld`);
    userId = seeded.user.id;
    myWorkspaceId = seeded.workspace.id;

    // Page team dans MON workspace (doit remonter).
    await prisma.page.create({
      data: { title: `${TERM} mienne`, workspaceId: myWorkspaceId, visibility: "team", position: 1000 },
    });

    // Workspace d'un autre user, où je ne suis PAS membre, avec une page team (ne doit jamais remonter).
    const otherOwner = await prisma.user.create({
      data: { email: `other-${Date.now()}@x.tld`, firstName: "O", lastName: "O", displayName: "O", passwordHash: "x" },
    });
    const otherWs = await prisma.workspace.create({ data: { name: "Autre", createdBy: otherOwner.id } });
    otherWorkspaceId = otherWs.id;
    await prisma.membership.create({ data: { userId: otherOwner.id, workspaceId: otherWs.id, role: "admin" } });
    await prisma.page.create({
      data: { title: `${TERM} autrui`, workspaceId: otherWorkspaceId, visibility: "team", position: 1000 },
    });
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("sans workspaceId : ne remonte QUE les pages des workspaces de l'user", async () => {
    mockGetSession.mockResolvedValue({ id: userId, email: "x", displayName: "x", currentWorkspaceId: myWorkspaceId });
    const res = await GET(new Request(`http://localhost/api/search?q=${TERM}`));
    expect(res.status).toBe(200);
    const body = (await res.json()) as Array<{ title: string }>;
    expect(body.some((p) => p.title.includes("mienne"))).toBe(true);
    expect(body.some((p) => p.title.includes("autrui"))).toBe(false);
  });

  it("avec workspaceId membre : renvoie ses pages ; avec workspaceId non-membre : 404", async () => {
    mockGetSession.mockResolvedValue({ id: userId, email: "x", displayName: "x", currentWorkspaceId: myWorkspaceId });
    const ok = await GET(new Request(`http://localhost/api/search?q=${TERM}&workspaceId=${myWorkspaceId}`));
    expect(ok.status).toBe(200);
    expect(((await ok.json()) as unknown[]).length).toBeGreaterThan(0);

    mockGetSession.mockResolvedValue({ id: userId, email: "x", displayName: "x", currentWorkspaceId: myWorkspaceId });
    const denied = await GET(new Request(`http://localhost/api/search?q=${TERM}&workspaceId=${otherWorkspaceId}`));
    expect(denied.status).toBe(404);
  });
});
