import { describe, it, expect, beforeEach, beforeAll, afterAll, vi } from "vitest";

// Mock PARTIEL : le module exporte aussi hashToken/createSession, dont dépendent
// des chemins réels — un mock total les remplacerait par undefined.
vi.mock("@/lib/session", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/session")>()),
  getSession: vi.fn(),
}));

// L'IdP est simulé en ENTIER : aucun test ne doit pouvoir joindre un Keycloak
// réel, encore moins celui de production — la route provisionne des identités.
vi.mock("@/lib/keycloak", () => ({
  keycloakAdminEnabled: vi.fn(() => true),
  listIdpAccounts: vi.fn(),
  provisionIdpAccount: vi.fn(),
  setIdpAccountEnabled: vi.fn(),
}));

import { getSession } from "@/lib/session";
import {
  keycloakAdminEnabled,
  listIdpAccounts,
  provisionIdpAccount,
  setIdpAccountEnabled,
} from "@/lib/keycloak";
import { prisma } from "@/lib/prisma";
import { _resetRateLimit } from "@/lib/rateLimit";
import { GET as idpGET } from "@/app/api/workspaces/[id]/idp/route";
import { POST as idpPOST } from "@/app/api/workspaces/[id]/members/[userId]/idp/route";
import { seedUserWithWorkspace, seedMember } from "../helpers/seed";

const mockGetSession = vi.mocked(getSession);
const mockEnabled = vi.mocked(keycloakAdminEnabled);
const mockList = vi.mocked(listIdpAccounts);
const mockProvision = vi.mocked(provisionIdpAccount);
const mockSetEnabled = vi.mocked(setIdpAccountEnabled);

let workspaceId: string;
let adminId: string;
let adminEmail: string;
let editorId: string;
let editorEmail: string;
let viewerId: string;
let outsiderId: string;
let serviceId: string;

const as = (userId: string) =>
  mockGetSession.mockResolvedValue({
    id: userId,
    email: "x@x.tld",
    displayName: "X",
    currentWorkspaceId: workspaceId,
    isService: false,
  });

