import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";

// On mocke uniquement l'authentification : getSession lit les cookies via
// next/headers (indisponible hors runtime Next). Le reste du handler — accès,
// requêtes Prisma — tourne pour de vrai contre la DB de test.
vi.mock("@/lib/session", () => ({ getSession: vi.fn() }));

import { getSession } from "@/lib/session";
import { GET } from "@/app/api/pages/route";
import { prisma } from "@/lib/prisma";
import { seedUserWithWorkspace } from "../helpers/seed";

const mockGetSession = vi.mocked(getSession);

describe("GET /api/pages", () => {
  let userId: string;
  let workspaceId: string;

  beforeAll(async () => {
    const seeded = await seedUserWithWorkspace();
    userId = seeded.user.id;
    workspaceId = seeded.workspace.id;
    await prisma.page.create({
      data: {
        title: "Ma page de test",
        workspaceId,
        ownerId: userId,
        visibility: "team",
        position: 1000,
      },
    });
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("répond 401 sans session", async () => {
    mockGetSession.mockResolvedValueOnce(null);
    const res = await GET(new Request("http://localhost/api/pages"));
    expect(res.status).toBe(401);
  });

  it("répond 200 avec la page du workspace pour une session valide", async () => {
    mockGetSession.mockResolvedValueOnce({
      id: userId,
      email: "test@example.com",
      displayName: "Test User",
      currentWorkspaceId: workspaceId,
    });
    const res = await GET(new Request(`http://localhost/api/pages?workspaceId=${workspaceId}`));
    expect(res.status).toBe(200);
    const body = (await res.json()) as Array<{ title: string }>;
    expect(Array.isArray(body)).toBe(true);
    expect(body.some((p) => p.title === "Ma page de test")).toBe(true);
  });
});
