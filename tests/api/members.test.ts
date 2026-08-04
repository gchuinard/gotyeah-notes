import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";

vi.mock("@/lib/session", () => ({ getSession: vi.fn() }));

import { getSession } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { seedUserWithWorkspace, seedMember } from "../helpers/seed";
import { GET as membersGET, POST as membersPOST } from "@/app/api/workspaces/[id]/members/route";
import { PATCH as memberPATCH, DELETE as memberDELETE } from "@/app/api/workspaces/[id]/members/[userId]/route";

const mockGetSession = vi.mocked(getSession);

let workspaceId: string;
let adminId: string;
let editorId: string;
let viewerId: string;
let outsiderEmail: string;
let outsiderId: string;

const as = (userId: string) =>
  mockGetSession.mockResolvedValue({
    id: userId,
    email: "x@x.tld",
    displayName: "X",
    currentWorkspaceId: workspaceId,
  });

// Générique : le type des params est INFÉRÉ à l'appel (cf. role-gates.test.ts).
const P = <T extends Record<string, string>>(params: T) => ({ params: Promise.resolve(params) });
const jsonReq = (url: string, method: string, body: unknown) =>
  new Request(`http://localhost${url}`, {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
const req = (url: string, method = "GET") => new Request(`http://localhost${url}`, { method });

beforeAll(async () => {
  const seeded = await seedUserWithWorkspace(`members-admin-${Date.now()}@x.tld`);
  adminId = seeded.user.id;
  workspaceId = seeded.workspace.id;
  editorId = (await seedMember(workspaceId, "editor")).user.id;
  viewerId = (await seedMember(workspaceId, "viewer")).user.id;

  // Compte existant SANS membership ici : la cible type d'un ajout.
  outsiderEmail = `outsider-${Date.now()}@x.tld`;
  outsiderId = (
    await prisma.user.create({
      data: {
        email: outsiderEmail,
        firstName: "Out",
        lastName: "Sider",
        displayName: "Outsider",
        passwordHash: "not-a-real-hash",
      },
    })
  ).id;
});
afterAll(async () => {
  await prisma.$disconnect();
});

describe("GET /api/workspaces/[id]/members", () => {
  it("liste les membres et leurs rôles — ouverte à tout membre, même lecteur", async () => {
    as(viewerId);
    const res = await membersGET(req(`/api/workspaces/${workspaceId}/members`), P({ id: workspaceId }));
    expect(res.status).toBe(200);
    const members = await res.json();
    const roleOf = Object.fromEntries(members.map((m: { userId: string; role: string }) => [m.userId, m.role]));
    expect(roleOf[adminId]).toBe("admin");
    expect(roleOf[editorId]).toBe("editor");
    expect(roleOf[viewerId]).toBe("viewer");
  });

  it("non-membre → 404 (anti-leak)", async () => {
    as(outsiderId);
    const res = await membersGET(req(`/api/workspaces/${workspaceId}/members`), P({ id: workspaceId }));
    expect(res.status).toBe(404);
  });
});

describe("POST /api/workspaces/[id]/members (ajout par email)", () => {
  it("admin ajoute un compte existant — email normalisé (casse), lecteur par défaut", async () => {
    as(adminId);
    // La casse est normalisée serveur (normalizeEmail) ; le trim est fait côté
    // client — zod .email() refuse un email non trimé, c'est voulu.
    const res = await membersPOST(
      jsonReq(`/api/workspaces/${workspaceId}/members`, "POST", {
        email: outsiderEmail.toUpperCase(),
      }),
      P({ id: workspaceId })
    );
    expect(res.status).toBe(200);
    const member = await res.json();
    expect(member.userId).toBe(outsiderId);
    expect(member.role).toBe("viewer");
  });

  it("déjà membre → 409", async () => {
    as(adminId);
    const res = await membersPOST(
      jsonReq(`/api/workspaces/${workspaceId}/members`, "POST", { email: outsiderEmail }),
      P({ id: workspaceId })
    );
    expect(res.status).toBe(409);
  });

  it("email sans compte → 404 explicite", async () => {
    as(adminId);
    const res = await membersPOST(
      jsonReq(`/api/workspaces/${workspaceId}/members`, "POST", { email: "inconnu@x.tld" }),
      P({ id: workspaceId })
    );
    expect(res.status).toBe(404);
  });
});

describe("PATCH / DELETE /api/workspaces/[id]/members/[userId]", () => {
  it("admin change un rôle", async () => {
    as(adminId);
    const res = await memberPATCH(
      jsonReq(`/api/workspaces/${workspaceId}/members/${outsiderId}`, "PATCH", { role: "editor" }),
      P({ id: workspaceId, userId: outsiderId })
    );
    expect(res.status).toBe(200);
    expect((await res.json()).role).toBe("editor");
  });

  it("cible non membre → 404", async () => {
    const ghost = await prisma.user.create({
      data: {
        email: `ghost-${Date.now()}@x.tld`,
        firstName: "G",
        lastName: "H",
        displayName: "Ghost",
        passwordHash: "not-a-real-hash",
      },
    });
    as(adminId);
    const res = await memberPATCH(
      jsonReq(`/api/workspaces/${workspaceId}/members/${ghost.id}`, "PATCH", { role: "viewer" }),
      P({ id: workspaceId, userId: ghost.id })
    );
    expect(res.status).toBe(404);
  });

  it("rétrograder le DERNIER admin → 409 (transactionnel)", async () => {
    as(adminId);
    const res = await memberPATCH(
      jsonReq(`/api/workspaces/${workspaceId}/members/${adminId}`, "PATCH", { role: "editor" }),
      P({ id: workspaceId, userId: adminId })
    );
    expect(res.status).toBe(409);
    // Rien n'a bougé : l'espace garde son admin.
    const m = await prisma.membership.findUnique({
      where: { userId_workspaceId: { userId: adminId, workspaceId } },
    });
    expect(m?.role).toBe("admin");
  });

  it("retirer le DERNIER admin → 409, même par lui-même", async () => {
    as(adminId);
    const res = await memberDELETE(
      req(`/api/workspaces/${workspaceId}/members/${adminId}`, "DELETE"),
      P({ id: workspaceId, userId: adminId })
    );
    expect(res.status).toBe(409);
  });

  it("un membre quitte l'espace (DELETE sa propre membership), sans être admin", async () => {
    as(outsiderId);
    const res = await memberDELETE(
      req(`/api/workspaces/${workspaceId}/members/${outsiderId}`, "DELETE"),
      P({ id: workspaceId, userId: outsiderId })
    );
    expect(res.status).toBe(200);
    const m = await prisma.membership.findUnique({
      where: { userId_workspaceId: { userId: outsiderId, workspaceId } },
    });
    expect(m).toBeNull();
  });

  it("admin retire un membre", async () => {
    as(adminId);
    const res = await memberDELETE(
      req(`/api/workspaces/${workspaceId}/members/${viewerId}`, "DELETE"),
      P({ id: workspaceId, userId: viewerId })
    );
    expect(res.status).toBe(200);
  });
});
