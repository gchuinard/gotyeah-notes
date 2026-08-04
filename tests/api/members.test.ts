import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from "vitest";

vi.mock("@/lib/session", () => ({ getSession: vi.fn() }));

import { getSession } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { seedUserWithWorkspace, seedMember } from "../helpers/seed";
import { _resetRateLimit, RATE_LIMIT_MAX_FAILURES } from "@/lib/rateLimit";
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
// Le compteur d'anti-énumération est en mémoire et PARTAGÉ par les fichiers de
// test : on repart de zéro à chaque cas, comme tests/api/login.test.ts.
beforeEach(() => _resetRateLimit());

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

describe("POST /members — anti-énumération (rate-limit + trace)", () => {
  const addUnknown = (asUser: string, tag: string) => {
    as(asUser);
    return membersPOST(
      jsonReq(`/api/workspaces/${workspaceId}/members`, "POST", {
        email: `inconnu-${tag}-${Math.random().toString(36).slice(2)}@x.tld`,
      }),
      P({ id: workspaceId })
    );
  };

  it("bloque en 429 avec Retry-After après N sondages sur des comptes inexistants", async () => {
    for (let i = 0; i < RATE_LIMIT_MAX_FAILURES; i++) {
      expect((await addUnknown(adminId, `a${i}`)).status).toBe(404);
    }
    const blocked = await addUnknown(adminId, "over");
    expect(blocked.status).toBe(429);
    expect(Number(blocked.headers.get("Retry-After"))).toBeGreaterThan(0);
  });

  it("n'affecte pas un usage normal : sous le seuil, les messages restent explicites", async () => {
    for (let i = 0; i < RATE_LIMIT_MAX_FAILURES - 1; i++) await addUnknown(adminId, `b${i}`);
    // Le message de typo doit rester lisible — c'est tout l'intérêt d'avoir
    // choisi le rate-limit plutôt qu'une réponse indifférenciée.
    const res = await addUnknown(adminId, "last");
    expect(res.status).toBe(404);
    expect((await res.json()).error).toContain("introuvable");
  });

  it("un ajout réussi remet le compteur à zéro", async () => {
    const invitee = await prisma.user.create({
      data: {
        email: `reset-${Date.now()}@x.tld`,
        firstName: "R",
        lastName: "S",
        displayName: "Reset",
        passwordHash: "not-a-real-hash",
      },
    });
    for (let i = 0; i < RATE_LIMIT_MAX_FAILURES - 1; i++) await addUnknown(adminId, `c${i}`);

    as(adminId);
    const ok = await membersPOST(
      jsonReq(`/api/workspaces/${workspaceId}/members`, "POST", { email: invitee.email }),
      P({ id: workspaceId })
    );
    expect(ok.status).toBe(200);

    // Sans le clearFailures, ce sondage serait le N-ième → 429.
    expect((await addUnknown(adminId, "after-success")).status).toBe(404);
  });

  it("les compteurs sont par utilisateur : un admin bloqué n'en bloque pas un autre", async () => {
    // Espace SÉPARÉ : ajouter un 2e admin à l'espace partagé casserait les cas
    // « dernier admin » qui suivent.
    const other = await seedUserWithWorkspace(`members-rl-${Date.now()}@x.tld`);
    for (let i = 0; i < RATE_LIMIT_MAX_FAILURES; i++) await addUnknown(adminId, `d${i}`);
    expect((await addUnknown(adminId, "blocked")).status).toBe(429);

    as(other.user.id);
    const res = await membersPOST(
      jsonReq(`/api/workspaces/${other.workspace.id}/members`, "POST", {
        email: `inconnu-other-${Date.now()}@x.tld`,
      }),
      P({ id: other.workspace.id })
    );
    expect(res.status).toBe(404);
  });

  it("le GET (liste des membres) n'est jamais limité", async () => {
    for (let i = 0; i < RATE_LIMIT_MAX_FAILURES + 2; i++) await addUnknown(adminId, `e${i}`);
    as(adminId);
    const res = await membersGET(
      req(`/api/workspaces/${workspaceId}/members`),
      P({ id: workspaceId })
    );
    expect(res.status).toBe(200);
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
