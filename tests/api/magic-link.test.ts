import { describe, it, expect, beforeEach, afterAll, vi } from "vitest";
import { prisma } from "@/lib/prisma";
import { hashToken } from "@/lib/session";
import {
  issueMagicLink,
  consumeMagicLink,
  MAGIC_LINK_TTL_MINUTES,
  INVITE_LINK_TTL_MINUTES,
} from "@/lib/magicLink";
import { POST as magicPOST } from "@/app/api/auth/magic/route";
import { _resetRateLimit } from "@/lib/rateLimit";
import { seedUserWithWorkspace } from "../helpers/seed";

/**
 * Connexion par lien email. Le jeton n'existe en clair que le temps du test :
 * en base, seul son sha256 est stocké — même doctrine que les sessions.
 */

const post = (email: unknown, ip = "1.2.3.4") =>
  new Request("http://localhost/api/auth/magic", {
    method: "POST",
    headers: { "content-type": "application/json", "x-forwarded-for": ip },
    body: JSON.stringify({ email }),
  });

const mkUser = (email: string, isService = false) =>
  prisma.user.create({
    data: { email, firstName: "A", lastName: "B", displayName: "AB", passwordHash: "x", isService },
  });

beforeEach(() => _resetRateLimit());
afterAll(async () => {
  await prisma.$disconnect();
});

describe("Émission du lien", () => {
  it("un compte existant obtient un jeton, stocké HACHÉ", async () => {
    const u = await mkUser(`magic-${Date.now()}@x.tld`);
    const token = await issueMagicLink(u.email);
    expect(token).toBeTruthy();

    // Le jeton en clair ne doit apparaître nulle part en base.
    expect(await prisma.loginToken.findUnique({ where: { id: token! } })).toBeNull();
    const row = await prisma.loginToken.findUnique({ where: { id: hashToken(token!) } });
    expect(row?.email).toBe(u.email);
  });

  it("une adresse sans compte NI invitation n'obtient rien", async () => {
    expect(await issueMagicLink(`inconnu-${Date.now()}@x.tld`)).toBeNull();
  });

  it("une adresse seulement INVITÉE obtient un jeton — c'est tout l'objet du lot", async () => {
    const { user, workspace } = await seedUserWithWorkspace(`inviteur-${Date.now()}@x.tld`);
    const email = `futur-${Date.now()}@x.tld`;
    await prisma.workspaceInvitation.create({
      data: { workspaceId: workspace.id, email, role: "editor", invitedBy: user.id },
    });
    expect(await issueMagicLink(email)).toBeTruthy();
  });

  it("un COMPTE DE SERVICE ne se connecte jamais par email", async () => {
    // Il n'a pas de boîte, et il voit les pages privées des espaces où il est
    // membre : lui ouvrir ce canal serait une porte dérobée.
    const svc = await mkUser(`svc-${Date.now()}@gotyeah.local`, true);
    expect(await issueMagicLink(svc.email)).toBeNull();
  });

  it("demander un nouveau lien INVALIDE le précédent", async () => {
    // Sinon chaque clic laisse une porte ouverte pour toute la durée du TTL.
    const u = await mkUser(`rotation-${Date.now()}@x.tld`);
    const premier = await issueMagicLink(u.email);
    const second = await issueMagicLink(u.email);
    expect(premier).not.toBe(second);
    expect(await consumeMagicLink(premier!)).toEqual({ ok: false, reason: "invalid" });
    expect((await consumeMagicLink(second!)).ok).toBe(true);
  });

  it("le lien d'invitation vit aussi longtemps que l'invitation, pas 15 minutes", async () => {
    // Un lien de 15 min dans un email lu le lendemain serait mort à l'arrivée.
    expect(INVITE_LINK_TTL_MINUTES).toBeGreaterThan(MAGIC_LINK_TTL_MINUTES);
    const u = await mkUser(`ttl-${Date.now()}@x.tld`);
    const token = await issueMagicLink(u.email, INVITE_LINK_TTL_MINUTES);
    const row = await prisma.loginToken.findUnique({ where: { id: hashToken(token!) } });
    const heures = (row!.expiresAt.getTime() - Date.now()) / 3_600_000;
    expect(heures).toBeGreaterThan(24);
  });
});