const P = <T extends Record<string, string>>(params: T) => ({ params: Promise.resolve(params) });
const get = (url: string) => new Request(`http://localhost${url}`);
const post = (url: string, body: unknown) =>
  new Request(`http://localhost${url}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

const act = (targetId: string, body: unknown) =>
  idpPOST(post(`/api/workspaces/${workspaceId}/members/${targetId}/idp`, body), {
    params: Promise.resolve({ id: workspaceId, userId: targetId }),
  });

const directory = (entries: [string, { enabled: boolean; emailVerified: boolean; pending: boolean }][]) =>
  ({ ok: true as const, accounts: new Map(entries), truncated: false });

beforeAll(async () => {
  const seeded = await seedUserWithWorkspace(`idp-admin-${Date.now()}@x.tld`);
  adminId = seeded.user.id;
  adminEmail = seeded.user.email;
  workspaceId = seeded.workspace.id;

  const editor = await seedMember(workspaceId, "editor");
  editorId = editor.user.id;
  editorEmail = editor.user.email;
  viewerId = (await seedMember(workspaceId, "viewer")).user.id;
  outsiderId = (await seedUserWithWorkspace(`idp-out-${Date.now()}@x.tld`)).user.id;

  const service = await prisma.user.create({
    data: {
      email: `idp-svc-${Date.now()}@gotyeah.local`,
      firstName: "IA",
      lastName: "",
      displayName: "IA",
      passwordHash: "x",
      isService: true,
    },
  });
  serviceId = service.id;
  await prisma.membership.create({
    data: { userId: serviceId, workspaceId, role: "admin" },
  });
});

beforeEach(() => {
  _resetRateLimit();
  mockEnabled.mockReturnValue(true);
  mockList.mockResolvedValue(directory([]));
  mockProvision.mockResolvedValue({ status: "created" });
  mockSetEnabled.mockResolvedValue({ status: "suspended" });
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe("GET /idp — lecture d'état, admin seulement", () => {
  it("403 pour un éditeur et un lecteur, 404 pour un non-membre", async () => {
    for (const id of [editorId, viewerId]) {
      as(id);
      expect((await idpGET(get(""), P({ id: workspaceId }))).status).toBe(403);
    }
    as(outsiderId);
    expect((await idpGET(get(""), P({ id: workspaceId }))).status).toBe(404);
  });

  it("non configuré : on le DIT, et l'IdP n'est jamais interrogé", async () => {
    mockEnabled.mockReturnValue(false);
    as(adminId);
    const body = await (await idpGET(get(""), P({ id: workspaceId }))).json();
    expect(body).toMatchObject({ configured: false, available: false, accounts: [] });
    expect(mockList).not.toHaveBeenCalled();
  });

  it("IdP injoignable : available=false plutôt qu'une liste de « aucun compte »", async () => {
    // Un état absent ne doit jamais se lire comme un état vérifié.
    mockList.mockResolvedValue({ ok: false, reason: "list_503" });
    as(adminId);
    const body = await (await idpGET(get(""), P({ id: workspaceId }))).json();
    expect(body).toMatchObject({ configured: true, available: false, accounts: [] });
  });

  it("croise les membres par email et distingue actif / en attente / suspendu", async () => {
    mockList.mockResolvedValue(
      directory([
        [adminEmail, { enabled: true, emailVerified: true, pending: false }],
        [editorEmail, { enabled: false, emailVerified: true, pending: false }],
      ])
    );
    as(adminId);
    const body = await (await idpGET(get(""), P({ id: workspaceId }))).json();
    const byId = Object.fromEntries(
      body.accounts.map((a: { userId: string; status: string }) => [a.userId, a.status])
    );
    expect(byId[adminId]).toBe("active");
    expect(byId[editorId]).toBe("suspended");
    // Le lecteur n'a pas de compte, et l'annuaire est complet : « aucun ».
    expect(byId[viewerId]).toBe("none");
  });

  it("⚠️ annuaire tronqué : « non vérifié », JAMAIS « aucun compte »", async () => {
    // Sinon l'admin cliquerait « créer » sur quelqu'un qui a déjà un compte, et
    // fabriquerait un doublon d'identité dans un realm partagé.
    mockList.mockResolvedValue({ ok: true, accounts: new Map(), truncated: true });
    as(adminId);
    const body = await (await idpGET(get(""), P({ id: workspaceId }))).json();
    expect(body.truncated).toBe(true);
    const statuses = body.accounts.map((a: { status: string }) => a.status);
    expect(statuses.every((s: string) => s === "unknown" || s === "none")).toBe(true);
    expect(statuses).toContain("unknown");
  });

  it("un compte de service est marqué comme tel — on ne lui cherche pas d'identité", async () => {
    as(adminId);
    const body = await (await idpGET(get(""), P({ id: workspaceId }))).json();
    const svc = body.accounts.find((a: { userId: string }) => a.userId === serviceId);
    expect(svc).toMatchObject({ service: true, status: "none" });
  });
});

describe("POST /idp — gardes avant toute action", () => {
  it("404 si la cible n'est pas membre de CET espace", async () => {
    as(adminId);
    expect((await act(outsiderId, { action: "create" })).status).toBe(404);
    expect(mockProvision).not.toHaveBeenCalled();
  });

  it("409 sur un compte de service : il n'a pas de boîte mail", async () => {
    as(adminId);
    const res = await act(serviceId, { action: "create" });
    expect(res.status).toBe(409);
    expect(mockProvision).not.toHaveBeenCalled();
  });

  it("409 quand l'IdP n'est pas configuré — pas un bouton fantôme", async () => {
    mockEnabled.mockReturnValue(false);
    as(adminId);
    expect((await act(editorId, { action: "create" })).status).toBe(409);
    expect(mockProvision).not.toHaveBeenCalled();
  });

  it("400 sur une action inconnue", async () => {
    as(adminId);
    expect((await act(editorId, { action: "delete" })).status).toBe(400);
  });
});

describe("POST /idp — suspension", () => {
  it("⚠️ personne ne suspend son PROPRE accès (verrouillage : LEGACY_LOGIN=off en prod)", async () => {
    as(adminId);
    const res = await act(adminId, { action: "suspend", confirmEmail: adminEmail });
    expect(res.status).toBe(409);
    expect(mockSetEnabled).not.toHaveBeenCalled();
  });

  it("400 sans confirmation, et 400 si l'adresse recopiée ne correspond pas", async () => {
    as(adminId);
    expect((await act(editorId, { action: "suspend" })).status).toBe(400);
    expect((await act(editorId, { action: "suspend", confirmEmail: "autre@x.tld" })).status).toBe(400);
    expect(mockSetEnabled).not.toHaveBeenCalled();
  });

  it("l'adresse recopiée est comparée NORMALISÉE (casse et espaces)", async () => {
    as(adminId);
    const res = await act(editorId, {
      action: "suspend",
      confirmEmail: `  ${editorEmail.toUpperCase()} `,
    });
    expect(res.status).toBe(200);
    expect(mockSetEnabled).toHaveBeenCalledWith(editorEmail, false);
  });

  it("réactiver ne demande aucune confirmation — l'action rend un accès", async () => {
    mockSetEnabled.mockResolvedValue({ status: "resumed" });
    as(adminId);
    const res = await act(editorId, { action: "resume" });
    expect(res.status).toBe(200);
    expect(mockSetEnabled).toHaveBeenCalledWith(editorEmail, true);
  });
});

describe("POST /idp — plafonds d'envoi", () => {
  it("⚠️ la création consomme le budget par DESTINATAIRE", async () => {
    // L'email d'activation est émis par Keycloak, donc il échappe à
    // lib/mailer : sans ce passage, ce bouton rouvrirait le canal d'envoi vers
    // l'adresse d'un tiers que RECIPIENT_BUDGET a fermé.
    as(adminId);
    let refus = 0;
    for (let i = 0; i < 8; i++) {
      const res = await act(editorId, { action: "create" });
      if (res.status === 429) refus++;
    }
    expect(refus).toBeGreaterThan(0);
    // RECIPIENT_BUDGET vaut 5/h : au-delà, on n'appelle plus l'IdP du tout.
    expect(mockProvision.mock.calls.length).toBeLessThanOrEqual(5);
  });

  it("suspendre et réactiver ne consomment AUCUN budget d'envoi (aucun email)", async () => {
    mockSetEnabled.mockResolvedValue({ status: "resumed" });
    as(adminId);
    for (let i = 0; i < 8; i++) {
      expect((await act(editorId, { action: "resume" })).status).toBe(200);
    }
  });
});
