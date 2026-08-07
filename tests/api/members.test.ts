import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from "vitest";

// Mock PARTIEL : seul getSession est simulé. Le module exporte aussi hashToken
// et createSession, dont dépendent des chemins réels (ex. les jetons de
// connexion par email) — un mock total les remplacerait par undefined.
vi.mock("@/lib/session", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/session")>()),
  getSession: vi.fn(),
}));

import { getSession } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { seedUserWithWorkspace, seedMember } from "../helpers/seed";
import { _resetRateLimit, RATE_LIMIT_MAX_FAILURES, INVITE_BUDGET } from "@/lib/rateLimit";
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
    isService: false,
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
  it("⚠️ un compte existant est INVITÉ, pas ajouté d'office (casse normalisée)", async () => {
    // Changement de contrat du 07/08 : plus de Membership immédiate. La personne
    // décide depuis sa cloche — et ce comportement était le tremplin de
    // l'escalade trouvée sur les comptes SSO.
    as(adminId);
    const res = await membersPOST(
      jsonReq(`/api/workspaces/${workspaceId}/members`, "POST", {
        email: outsiderEmail.toUpperCase(),
      }),
      P({ id: workspaceId })
    );
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.status).toBe("invited");
    expect(body.role).toBe("viewer");

    // Rien n'est accordé tant qu'elle n'a pas accepté.
    expect(
      await prisma.membership.findUnique({
        where: { userId_workspaceId: { userId: outsiderId, workspaceId } },
      })
    ).toBeNull();
  });

  it("déjà membre → 409", async () => {
    as(adminId);
    // Il faut donc une VRAIE membership pour éprouver ce cas.
    await prisma.membership.create({
      data: { userId: outsiderId, workspaceId, role: "viewer" },
    });
    const res = await membersPOST(
      jsonReq(`/api/workspaces/${workspaceId}/members`, "POST", { email: outsiderEmail }),
      P({ id: workspaceId })
    );
    expect(res.status).toBe(409);
  });

  it("email sans compte → 201 invitation (le 404 historique a disparu)", async () => {
    as(adminId);
    const res = await membersPOST(
      jsonReq(`/api/workspaces/${workspaceId}/members`, "POST", { email: "inconnu@x.tld" }),
      P({ id: workspaceId })
    );
    // Avant les invitations, cette route répondait 404 « le compte doit d'abord
    // exister ». Elle pré-autorise désormais l'email : cf. tests/api/invitations.test.ts.
    expect(res.status).toBe(201);
    expect((await res.json()).status).toBe("invited");
  });
});

describe("POST /members — plafond des invitations (rate-limit + trace)", () => {
  // Depuis les invitations, un email inconnu n'est plus un ÉCHEC (404) mais un
  // SUCCÈS (201 pré-autorisé). Le plafond existe toujours — c'est le seul frein
  // au sondage d'emails — mais il vit dans sa propre famille de clés, avec son
  // budget et son message : cf. INVITE_BUDGET et lib/rateLimit.ts.
  const addUnknown = (asUser: string, tag: string, workspace = workspaceId) => {
    as(asUser);
    return membersPOST(
      jsonReq(`/api/workspaces/${workspace}/members`, "POST", {
        email: `inconnu-${tag}-${Math.random().toString(36).slice(2)}@x.tld`,
      }),
      P({ id: workspace })
    );
  };

  it("bloque en 429 avec Retry-After au-delà du budget d'invitations", async () => {
    for (let i = 0; i < INVITE_BUDGET.max; i++) {
      expect((await addUnknown(adminId, `a${i}`)).status).toBe(201);
    }
    const blocked = await addUnknown(adminId, "over");
    expect(blocked.status).toBe(429);
    expect(Number(blocked.headers.get("Retry-After"))).toBeGreaterThan(0);
  });

  it("le budget d'invitations est plus large que celui du login", async () => {
    // Régression de conception : réutiliser le budget du login (8/15 min) ferait
    // qu'inviter une équipe de 10 déclencherait un 429 au message mensonger.
    expect(INVITE_BUDGET.max).toBeGreaterThan(RATE_LIMIT_MAX_FAILURES);
    for (let i = 0; i < RATE_LIMIT_MAX_FAILURES + 1; i++) {
      expect((await addUnknown(adminId, `b${i}`)).status).toBe(201);
    }
  });

  it("les compteurs sont par utilisateur : un admin bloqué n'en bloque pas un autre", async () => {
    // Espace SÉPARÉ : ajouter un 2e admin à l'espace partagé casserait les cas
    // « dernier admin » qui suivent.
    const other = await seedUserWithWorkspace(`members-rl-${Date.now()}@x.tld`);
    for (let i = 0; i < INVITE_BUDGET.max; i++) await addUnknown(adminId, `d${i}`);
    expect((await addUnknown(adminId, "blocked")).status).toBe(429);

    expect((await addUnknown(other.user.id, "other", other.workspace.id)).status).toBe(201);
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
