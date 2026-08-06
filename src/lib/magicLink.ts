import { randomBytes } from "node:crypto";
import bcrypt from "bcryptjs";
import { prisma } from "./prisma";
import { hashToken } from "./session";
import { normalizeEmail } from "./oidc";
import { claimInvitationsSafely, hasPendingInvitation } from "./invitations";
import { createWorkspaceWithDefaults } from "./workspace";

/**
 * Connexion par lien email — le canal des invités.
 *
 * POURQUOI. L'IdP ne peut pas être le seul chemin : le realm est partagé par
 * tout l'écosystème et son auto-inscription est fermée, donc un invité externe
 * n'y a pas de compte et ne peut pas s'en créer. Le faire provisionner par
 * notes marchait, mais imposait DEUX emails dont l'ordre comptait sans que rien
 * ne l'indique — l'invité cliquait le premier et tombait sur un écran lui
 * réclamant un mot de passe qu'il n'avait pas. Un lien de connexion supprime la
 * question : un message, un clic, il est dedans.
 *
 * ⚠️ CE JETON N'EST PAS CELUI QU'ON AVAIT ÉCARTÉ. Le design des invitations
 * refuse — et refuse toujours — de mettre un jeton D'INVITATION dans un email :
 * il resterait valable sept jours et conférerait un rôle. Ici c'est un jeton de
 * CONNEXION : quinze minutes, usage unique, aucun droit propre. C'est le modèle
 * du « mot de passe oublié », que l'IdP propose déjà.
 *
 * ⚠️ Conséquence assumée : l'email devient un facteur d'authentification. Qui
 * accède à la boîte accède au compte. C'était déjà vrai de la réinitialisation
 * de mot de passe ; ça reste à savoir. `MAGIC_LINK=off` coupe le canal.
 */

/** Court à dessein : le lien vit le temps d'aller le chercher dans sa boîte. */
export const MAGIC_LINK_TTL_MINUTES = 15;

/**
 * Le lien glissé dans l'email d'INVITATION vit aussi longtemps que l'invitation
 * (7 j) — sinon l'invité qui ouvre son courrier le lendemain trouve un lien mort
 * et se retrouve exactement là où on ne veut plus le mettre.
 *
 * ⚠️ Ce TTL long n'ajoute AUCUN droit : il est borné par l'invitation, qui
 * expire au même moment et est revérifiée à la consommation. Un jeton qui
 * survivrait à l'invitation, lui, serait une porte dérobée.
 */
export const INVITE_LINK_TTL_MINUTES = 7 * 24 * 60;

export function magicLinkEnabled(): boolean {
  return (process.env.MAGIC_LINK || "on").trim().toLowerCase() !== "off";
}

/**
 * Émet un jeton pour cette adresse, si elle a le droit d'entrer — c'est-à-dire
 * si elle a déjà un compte, ou une invitation vivante.
 *
 * ⚠️ Renvoie `null` quand l'adresse n'a droit à rien, et l'appelant DOIT
 * répondre exactement pareil dans les deux cas : sinon la route devient un
 * oracle qui dit qui possède un compte ici.
 *
 * ⚠️ Les jetons précédents de cette adresse sont supprimés. Demander un nouveau
 * lien doit invalider l'ancien — sinon un lien oublié dans une boîte reste une
 * porte ouverte pendant tout son TTL, et on en accumule un par clic.
 */
export async function issueMagicLink(
  rawEmail: string,
  ttlMinutes: number = MAGIC_LINK_TTL_MINUTES
): Promise<string | null> {
  const email = normalizeEmail(rawEmail);
  if (!email) return null;

  const [user, invited] = await Promise.all([
    prisma.user.findUnique({ where: { email }, select: { id: true, isService: true } }),
    hasPendingInvitation(email),
  ]);
  // Un compte de SERVICE ne se connecte pas par email : il n'a pas de boîte, et
  // son unique usage est le pont MCP. Lui ouvrir ce canal serait une porte
  // dérobée vers un compte qui voit les pages privées.
  if (user?.isService) return null;
  if (!user && !invited) return null;

  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + ttlMinutes * 60_000);

  await prisma.$transaction([
    prisma.loginToken.deleteMany({ where: { email } }),
    prisma.loginToken.create({ data: { id: hashToken(token), email, expiresAt } }),
  ]);
  return token;
}

