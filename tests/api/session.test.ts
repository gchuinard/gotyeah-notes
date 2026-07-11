import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createHash } from "crypto";
import { prisma } from "@/lib/prisma";
import { seedUserWithWorkspace } from "../helpers/seed";
import { createSession, deleteSession, setSessionWorkspace, hashToken } from "@/lib/session";

let userId: string;
let workspaceId: string;

beforeAll(async () => {
  const s = await seedUserWithWorkspace(`session-${Date.now()}@x.tld`);
  userId = s.user.id;
  workspaceId = s.workspace.id;
});
afterAll(async () => { await prisma.$disconnect(); });

describe("session — hachage du token (aucun token en clair en base)", () => {
  it("hashToken = sha256 hex déterministe, ≠ token", () => {
    expect(hashToken("abc")).toBe(createHash("sha256").update("abc").digest("hex"));
    expect(hashToken("abc")).toHaveLength(64);
    expect(hashToken("abc")).not.toBe("abc");
  });

  it("createSession stocke sha256(token), JAMAIS le token clair", async () => {
    const token = await createSession(userId);
    // aucune Session dont l'id == le token clair
    expect(await prisma.session.findUnique({ where: { id: token } })).toBeNull();
    // la Session existe sous l'id haché
    const s = await prisma.session.findUnique({ where: { id: hashToken(token) } });
    expect(s).not.toBeNull();
    expect(s!.userId).toBe(userId);
  });

  it("createSession(userId, workspaceId) pose currentWorkspaceId à la création", async () => {
    const token = await createSession(userId, workspaceId);
    const s = await prisma.session.findUnique({ where: { id: hashToken(token) } });
    expect(s!.currentWorkspaceId).toBe(workspaceId);
  });

  it("createSession purge les sessions expirées", async () => {
    await prisma.session.create({
      data: { id: hashToken(`exp-${Date.now()}`), userId, expiresAt: new Date(Date.now() - 1000) },
    });
    expect(await prisma.session.count({ where: { userId, expiresAt: { lt: new Date() } } })).toBeGreaterThan(0);
    await createSession(userId); // déclenche la purge opportuniste
    expect(await prisma.session.count({ where: { userId, expiresAt: { lt: new Date() } } })).toBe(0);
  });

  it("setSessionWorkspace met à jour via le hash", async () => {
    const token = await createSession(userId);
    await setSessionWorkspace(token, workspaceId);
    const s = await prisma.session.findUnique({ where: { id: hashToken(token) } });
    expect(s!.currentWorkspaceId).toBe(workspaceId);
  });

  it("deleteSession supprime via le hash", async () => {
    const token = await createSession(userId);
    await deleteSession(token);
    expect(await prisma.session.findUnique({ where: { id: hashToken(token) } })).toBeNull();
  });
});
