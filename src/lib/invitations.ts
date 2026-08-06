import { prisma } from "./prisma";
import { normalizeEmail } from "./oidc";
import { WORKSPACE_ROLES, type WorkspaceRole } from "./workspace";

/**
 * Invitations : pré-autorisation d'un email qui n'a pas encore de compte.
 *
 * Le modèle est une PRÉ-AUTORISATION : on enregistre « cet email aura ce rôle sur
 * cet espace », et la Membership se matérialise toute seule à la première
 * connexion (décision de Gautier du 05/08 : pas d'écran d'acceptation).
 *
 * Un email de notification part depuis le 05/08 (lib/mailer.ts), mais il reste
 * une NOTIFICATION : il ne porte aucun jeton, et la pré-autorisation vaut avec
 * ou sans lui. C'est ce qui permet à l'envoi d'échouer sans rien casser.
 *
 * ⚠️ Le claim n'est PAS branché sur POST /api/auth/register : cette route ne
 * vérifie aucun email, une invitation admin y serait réclamable par quiconque
 * occupe l'adresse. Seuls deux chemins réclament : le callback OIDC (Keycloak
 * vérifie l'email, et le callback refuse déjà email_verified === false) et le
 * login d'un compte préexistant. Conséquence assumée : avec REGISTRATION=on et
 * aucun IdP, une invitation reste en attente indéfiniment — c'est voulu.
 */

/**
 * Une invitation n'est plus réclamable au-delà de 7 jours (choix de Gautier du
 * 05/08). Elle donne accès à un espace : la laisser vivre indéfiniment dans une
 * boîte mail en ferait une porte ouverte qu'on a oublié d'avoir ouverte.
 *
 * ⚠️ Pas de cron en self-host : la péremption est vérifiée À L'USAGE et les
 * lignes mortes sont purgées au passage, exactement comme la corbeille se purge
 * à l'ouverture. Une invitation expirée non encore purgée ne confère donc rien —
 * le filtre est l'autorité, la purge n'est que du ménage.
 */
export const INVITATION_TTL_DAYS = 7;

/** Limite basse de validité : une invitation créée avant est morte. */
export function invitationCutoff(now: Date = new Date()): Date {
  return new Date(now.getTime() - INVITATION_TTL_DAYS * 24 * 60 * 60 * 1000);
}

/**
 * Un rôle illisible en base ne doit JAMAIS retomber sur le `@default("admin")`
 * du schéma Membership : le repli est le moindre privilège.
 */
function safeRole(role: string): WorkspaceRole {
  return (WORKSPACE_ROLES as string[]).includes(role)
    ? (role as WorkspaceRole)
    : "viewer";
}

export type ClaimResult = {
  /** Espaces effectivement rejoints par ce claim (vide si aucune invitation). */
  workspaceIds: string[];
};

/**
 * Matérialise en Membership toutes les invitations en attente pour cet email,
 * puis supprime les lignes consommées — la Membership créée EST la trace, on ne
 * garde pas de `claimedAt`.
 *
 * Tout est fait dans UNE transaction : si la création d'une membership échoue,
 * l'invitation correspondante reste en attente et la connexion suivante rejoue
 * le claim. La fonction est donc auto-réparatrice, et ses appelants l'enveloppent
 * dans un try/catch : un claim raté ne doit jamais empêcher de se connecter.
 *
 * Idempotente : les espaces où la membership existe déjà sont filtrés (invitation
 * posée pendant que la personne était en train de rejoindre). ⚠️ Pas de
 * `skipDuplicates` — Prisma ne le supporte pas sur SQLite, le filtrage est donc
 * explicite et la contrainte @@unique([userId, workspaceId]) reste le garde-fou.
 */
