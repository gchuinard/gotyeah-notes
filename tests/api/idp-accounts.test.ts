import { describe, it, expect, beforeEach, beforeAll, afterAll, afterEach, vi } from "vitest";

// Mock PARTIEL : le module exporte aussi hashToken/createSession, dont dépendent
// des chemins réels — un mock total les remplacerait par undefined.
vi.mock("@/lib/session", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/session")>()),
  getSession: vi.fn(),
}));

/**
 * Mock PARTIEL de l'IdP : seules les trois fonctions qui parlent RÉSEAU sont
 * simulées — aucun test ne doit pouvoir joindre un Keycloak réel, encore moins
 * celui de production.
 *
 * ⚠️ `keycloakAdminEnabled` et surtout `isIdpAdmin` restent RÉELS : ils ne
 * lisent que process.env, et ce sont eux qu'on veut mettre à l'épreuve. Les
 * mocker reviendrait à tester le mock au lieu de la garde.
 */
vi.mock("@/lib/keycloak", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/keycloak")>()),
  listIdpAccounts: vi.fn(),
  provisionIdpAccount: vi.fn(),
  setIdpAccountEnabled: vi.fn(),
}));

import { getSession } from "@/lib/session";
import { listIdpAccounts, provisionIdpAccount, setIdpAccountEnabled } from "@/lib/keycloak";
import { prisma } from "@/lib/prisma";
import { _resetRateLimit } from "@/lib/rateLimit";
import { GET as idpGET } from "@/app/api/workspaces/[id]/idp/route";
import { POST as idpPOST } from "@/app/api/workspaces/[id]/members/[userId]/idp/route";
import { POST as workspacesPOST } from "@/app/api/workspaces/route";
import { POST as membersPOST } from "@/app/api/workspaces/[id]/members/route";
import { seedUserWithWorkspace, seedMember } from "../helpers/seed";

const mockGetSession = vi.mocked(getSession);
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

/** L'email compte : c'est lui que `isIdpAdmin` regarde. */
const as = (userId: string, email = "x@x.tld") =>
  mockGetSession.mockResolvedValue({
    id: userId,
    email,
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

const act = (targetId: string, body: unknown, ws = workspaceId) =>
  idpPOST(post(`/api/workspaces/${ws}/members/${targetId}/idp`, body), {
    params: Promise.resolve({ id: ws, userId: targetId }),
  });

const directory = (
  entries: [string, { enabled: boolean; emailVerified: boolean; pending: boolean }][]
) => ({ ok: true as const, accounts: new Map(entries), truncated: false });

/** Configure l'instance : IdP joignable, et `who` autorisé à le piloter. */
function instanceConfigured(who: string) {
  vi.stubEnv("OIDC_ISSUER", "https://login.example.tld/realms/gotyeah");
  vi.stubEnv("KEYCLOAK_ADMIN_CLIENT_ID", "notes-provisioning");
  vi.stubEnv("KEYCLOAK_ADMIN_CLIENT_SECRET", "s3cret");
  vi.stubEnv("IDP_ADMIN_EMAILS", who);
}

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
  await prisma.membership.create({ data: { userId: serviceId, workspaceId, role: "admin" } });
});

beforeEach(() => {
  // Efface les COMPTEURS d'appels (pas les implémentations) : sans ça, les
  // assertions « appelé N fois » cumulent d'un test à l'autre.
  vi.clearAllMocks();
  _resetRateLimit();
  instanceConfigured(adminEmail);
  mockList.mockResolvedValue(directory([]));
  mockProvision.mockResolvedValue({ status: "created" });
  mockSetEnabled.mockResolvedValue({ status: "suspended" });
});

afterEach(() => vi.unstubAllEnvs());
afterAll(async () => {
  await prisma.$disconnect();
});

// ─── La garde qui tient : l'autorité d'instance ──────────────────────────────