export type ConsumeResult =
  | { ok: true; userId: string; workspaceId: string | null }
  | { ok: false; reason: "invalid" | "expired" | "no_access" };

/**
 * Consomme un jeton et rend l'utilisateur à connecter, en le créant au besoin.
 *
 * ⚠️ Le jeton est supprimé AVANT toute autre écriture, quelle que soit la suite :
 * un usage unique qui ne le serait qu'en cas de succès laisserait rejouer le
 * lien après un échec transitoire.
 *
 * ⚠️ Le droit d'entrer est REVÉRIFIÉ ici, pas seulement à l'émission. Entre les
 * deux, l'invitation a pu être révoquée ou expirer — un lien de quinze minutes
 * ne doit pas survivre à la décision de l'admin qui l'annule.
 */
export async function consumeMagicLink(token: string): Promise<ConsumeResult> {
  if (!token) return { ok: false, reason: "invalid" };
  const id = hashToken(token);

  const row = await prisma.loginToken.findUnique({ where: { id } });
  if (!row) return { ok: false, reason: "invalid" };
  await prisma.loginToken.delete({ where: { id } }).catch(() => {});
  if (row.expiresAt.getTime() <= Date.now()) return { ok: false, reason: "expired" };

  const email = row.email;
  const existing = await prisma.user.findUnique({
    where: { email },
    select: { id: true, isService: true },
  });

  if (existing) {
    if (existing.isService) return { ok: false, reason: "no_access" };
    // Le clic prouve la possession de l'adresse : le claim est sûr ici, au même
    // titre qu'au callback OIDC. C'est ce qui distingue ce chemin de
    // POST /api/auth/register, qui ne vérifie rien et n'a donc pas le droit de
    // réclamer une invitation.
    await claimInvitationsSafely(existing.id, email);
    const ws = await prisma.membership.findFirst({
      where: { userId: existing.id },
      orderBy: { createdAt: "asc" },
      select: { workspaceId: true },
    });
    return { ok: true, userId: existing.id, workspaceId: ws?.workspaceId ?? null };
  }

  // Pas de compte : il n'en naît un QUE si une invitation est encore vivante.
  if (!(await hasPendingInvitation(email))) return { ok: false, reason: "no_access" };

  const local = email.split("@")[0];
  // Compte sans mot de passe utilisable : ce chemin n'en demande jamais, et
  // LEGACY_LOGIN est fermé en production. Un hash aléatoire vaut « aucun ».
  const passwordHash = await bcrypt.hash(randomBytes(32).toString("base64url"), 12);
  const created = await prisma.user.create({
    data: { email, firstName: local, lastName: "", displayName: local, passwordHash },
    select: { id: true },
  });

  const claimed = await claimInvitationsSafely(created.id, email);
  const own = await createWorkspaceWithDefaults("Mon espace", created.id);
  // On atterrit sur l'espace qui vient d'être réclamé : arriver dans un « Mon
  // espace » vide quand on suit une invitation donne l'impression que le lien
  // s'est trompé de destination.
  return { ok: true, userId: created.id, workspaceId: claimed.workspaceIds[0] ?? own.id };
}

/**
 * Ménage des jetons expirés. Paresseux, comme la corbeille : pas de cron en
 * self-host. Le filtre d'expiration reste l'autorité — ceci n'est que du
 * nettoyage, et n'a donc pas besoin d'être fiable.
 */
export async function purgeExpiredLoginTokens(): Promise<void> {
  await prisma.loginToken
    .deleteMany({ where: { expiresAt: { lt: new Date() } } })
    .catch(() => {});
}