export async function claimInvitations(
  userId: string,
  email: string
): Promise<ClaimResult> {
  const normalized = normalizeEmail(email);
  if (!normalized) return { workspaceIds: [] };

  const cutoff = invitationCutoff();

  return prisma.$transaction(async (tx) => {
    // Purge paresseuse : les expirées de CET email partent, réclamées ou non.
    // Scopée à l'email pour rester une écriture bornée sur un chemin de login.
    await tx.workspaceInvitation.deleteMany({
      where: { email: normalized, createdAt: { lt: cutoff } },
    });

    const pending = await tx.workspaceInvitation.findMany({
      where: { email: normalized, createdAt: { gte: cutoff } },
      select: { id: true, workspaceId: true, role: true },
    });
    if (pending.length === 0) return { workspaceIds: [] };

    const already = await tx.membership.findMany({
      where: { userId, workspaceId: { in: pending.map((i) => i.workspaceId) } },
      select: { workspaceId: true },
    });
    const known = new Set(already.map((m) => m.workspaceId));
    const toCreate = pending.filter((i) => !known.has(i.workspaceId));

    if (toCreate.length > 0) {
      // role TOUJOURS explicite (cf. Membership.role @default("admin")).
      await tx.membership.createMany({
        data: toCreate.map((i) => ({
          userId,
          workspaceId: i.workspaceId,
          role: safeRole(i.role),
        })),
      });
    }
    // Toutes les invitations sont consommées, y compris celles déjà couvertes par
    // une membership : les laisser en attente les ferait rejouer indéfiniment.
    await tx.workspaceInvitation.deleteMany({
      where: { id: { in: pending.map((i) => i.id) } },
    });

    return { workspaceIds: toCreate.map((i) => i.workspaceId) };
  });
}

/**
 * Enveloppe sûre pour les chemins d'AUTHENTIFICATION : journalise et avale
 * l'erreur. Une invitation non réclamée est un désagrément ; une connexion
 * refusée à cause d'elle serait une panne.
 */
export async function claimInvitationsSafely(
  userId: string,
  email: string
): Promise<ClaimResult> {
  try {
    return await claimInvitations(userId, email);
  } catch (err) {
    console.error(`[invitation-claim-failed] user=${userId} err=${String(err)}`);
    return { workspaceIds: [] };
  }
}

/**
 * Cet email est-il pré-autorisé quelque part (invitation vivante) ?
 *
 * Sert de LAISSEZ-PASSER au provisioning : avec OIDC_ALLOW_SIGNUP=false, le
 * callback ne crée un compte que si la réponse est oui. C'est ce qui referme le
 * trou du realm partagé — sans ça, tout utilisateur d'un autre site de
 * l'écosystème Keycloak obtenait un compte notes en cliquant « Se connecter ».
 *
 * ⚠️ Lecture SEULE, sans purge : appelée avant la création du User, donc hors de
 * la transaction qui réclamera. La purge se fait au claim qui suit.
 */
export async function hasPendingInvitation(email: string): Promise<boolean> {
  const normalized = normalizeEmail(email);
  if (!normalized) return false;
  const found = await prisma.workspaceInvitation.findFirst({
    where: { email: normalized, createdAt: { gte: invitationCutoff() } },
    select: { id: true },
  });
  return found !== null;
}

/**
 * Révoque les invitations émises par un membre qui perd son autorité (démotion
 * depuis admin, ou retrait de l'espace).
 *
 * ⚠️ Sans ça, un droit délégué survivrait à la perte du droit de déléguer : un
 * ex-admin garderait une invitation « admin » vivante, qui conférerait admin à
 * sa réclamation. À appeler DANS la transaction de updateMemberRole/removeMember,
 * jamais après — sinon une démotion réussie laisserait l'invitation derrière elle.
 */
export async function revokeInvitationsFrom(
  tx: {
    workspaceInvitation: {
      deleteMany: (args: {
        where: { workspaceId: string; invitedBy: string };
      }) => Promise<{ count: number }>;
    };
  },
  workspaceId: string,
  invitedBy: string
): Promise<number> {
  const { count } = await tx.workspaceInvitation.deleteMany({
    where: { workspaceId, invitedBy },
  });
  return count;
}
