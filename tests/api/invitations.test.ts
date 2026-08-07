import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from "vitest";
import { readFileSync } from "node:fs";

// Mock PARTIEL : seul getSession est simulé. Le module exporte aussi hashToken
// et createSession, dont dépendent des chemins réels (ex. les jetons de
// connexion par email) — un mock total les remplacerait par undefined.
vi.mock("@/lib/session", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/session")>()),
  getSession: vi.fn(),
}));

import { getSession } from "@/lib/session";
import { GET as listMembers, POST as addMember } from "@/app/api/workspaces/[id]/members/route";
import { prisma } from "@/lib/prisma";
import {
  claimInvitations,
  claimInvitationsSafely,
  hasPendingInvitation,
  INVITATION_TTL_DAYS,
} from "@/lib/invitations";
import { updateMemberRole, removeMember } from "@/lib/workspace";
import { _resetRateLimit, INVITE_BUDGET, RECIPIENT_BUDGET } from "@/lib/rateLimit";
import { seedUserWithWorkspace, seedMember } from "../helpers/seed";

const mockGetSession = vi.mocked(getSession);

let admin: { id: string };
let workspaceId: string;

const asUser = (id: string) =>
  mockGetSession.mockResolvedValue({
    id,
    email: "x",
    displayName: "X",
    currentWorkspaceId: workspaceId,
    isService: false,
  });