describe("⚠️ Escalade — le rôle admin d'un espace est AUTO-ATTRIBUABLE", () => {
  it("un lecteur ne peut PAS se fabriquer le droit de suspendre le SSO d'un tiers", async () => {
    // Chaîne trouvée en revue adversariale, reproduite ici de bout en bout :
    //   1. POST /api/workspaces — aucun gate de rôle, le créateur devient admin
    //   2. POST /members {email: victime} — Membership IMMÉDIATE, sans consentement
    //   3. POST .../idp {suspend} — « admin de l'espace » et « cible membre »
    //      sont alors tous deux satisfaits.
    // Sans l'allowlist d'instance, l'étape 3 coupait la connexion Keycloak de la
    // victime sur TOUS les sites du realm partagé.
    const attaquant = await seedMember(workspaceId, "viewer");
    instanceConfigured(adminEmail); // l'attaquant n'y figure pas
    as(attaquant.user.id, attaquant.user.email);

    // 1. Son propre espace — il en ressort admin.
    const wsRes = await workspacesPOST(post("/api/workspaces", { name: "piege" }));
    expect(wsRes.status).toBe(200);
    const ws = await wsRes.json();

    // 2. La victime y est ajoutée de force (elle a déjà un compte notes).
    const addRes = await membersPOST(
      post(`/api/workspaces/${ws.id}/members`, { email: adminEmail, role: "viewer" }),
      P({ id: ws.id })
    );
    expect(addRes.status).toBe(200);
    expect((await addRes.json()).userId).toBe(adminId);

    // 3. La suspension DOIT être refusée — c'est tout l'objet de la garde.
    const res = await act(adminId, { action: "suspend", confirmEmail: adminEmail }, ws.id);
    expect(res.status).toBe(403);
    expect(mockSetEnabled).not.toHaveBeenCalled();
  });

  it("`resume` est gardé comme `suspend` — rendre un accès est aussi une décision", async () => {
    // Sans ça, la seule action non protégée annulait une désactivation décidée
    // ailleurs (offboarding d'un autre site du realm).
    const attaquant = await seedMember(workspaceId, "viewer");
    as(attaquant.user.id, attaquant.user.email);
    const ws = await (await workspacesPOST(post("/api/workspaces", { name: "p2" }))).json();
    await membersPOST(
      post(`/api/workspaces/${ws.id}/members`, { email: adminEmail, role: "viewer" }),
      P({ id: ws.id })
    );
    expect((await act(adminId, { action: "resume" }, ws.id)).status).toBe(403);
    expect(mockSetEnabled).not.toHaveBeenCalled();
  });

  it("⚠️ `IDP_ADMIN_EMAILS` vide = PERSONNE, jamais « tout le monde »", async () => {
    // Le défaut inverse est celui qui a rendu MCP_ACT_AS_ALLOWLIST inerte trois
    // semaines : variable présente, valeur vide, diff vert.
    vi.stubEnv("IDP_ADMIN_EMAILS", "");
    as(adminId, adminEmail);
    expect((await act(editorId, { action: "create" })).status).toBe(403);

    const body = await (await idpGET(get(""), P({ id: workspaceId }))).json();
    expect(body.allowed).toBe(false);
    expect(mockList).not.toHaveBeenCalled();
  });

  it("l'allowlist est comparée NORMALISÉE, et n'accepte pas un préfixe", async () => {
    vi.stubEnv("IDP_ADMIN_EMAILS", ` ${adminEmail.toUpperCase()} , autre@x.tld `);
    as(adminId, adminEmail);
    expect((await act(editorId, { action: "create" })).status).toBe(200);

    // « admin@x.tld » ne doit pas ouvrir la porte à « admin@x.tld.evil ».
    as(editorId, `${adminEmail}.evil`);
    expect((await act(viewerId, { action: "create" })).status).toBe(403);
  });
});

// ─── Lecture d'état ──────────────────────────────────────────────────────────

describe("GET /idp — lecture d'état, admin de l'espace ET de l'instance", () => {
  it("403 pour un éditeur et un lecteur, 404 pour un non-membre", async () => {
    for (const id of [editorId, viewerId]) {
      as(id);
      expect((await idpGET(get(""), P({ id: workspaceId }))).status).toBe(403);
    }
    as(outsiderId);
    expect((await idpGET(get(""), P({ id: workspaceId }))).status).toBe(404);
  });

  it("non configuré : on le DIT, et l'IdP n'est jamais interrogé", async () => {
    vi.stubEnv("KEYCLOAK_ADMIN_CLIENT_ID", "");
    as(adminId, adminEmail);
    const body = await (await idpGET(get(""), P({ id: workspaceId }))).json();
    expect(body).toMatchObject({ configured: false, available: false, accounts: [] });
    expect(mockList).not.toHaveBeenCalled();
  });

  it("IdP injoignable : available=false plutôt qu'une liste de « aucun compte »", async () => {
    // Un état absent ne doit jamais se lire comme un état vérifié.
    mockList.mockResolvedValue({ ok: false, reason: "list_503" });
    as(adminId, adminEmail);
    const body = await (await idpGET(get(""), P({ id: workspaceId }))).json();
    expect(body).toMatchObject({ configured: true, allowed: true, available: false, accounts: [] });
  });

  it("croise les membres par email et distingue actif / en attente / suspendu", async () => {
    mockList.mockResolvedValue(
      directory([
        [adminEmail, { enabled: true, emailVerified: true, pending: false }],
        [editorEmail, { enabled: false, emailVerified: true, pending: false }],
      ])
    );
    as(adminId, adminEmail);
    const body = await (await idpGET(get(""), P({ id: workspaceId }))).json();
    const byId = Object.fromEntries(
      body.accounts.map((a: { userId: string; status: string }) => [a.userId, a.status])
    );
    expect(byId[adminId]).toBe("active");
    expect(byId[editorId]).toBe("suspended");
    expect(byId[viewerId]).toBe("none");
  });

  it("⚠️ annuaire tronqué : « non vérifié », JAMAIS « aucun compte »", async () => {
    // Sinon l'admin cliquerait « créer » sur quelqu'un qui a déjà un compte, et
    // fabriquerait un doublon d'identité dans un realm partagé.
    mockList.mockResolvedValue({ ok: true, accounts: new Map(), truncated: true });
    as(adminId, adminEmail);
    const body = await (await idpGET(get(""), P({ id: workspaceId }))).json();
    expect(body.truncated).toBe(true);
    const statuses = body.accounts.map((a: { status: string }) => a.status);
    expect(statuses).toContain("unknown");
  });

  it("un compte de service est marqué comme tel — on ne lui cherche pas d'identité", async () => {
    as(adminId, adminEmail);
    const body = await (await idpGET(get(""), P({ id: workspaceId }))).json();
    const svc = body.accounts.find((a: { userId: string }) => a.userId === serviceId);
    expect(svc).toMatchObject({ service: true, status: "none" });
  });
});

