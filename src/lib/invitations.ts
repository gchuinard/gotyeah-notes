import { prisma } from "./prisma";
import { normalizeEmail } from "./oidc";
import { WORKSPACE_ROLES, type WorkspaceRole } from "./workspace";

/**
 * Invitations : pré-autorisation d'un email qui n'a pas encore de compte.
 *
 * Le projet n'a AUCUNE dépendance mail et tourne en self-host : « inviter » ne
 * peut donc pas signifier « envoyer un message ». Le modèle retenu est une
 * PRÉ-AUTORISATION — on enregistre « cet email aura ce rôle sur cet espace », et
 * la Membership se matérialise toute seule à la première connexion (décision de
 * Gautier du 05/08 : pas d'écran d'acceptation).
 *
 * ⚠️ Le claim n'est PAS branché sur POST /api/auth/register : cette route ne
 * vérifie aucun email, une invitation admin y serait réclamable par quiconque
 * occupe l'adresse. Seuls deux chemins réclament : le callback OIDC (Pocket ID
 * vérifie l'email, et le callback refuse déjà email_verified === false) et le
 * login d'un compte préexistant. Conséquence assumée : avec REGISTRATION=on et
 * aucun IdP, une invitation reste en attente indéfiniment — c'est voulu.
 */

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

  return prisma.$transaction(async (tx) => {
    const pending = await tx.workspaceInvitation.findMany({
      where: { email: normalized },
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