const withId = (id: string) => ({ params: Promise.resolve({ id }) });
const post = (body: unknown) =>
  new Request("http://x/", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

/** Crée un compte SANS membership — le futur invité. */
async function mkUser(email: string, isService = false) {
  return prisma.user.create({
    data: {
      email,
      firstName: "In",
      lastName: "Vité",
      displayName: "Invité",
      passwordHash: "x",
      isService,
    },
  });
}

beforeAll(async () => {
  const seeded = await seedUserWithWorkspace(`inv-admin-${Date.now()}@x.tld`);
  admin = seeded.user;
  workspaceId = seeded.workspace.id;
});

beforeEach(() => {
  _resetRateLimit();
  asUser(admin.id);
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe("POST /members — email sans compte", () => {
  it("crée une invitation (201) au lieu du 404 historique", async () => {
    const email = `futur-${Date.now()}@x.tld`;
    const res = await addMember(post({ email, role: "editor" }), withId(workspaceId));

    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.status).toBe("invited");
    expect(body.role).toBe("editor");

    const row = await prisma.workspaceInvitation.findUnique({
      where: { workspaceId_email: { workspaceId, email } },
    });
    expect(row?.invitedBy).toBe(admin.id);
  });

  it("normalise l'email : invité en casse mixte, réclamé en minuscules", async () => {
    const raw = `  MiXtE-${Date.now()}@X.TLD  `;
    await addMember(post({ email: raw, role: "viewer" }), withId(workspaceId));

    const stored = await prisma.workspaceInvitation.findFirst({
      where: { workspaceId, invitedBy: admin.id, role: "viewer" },
      orderBy: { createdAt: "desc" },
    });
    expect(stored?.email).toBe(raw.trim().toLowerCase());

    // Sans normalisation des DEUX côtés, ce claim ne matcherait jamais.
    const u = await mkUser(raw.trim().toLowerCase());
    const { workspaceIds } = await claimInvitations(u.id, raw);
    expect(workspaceIds).toEqual([workspaceId]);
  });

  it("ré-inviter le même email met à jour le rôle, sans doublon", async () => {
    const email = `maj-${Date.now()}@x.tld`;
    await addMember(post({ email, role: "viewer" }), withId(workspaceId));
    const res = await addMember(post({ email, role: "admin" }), withId(workspaceId));
    expect(res.status).toBe(201);

    const rows = await prisma.workspaceInvitation.findMany({ where: { workspaceId, email } });
    expect(rows).toHaveLength(1);
    expect(rows[0].role).toBe("admin");
  });

  it("un compte existant devient membre immédiatement (non-régression)", async () => {
    const u = await mkUser(`direct-${Date.now()}@x.tld`);
    const res = await addMember(post({ email: u.email, role: "editor" }), withId(workspaceId));

    expect(res.status).toBe(200);
    expect((await res.json()).status).toBe("member");
    const m = await prisma.membership.findUnique({
      where: { userId_workspaceId: { userId: u.id, workspaceId } },
    });
    expect(m?.role).toBe("editor");
  });

  it("refuse un COMPTE DE SERVICE (409) : il verrait les pages privées de l'espace", async () => {
    const svc = await mkUser(`svc-${Date.now()}@gotyeah.local`, true);
    const res = await addMember(post({ email: svc.email }), withId(workspaceId));

    expect(res.status).toBe(409);
    expect((await res.json()).error).toMatch(/compte de service/i);
    expect(
      await prisma.membership.findUnique({
        where: { userId_workspaceId: { userId: svc.id, workspaceId } },
      })
    ).toBeNull();
  });

  it("un non-admin est refusé (403) avant tout effet", async () => {
    const viewer = await seedMember(workspaceId, "viewer");
    asUser(viewer.user.id);
    const email = `refuse-${Date.now()}@x.tld`;
    const res = await addMember(post({ email }), withId(workspaceId));

    expect(res.status).toBe(403);
    expect(
      await prisma.workspaceInvitation.findUnique({
        where: { workspaceId_email: { workspaceId, email } },
      })
    ).toBeNull();
  });
});

describe("Rate-limit — inviter est un SUCCÈS, pas un échec", () => {
  it("inviter 10 collègues d'affilée ne déclenche AUCUN 429", async () => {
    const stamp = Date.now();
    for (let i = 0; i < 10; i++) {
      const res = await addMember(post({ email: `equipe${i}-${stamp}@x.tld` }), withId(workspaceId));
      expect(res.status).toBe(201);
    }
  });

  it("au-delà du budget d'invitations, 429 au message honnête", async () => {
    const stamp = Date.now();
    for (let i = 0; i < INVITE_BUDGET.max; i++) {
      await addMember(post({ email: `flood${i}-${stamp}@x.tld` }), withId(workspaceId));
    }
    const res = await addMember(post({ email: `flood-last-${stamp}@x.tld` }), withId(workspaceId));

    expect(res.status).toBe(429);
    // La sémantique est testée, pas la cosmétique : le message ne doit plus
    // accuser l'admin de sonder des comptes inexistants.
    const { error } = await res.json();
    expect(error).toMatch(/invitations/i);
    expect(error).not.toMatch(/inexistants/i);
  });
});

describe("claimInvitations — matérialisation à la connexion", () => {
  it("crée la membership au rôle invité, et consomme l'invitation", async () => {
    const email = `claim-${Date.now()}@x.tld`;
    await addMember(post({ email, role: "editor" }), withId(workspaceId));
    const u = await mkUser(email);

    const { workspaceIds } = await claimInvitations(u.id, email);
    expect(workspaceIds).toEqual([workspaceId]);

    const m = await prisma.membership.findUnique({
      where: { userId_workspaceId: { userId: u.id, workspaceId } },
    });
    expect(m?.role).toBe("editor");
    expect(
      await prisma.workspaceInvitation.findUnique({
        where: { workspaceId_email: { workspaceId, email } },
      })
    ).toBeNull();
  });

  it("un rôle illisible en base retombe sur viewer, JAMAIS sur le @default(admin)", async () => {
    const email = `corrompu-${Date.now()}@x.tld`;
    await prisma.workspaceInvitation.create({
      data: { workspaceId, email, role: "sudo", invitedBy: admin.id },
    });
    const u = await mkUser(email);

    await claimInvitations(u.id, email);
    const m = await prisma.membership.findUnique({
      where: { userId_workspaceId: { userId: u.id, workspaceId } },
    });
    expect(m?.role).toBe("viewer");
  });

  it("idempotent : une invitation sur un espace déjà rejoint ne casse rien", async () => {
    const u = await mkUser(`deja-${Date.now()}@x.tld`);
    await prisma.membership.create({ data: { userId: u.id, workspaceId, role: "admin" } });
    await prisma.workspaceInvitation.create({
      data: { workspaceId, email: u.email, role: "viewer", invitedBy: admin.id },
    });

    await expect(claimInvitations(u.id, u.email)).resolves.toEqual({ workspaceIds: [] });
    // Le rôle EXISTANT prime : une invitation ne rétrograde pas un membre.
    const m = await prisma.membership.findUnique({
      where: { userId_workspaceId: { userId: u.id, workspaceId } },
    });
    expect(m?.role).toBe("admin");
    // …et l'invitation est consommée, sinon elle rejouerait à chaque connexion.
    expect(await prisma.workspaceInvitation.findMany({ where: { email: u.email } })).toHaveLength(0);
  });

  it("sans invitation, c'est un no-op (aucune membership fantôme)", async () => {
    const u = await mkUser(`vierge-${Date.now()}@x.tld`);
    await expect(claimInvitations(u.id, u.email)).resolves.toEqual({ workspaceIds: [] });
    expect(await prisma.membership.count({ where: { userId: u.id } })).toBe(0);
  });

  it("un claim qui échoue ne casse jamais l'authentification", async () => {
    // L'enveloppe sûre avale l'erreur : une connexion ne doit pas tomber parce
    // qu'une invitation n'a pas pu être réclamée.
    await expect(
      claimInvitationsSafely("utilisateur-inexistant", `boom-${Date.now()}@x.tld`)
    ).resolves.toEqual({ workspaceIds: [] });
  });
});

describe("Révocation — un droit délégué ne survit pas à la perte du droit de déléguer", () => {
  async function inviteFrom(actorId: string, email: string) {
    asUser(actorId);
    await addMember(post({ email, role: "admin" }), withId(workspaceId));
    asUser(admin.id);
  }

  it("rétrograder un admin supprime les invitations qu'il avait émises", async () => {
    const other = await seedMember(workspaceId, "admin");
    const email = `retro-${Date.now()}@x.tld`;
    await inviteFrom(other.user.id, email);

    const res = await updateMemberRole(workspaceId, other.user.id, "editor");
    expect(res.ok).toBe(true);

    expect(
      await prisma.workspaceInvitation.findUnique({
        where: { workspaceId_email: { workspaceId, email } },
      })
    ).toBeNull();

    // Et l'invité qui arrive ensuite n'obtient rien.
    const u = await mkUser(email);
    await expect(claimInvitations(u.id, email)).resolves.toEqual({ workspaceIds: [] });
  });

  it("retirer un membre emporte ses invitations en attente", async () => {
    const other = await seedMember(workspaceId, "admin");
    const email = `retire-${Date.now()}@x.tld`;
    await inviteFrom(other.user.id, email);

    expect(await removeMember(workspaceId, other.user.id)).toEqual({ ok: true });
    expect(
      await prisma.workspaceInvitation.findUnique({
        where: { workspaceId_email: { workspaceId, email } },
      })
    ).toBeNull();
  });

  it("une démotion REFUSÉE (dernier admin) ne supprime aucune invitation", async () => {
    const solo = await seedUserWithWorkspace(`solo-${Date.now()}@x.tld`);
    const email = `solo-invite-${Date.now()}@x.tld`;
    await prisma.workspaceInvitation.create({
      data: { workspaceId: solo.workspace.id, email, role: "editor", invitedBy: solo.user.id },
    });

    const res = await updateMemberRole(solo.workspace.id, solo.user.id, "editor");
    expect(res).toEqual({ ok: false, code: "last_admin" });
    // La transaction a été annulée : l'invitation est toujours là.
    expect(
      await prisma.workspaceInvitation.findUnique({
        where: { workspaceId_email: { workspaceId: solo.workspace.id, email } },
      })
    ).not.toBeNull();
  });
});

describe("Cascade et exposition", () => {
  it("supprimer l'espace purge ses invitations en attente", async () => {
    const tmp = await seedUserWithWorkspace(`casc-${Date.now()}@x.tld`);
    const email = `casc-inv-${Date.now()}@x.tld`;
    await prisma.workspaceInvitation.create({
      data: { workspaceId: tmp.workspace.id, email, role: "editor", invitedBy: tmp.user.id },
    });

    await prisma.workspace.delete({ where: { id: tmp.workspace.id } });
    expect(await prisma.workspaceInvitation.findMany({ where: { email } })).toHaveLength(0);

    // L'invité qui s'inscrit ensuite n'hérite de rien.
    const u = await mkUser(email);
    await expect(claimInvitations(u.id, email)).resolves.toEqual({ workspaceIds: [] });
  });

  it("GET /members expose isService — sans lui, rien ne distingue une automatisation", async () => {
    const res = await listMembers(new Request("http://x/"), withId(workspaceId));
    const members = await res.json();
    expect(members.length).toBeGreaterThan(0);
    for (const m of members) expect(typeof m.isService).toBe("boolean");
  });
});

describe("Péremption — une invitation ne vaut pas éternellement", () => {
  /** Vieillit une invitation en réécrivant sa date d'émission. */
  const ageDays = (id: string, days: number) =>
    prisma.workspaceInvitation.update({
      where: { id },
      data: { createdAt: new Date(Date.now() - days * 86_400_000) },
    });

  it("au-delà du TTL, l'invitation ne confère plus rien ET disparaît", async () => {
    const email = `perime-${Date.now()}@x.tld`;
    const inv = await prisma.workspaceInvitation.create({
      data: { workspaceId, email, role: "admin", invitedBy: admin.id },
    });
    await ageDays(inv.id, INVITATION_TTL_DAYS + 1);

    const user = await mkUser(email);
    const claimed = await claimInvitations(user.id, email);

    // Ni membership fantôme…
    expect(claimed.workspaceIds).toEqual([]);
    expect(
      await prisma.membership.findUnique({
        where: { userId_workspaceId: { userId: user.id, workspaceId } },
      })
    ).toBeNull();
    // …ni ligne morte qui traîne : la purge est paresseuse, au passage.
    expect(await prisma.workspaceInvitation.findUnique({ where: { id: inv.id } })).toBeNull();
  });

  it("la veille de l'échéance, elle vaut encore", async () => {
    // Garde-fou de borne : un `>` au lieu d'un `>=` tuerait les invitations
    // d'un jour trop tôt, et personne ne s'en apercevrait.
    const email = `limite-${Date.now()}@x.tld`;
    const inv = await prisma.workspaceInvitation.create({
      data: { workspaceId, email, role: "editor", invitedBy: admin.id },
    });
    await ageDays(inv.id, INVITATION_TTL_DAYS - 1);

    const user = await mkUser(email);
    expect((await claimInvitations(user.id, email)).workspaceIds).toEqual([workspaceId]);
  });

  it("hasPendingInvitation : le laissez-passer suit la même échéance", async () => {
    const email = `passe-${Date.now()}@x.tld`;
    const inv = await prisma.workspaceInvitation.create({
      data: { workspaceId, email, role: "viewer", invitedBy: admin.id },
    });
    expect(await hasPendingInvitation(email)).toBe(true);
    // Insensible à la casse, comme tout le reste du projet.
    expect(await hasPendingInvitation(email.toUpperCase())).toBe(true);

    await ageDays(inv.id, INVITATION_TTL_DAYS + 1);
    expect(await hasPendingInvitation(email)).toBe(false);
    // Lecture SEULE : elle est appelée hors transaction, avant la création du User.
    expect(await prisma.workspaceInvitation.findUnique({ where: { id: inv.id } })).not.toBeNull();
  });

  it("une adresse jamais invitée n'a pas de laissez-passer", async () => {
    expect(await hasPendingInvitation(`jamais-${Date.now()}@x.tld`)).toBe(false);
    expect(await hasPendingInvitation("")).toBe(false);
  });
});

describe("Renvoyer une invitation = la ré-émettre", () => {
  it("le renvoi prolonge l'échéance au lieu d'expédier un lien déjà mort", async () => {
    const email = `renvoi-${Date.now()}@x.tld`;
    const first = await addMember(post({ email, role: "editor" }), withId(workspaceId));
    expect(first.status).toBe(201);
    const inv = await prisma.workspaceInvitation.findFirst({ where: { workspaceId, email } });

    // Presque périmée : c'est le cas où l'admin clique « Renvoyer ».
    await prisma.workspaceInvitation.update({
      where: { id: inv!.id },
      data: { createdAt: new Date(Date.now() - (INVITATION_TTL_DAYS - 1) * 86_400_000) },
    });

    const again = await addMember(post({ email, role: "editor" }), withId(workspaceId));
    expect(again.status).toBe(201);

    const after = await prisma.workspaceInvitation.findUnique({ where: { id: inv!.id } });
    // Même ligne (pas de doublon), échéance repartie de zéro.
    expect(after).not.toBeNull();
    expect(after!.createdAt.getTime()).toBeGreaterThan(inv!.createdAt.getTime() - 1000);
    expect(Date.now() - after!.createdAt.getTime()).toBeLessThan(60_000);
  });

  it("la réponse dit si l'email est parti — un envoi raté en silence serait pire qu'aucun envoi", async () => {
    // BREVO_API_KEY est vide dans vitest.config : on est dans le mode « self-host
    // sans compte Brevo », qui est légitime et doit se DIRE.
    const res = await addMember(
      post({ email: `muet-${Date.now()}@x.tld`, role: "viewer" }),
      withId(workspaceId)
    );
    const body = await res.json();
    expect(body.emailSent).toBe(false);
    expect(body.emailReason).toBe("disabled");
    // L'invitation, elle, existe bel et bien : l'email n'est qu'une notification.
    expect(body.status).toBe("invited");
  });
});

describe("L'ajout d'un membre CONSOMME l'invitation qui visait la même adresse", () => {
  it("aucune ligne fantôme ne survit à la membership", async () => {
    // État atteignable : invitation posée, puis la personne obtient un compte par
    // un chemin qui ne réclame pas (register), puis l'admin l'ajoute à la main.
    const email = `fantome-${Date.now()}@x.tld`;
    await prisma.workspaceInvitation.create({
      data: { workspaceId, email, role: "admin", invitedBy: admin.id },
    });
    const user = await mkUser(email);

    const res = await addMember(post({ email, role: "viewer" }), withId(workspaceId));
    expect(res.status).toBe(200);
    expect((await res.json()).status).toBe("member");

    // L'invitation est consommée : plus de ligne « En attente » dont le bouton
    // « Renvoyer » ne pourrait rendre qu'un 409.
    expect(await prisma.workspaceInvitation.findFirst({ where: { workspaceId, email } })).toBeNull();
    // Et le rôle appliqué est celui de l'AJOUT (viewer), pas celui de
    // l'invitation périmée (admin).
    const m = await prisma.membership.findUnique({
      where: { userId_workspaceId: { userId: user.id, workspaceId } },
    });
    expect(m?.role).toBe("viewer");
  });

  it("retirer le membre ne le fait pas revenir tout seul à la connexion suivante", async () => {
    // LE défaut visé : removeMember ne supprime que les invitations ÉMISES PAR la
    // personne, jamais celles qui la VISENT. Une invitation survivante rouvrait
    // donc l'accès au premier login — un retrait qui ne retire pas.
    const email = `revenant-${Date.now()}@x.tld`;
    await prisma.workspaceInvitation.create({
      data: { workspaceId, email, role: "admin", invitedBy: admin.id },
    });
    const user = await mkUser(email);
    await addMember(post({ email, role: "viewer" }), withId(workspaceId));

    const removed = await removeMember(workspaceId, user.id);
    expect(removed.ok).toBe(true);

    // Le claim d'une connexion ultérieure ne doit RIEN retrouver.
    expect((await claimInvitations(user.id, email)).workspaceIds).toEqual([]);
    expect(
      await prisma.membership.findUnique({
        where: { userId_workspaceId: { userId: user.id, workspaceId } },
      })
    ).toBeNull();
  });

  it("l'email d'ajout consomme le budget d'invitation, comme celui d'invitation", async () => {
    // Sans ça, la boucle ajouter/retirer sur un compte existant offrait un canal
    // d'envoi ILLIMITÉ vers l'adresse d'un tiers, depuis l'expéditeur vérifié de
    // l'instance — le plafond ne couvrait que la branche « invited ».
    _resetRateLimit();
    const cible = await mkUser(`budget-${Date.now()}@x.tld`);
    const ws = await prisma.workspace.create({ data: { name: "B", createdBy: admin.id } });
    await prisma.membership.create({ data: { userId: admin.id, workspaceId: ws.id, role: "admin" } });

    for (let i = 0; i < INVITE_BUDGET.max; i++) {
      const r = await addMember(post({ email: cible.email, role: "viewer" }), withId(ws.id));
      // 200 la 1re fois (ajout), 409 ensuite (déjà membre) — dans les deux cas
      // c'est l'ENVOI qu'on plafonne, et seul le 1er en déclenche un.
      expect([200, 409]).toContain(r.status);
      if (r.status === 200) {
        await prisma.membership.delete({
          where: { userId_workspaceId: { userId: cible.id, workspaceId: ws.id } },
        });
      }
    }
    const bloque = await addMember(post({ email: cible.email, role: "viewer" }), withId(ws.id));
    expect(bloque.status).toBe(429);
  });
});

describe("Provisioning IdP — l'invitation ne promet plus une connexion impossible", () => {
  it("la réponse dit si le compte IdP a été créé, sans jamais bloquer l'invitation", async () => {
    // KEYCLOAK_ADMIN_* sont vides dans vitest.config : on est dans le mode
    // historique, où l'admin crée le compte à la main. Ça doit se DIRE — c'est
    // précisément ce qui manquait quand un invité recevait « connecte-toi »
    // sans pouvoir se connecter.
    const res = await addMember(
      post({ email: `idp-${Date.now()}@x.tld`, role: "viewer" }),
      withId(workspaceId)
    );
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.loginLink).toBe(false);
    // L'invitation existe quoi qu'il arrive côté IdP.
    expect(body.status).toBe("invited");
  });

  it("l'ajout d'un compte EXISTANT ne provisionne rien (il a déjà une identité)", async () => {
    const u = await mkUser(`deja-${Date.now()}@x.tld`);
    const res = await addMember(post({ email: u.email, role: "viewer" }), withId(workspaceId));
    expect(res.status).toBe(200);
    expect((await res.json()).loginLink).toBeUndefined();
  });
});

describe("Plafond par DESTINATAIRE — une adresse ne se fait pas noyer", () => {
  /** Espace neuf + admin dédié : le plafond par ACTEUR ne doit pas interférer. */
  async function acteurNeuf(tag: string) {
    const s = await seedUserWithWorkspace(`cap-${tag}-${Date.now()}@x.tld`);
    return { userId: s.user.id, workspaceId: s.workspace.id };
  }

  it("au-delà du budget, l'email est retenu mais l'INVITATION est créée quand même", async () => {
    _resetRateLimit();
    const cible = `cible-${Date.now()}@x.tld`;
    let dernier: Response | null = null;

    // Chaque tour : un acteur DIFFÉRENT, donc le budget par acteur n'est jamais
    // atteint — c'est bien la cible qui sature.
    for (let i = 0; i < RECIPIENT_BUDGET.max + 1; i++) {
      const a = await acteurNeuf(`a${i}`);
      asUser(a.userId);
      dernier = await addMember(post({ email: cible, role: "viewer" }), withId(a.workspaceId));
    }

    const body = await dernier!.json();
    // ⚠️ Le code HTTP ne change PAS : répondre 429 ferait de la route un oracle
    // (« cette adresse a déjà été visée »), et punirait un admin pour un abus
    // qu'il ne commet pas.
    expect(dernier!.status).toBe(201);
    expect(body.status).toBe("invited");
    expect(body.emailSent).toBe(false);
    expect(body.emailReason).toBe("throttled");

    // L'écriture, elle, a bien eu lieu : l'invitation est la source de vérité.
    const inv = await prisma.workspaceInvitation.findFirst({ where: { email: cible } });
    expect(inv).not.toBeNull();
  });

  it("inviter 10 personnes DIFFÉRENTES ne déclenche aucun plafond", async () => {
    // Le cas légitime ne doit pas être gêné : le plafond est par cible.
    _resetRateLimit();
    const a = await acteurNeuf("equipe");
    asUser(a.userId);
    const stamp = Date.now();
    for (let i = 0; i < 10; i++) {
      const r = await addMember(
        post({ email: `equipe${i}-${stamp}@x.tld`, role: "viewer" }),
        withId(a.workspaceId)
      );
      expect(r.status).toBe(201);
      expect((await r.json()).emailReason).not.toBe("throttled");
    }
  });

  it("la clé de plafond ne contient PAS l'adresse en clair", async () => {
    // Ces compteurs vivent en mémoire, mais rien n'oblige à y stocker en clair
    // l'adresse de quelqu'un qui n'a rien demandé.
    const src = readFileSync("src/app/api/workspaces/[id]/members/route.ts", "utf8");
    expect(src).toMatch(/createHash\("sha256"\)\.update\(email\)/);
    expect(src).not.toMatch(/`to:\$\{email\}`/);
  });
});