// ─── Actions ─────────────────────────────────────────────────────────────────

describe("POST /idp — gardes avant toute action", () => {
  beforeEach(() => as(adminId, adminEmail));

  it("404 si la cible n'est pas membre de CET espace", async () => {
    expect((await act(outsiderId, { action: "create" })).status).toBe(404);
    expect(mockProvision).not.toHaveBeenCalled();
  });

  it("409 sur un compte de service : il n'a pas de boîte mail", async () => {
    expect((await act(serviceId, { action: "create" })).status).toBe(409);
    expect(mockProvision).not.toHaveBeenCalled();
  });

  it("409 quand l'IdP n'est pas configuré — pas un bouton fantôme", async () => {
    vi.stubEnv("KEYCLOAK_ADMIN_CLIENT_ID", "");
    expect((await act(editorId, { action: "create" })).status).toBe(409);
    expect(mockProvision).not.toHaveBeenCalled();
  });

  it("400 sur une action inconnue", async () => {
    expect((await act(editorId, { action: "delete" })).status).toBe(400);
  });
});

describe("POST /idp — suspension", () => {
  beforeEach(() => as(adminId, adminEmail));

  it("⚠️ personne ne suspend son PROPRE accès (verrouillage : LEGACY_LOGIN=off en prod)", async () => {
    const res = await act(adminId, { action: "suspend", confirmEmail: adminEmail });
    expect(res.status).toBe(409);
    expect(mockSetEnabled).not.toHaveBeenCalled();
  });

  it("400 sans confirmation, et 400 si l'adresse recopiée ne correspond pas", async () => {
    expect((await act(editorId, { action: "suspend" })).status).toBe(400);
    expect((await act(editorId, { action: "suspend", confirmEmail: "autre@x.tld" })).status).toBe(400);
    expect(mockSetEnabled).not.toHaveBeenCalled();
  });

  it("l'adresse recopiée est comparée NORMALISÉE (casse et espaces)", async () => {
    const res = await act(editorId, {
      action: "suspend",
      confirmEmail: `  ${editorEmail.toUpperCase()} `,
    });
    expect(res.status).toBe(200);
    expect(mockSetEnabled).toHaveBeenCalledWith(editorEmail, false);
  });

  it("réactiver ne demande aucune confirmation — l'action rend un accès", async () => {
    mockSetEnabled.mockResolvedValue({ status: "resumed" });
    expect((await act(editorId, { action: "resume" })).status).toBe(200);
    expect(mockSetEnabled).toHaveBeenCalledWith(editorEmail, true);
  });
});

describe("POST /idp — plafonds d'envoi", () => {
  beforeEach(() => as(adminId, adminEmail));

  it("⚠️ la création consomme le budget par DESTINATAIRE", async () => {
    // L'email d'activation est émis par Keycloak, donc il échappe à lib/mailer :
    // sans ce passage, ce bouton rouvrirait le canal d'envoi vers l'adresse d'un
    // tiers que RECIPIENT_BUDGET a fermé.
    let refus = 0;
    for (let i = 0; i < 8; i++) {
      if ((await act(editorId, { action: "create" })).status === 429) refus++;
    }
    expect(refus).toBeGreaterThan(0);
    expect(mockProvision.mock.calls.length).toBeLessThanOrEqual(5);
  });

  it("⚠️ un appel qui n'envoie AUCUN email ne consomme pas le budget de l'adresse", async () => {
    // `existing` n'envoie rien. Le compter ferait que cinq clics sans effet
    // bloqueraient ensuite les invitations légitimes vers cette personne — le
    // budget est partagé avec POST /members.
    mockProvision.mockResolvedValue({ status: "existing" });
    for (let i = 0; i < 8; i++) {
      expect((await act(editorId, { action: "create" })).status).toBe(200);
    }
    expect(mockProvision).toHaveBeenCalledTimes(8);
  });

  it("suspendre et réactiver ne consomment AUCUN budget d'envoi (aucun email)", async () => {
    mockSetEnabled.mockResolvedValue({ status: "resumed" });
    for (let i = 0; i < 8; i++) {
      expect((await act(editorId, { action: "resume" })).status).toBe(200);
    }
  });
});
