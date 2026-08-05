import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from "vitest";

vi.mock("@/lib/session", () => ({ getSession: vi.fn() }));

import { getSession } from "@/lib/session";
import { GET as listMembers, POST as addMember } from "@/app/api/workspaces/[id]/members/route";
import { prisma } from "@/lib/prisma";
import { claimInvitations, claimInvitationsSafely } from "@/lib/invitations";
import { updateMemberRole, removeMember } from "@/lib/workspace";
import { _resetRateLimit, INVITE_BUDGET } from "@/lib/rateLimit";
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