describe("Consommation", () => {
  it("connecte, et le jeton ne sert QU'UNE fois", async () => {
    const { user } = await seedUserWithWorkspace(`conso-${Date.now()}@x.tld`);
    const token = await issueMagicLink(user.email);
    const first = await consumeMagicLink(token!);
    expect(first).toMatchObject({ ok: true, userId: user.id });
    expect(await consumeMagicLink(token!)).toEqual({ ok: false, reason: "invalid" });
  });

  it("un jeton expiré est refusé — et consommé quand même", async () => {
    // Supprimer AVANT de vérifier l'expiration : un jeton qui survivrait à son
    // propre échec resterait rejouable.
    const u = await mkUser(`vieux-${Date.now()}@x.tld`);
    const token = await issueMagicLink(u.email);
    await prisma.loginToken.update({
      where: { id: hashToken(token!) },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });
    expect(await consumeMagicLink(token!)).toEqual({ ok: false, reason: "expired" });
    expect(await prisma.loginToken.findUnique({ where: { id: hashToken(token!) } })).toBeNull();
  });

  it("un jeton inventé ne révèle rien", async () => {
    expect(await consumeMagicLink("pas-un-vrai-jeton")).toEqual({ ok: false, reason: "invalid" });
    expect(await consumeMagicLink("")).toEqual({ ok: false, reason: "invalid" });
  });

  it("⚠️ un invité SANS compte n'obtient RIEN : ni User, ni session, ni espace", async () => {
    // Décision du 07/08 : rien n'est créé avant le clic sur « Accepter ».
    // Le lien mène désormais à un écran d'acceptation, pas à une session.
    const { user, workspace } = await seedUserWithWorkspace(`hote-${Date.now()}@x.tld`);
    const email = `nouveau-${Date.now()}@x.tld`;
    await prisma.workspaceInvitation.create({
      data: { workspaceId: workspace.id, email, role: "editor", invitedBy: user.id },
    });

    const token = await issueMagicLink(email, INVITE_LINK_TTL_MINUTES);
    expect(await consumeMagicLink(token!)).toEqual({ ok: false, reason: "needs_acceptance" });

    expect(await prisma.user.findUnique({ where: { email } })).toBeNull();
    expect(await prisma.workspaceInvitation.findFirst({ where: { email } })).not.toBeNull();
  });

  it("⚠️ et le jeton reste VIVANT : sinon l'écran d'acceptation naîtrait déjà mort", async () => {
    // Le jeton est supprimé puis restitué : aucune session n'est ouverte, donc
    // l'usage unique n'est pas affaibli — c'est l'acceptation qui consommera.
    const { user, workspace } = await seedUserWithWorkspace(`hote2-${Date.now()}@x.tld`);
    const email = `vivant-${Date.now()}@x.tld`;
    await prisma.workspaceInvitation.create({
      data: { workspaceId: workspace.id, email, role: "viewer", invitedBy: user.id },
    });

    const token = await issueMagicLink(email, INVITE_LINK_TTL_MINUTES);
    await consumeMagicLink(token!);
    expect(await prisma.loginToken.findUnique({ where: { id: hashToken(token!) } })).not.toBeNull();
  });

  it("⚠️ l'invitation RÉVOQUÉE entre l'envoi et le clic ne laisse pas entrer", async () => {
    // Le droit est revérifié à la consommation : un lien de 7 jours ne doit pas
    // survivre à la décision de l'admin qui l'annule.
    const { user, workspace } = await seedUserWithWorkspace(`revoque-${Date.now()}@x.tld`);
    const email = `annule-${Date.now()}@x.tld`;
    const inv = await prisma.workspaceInvitation.create({
      data: { workspaceId: workspace.id, email, role: "admin", invitedBy: user.id },
    });
    const token = await issueMagicLink(email, INVITE_LINK_TTL_MINUTES);
    await prisma.workspaceInvitation.delete({ where: { id: inv.id } });

    expect(await consumeMagicLink(token!)).toEqual({ ok: false, reason: "no_access" });
    expect(await prisma.user.findUnique({ where: { email } })).toBeNull();
  });
});

describe("POST /api/auth/magic — la route ne dit jamais qui a un compte", () => {
  it("réponse IDENTIQUE pour une adresse connue, inconnue ou malformée", async () => {
    const u = await mkUser(`oracle-${Date.now()}@x.tld`);
    const connue = await magicPOST(post(u.email, "9.9.9.1"));
    const inconnue = await magicPOST(post(`nul-${Date.now()}@x.tld`, "9.9.9.2"));
    const malformee = await magicPOST(post("pas-un-email", "9.9.9.3"));

    expect([connue.status, inconnue.status, malformee.status]).toEqual([200, 200, 200]);
    const [a, b, c] = await Promise.all([connue.json(), inconnue.json(), malformee.json()]);
    expect(a).toEqual(b);
    expect(b).toEqual(c);
  });

  it("plafonne les demandes répétées sur la même adresse", async () => {
    const u = await mkUser(`flood-${Date.now()}@x.tld`);
    let bloque = false;
    for (let i = 0; i < 12 && !bloque; i++) {
      const r = await magicPOST(post(u.email, "7.7.7.7"));
      if (r.status === 429) bloque = true;
    }
    expect(bloque).toBe(true);
  });
});

describe("Concurrence — deux requêtes portant le MÊME jeton", () => {
  it("⚠️ une seule gagne : un jeton « à usage unique » doit l'être VRAIMENT", async () => {
    // Trouvé par revue adversariale et reproduit sur le vrai handler : la
    // version « findUnique puis delete().catch(() => {}) » laissait les DEUX
    // appels passer la lecture, donc créait deux sessions valides. Le scénario
    // est celui déjà documenté dans le module — un filtre anti-hameçonnage qui
    // précharge le lien pendant que le destinataire clique.
    const { user } = await seedUserWithWorkspace(`race-${Date.now()}@x.tld`);
    const token = await issueMagicLink(user.email);

    const [a, b] = await Promise.all([consumeMagicLink(token!), consumeMagicLink(token!)]);
    const gagnants = [a, b].filter((r) => r.ok);
    expect(gagnants).toHaveLength(1);
    expect([a, b].filter((r) => !r.ok && r.reason === "invalid")).toHaveLength(1);
  });

  it("⚠️ branche INVITÉ : deux clics concurrents ne créent toujours aucun compte", async () => {
    const { user, workspace } = await seedUserWithWorkspace(`racehote-${Date.now()}@x.tld`);
    const email = `raceinvite-${Date.now()}@x.tld`;
    await prisma.workspaceInvitation.create({
      data: { workspaceId: workspace.id, email, role: "editor", invitedBy: user.id },
    });
    const token = await issueMagicLink(email, INVITE_LINK_TTL_MINUTES);

    // Ne doit RIEN lever, quel que soit l'ordre d'arrivée.
    const res = await Promise.all([consumeMagicLink(token!), consumeMagicLink(token!)]);
    expect(res.every((r) => !r.ok)).toBe(true);
    expect(await prisma.user.count({ where: { email } })).toBe(0);
  });
});
