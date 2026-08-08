/**
 * Notifications in-app — logique PURE (aucun import de prisma, aucun accès
 * réseau), pour être couverte par Vitest sans DOM ni base. Les écritures vivent
 * dans les transactions des routes qui produisent l'événement ; ce module ne
 * fournit que les constructeurs de charge utile, les libellés et les filtres.
 *
 * ⚠️ UNE NOTIFICATION EST UN MESSAGE, JAMAIS UNE AUTORISATION. L'autorité d'une
 * invitation reste `WorkspaceInvitation`, celle d'un accès reste `Membership`.
 * Une notification purgée, non lue ou jamais affichée ne doit RIEN changer aux
 * droits — sans cette règle, la purge paresseuse deviendrait une révocation
 * d'accès silencieuse.
 */

import type { WorkspaceRole } from "./workspace";

/**
 * Les types produits aujourd'hui. Stockés en String et non en enum Prisma —
 * comme `Membership.role` et `Sprint.state`.
 *
 * ⚠️ Un type INCONNU doit dégrader en ligne générique, jamais faire planter le
 * panneau : un retour arrière du code laisse en base des lignes déjà écrites,
 * et une cloche qui casse est pire qu'une cloche qui dit « événement ».
 */
export const NOTIFICATION_TYPES = [
  "workspace_invitation",
  "workspace_joined",
  "role_changed",
  "membership_removed",
  "invitation_declined",
] as const;

export type NotificationType = (typeof NOTIFICATION_TYPES)[number];

export const isKnownNotificationType = (t: string): t is NotificationType =>
  (NOTIFICATION_TYPES as readonly string[]).includes(t);

/**
 * Instantané des LIBELLÉS au moment de l'émission.
 *
 * ⚠️ On stocke des libellés, JAMAIS la phrase rendue : figer la phrase
 * empêcherait de la re-rendre en lien, et dupliquerait un `displayName` qui
 * doit rester vivant (c'est la doctrine de `RecordRevision`, qui ne copie que
 * ce qui n'existe nulle part ailleurs).
 *
 * ⚠️ Et JAMAIS le rôle OFFERT par une invitation : ré-inviter met à jour le
 * rôle sur la MÊME ligne, une copie périmée afficherait « éditeur » sur un
 * bouton qui accorde « lecteur ». Le rôle se lit sur l'invitation, à
 * l'affichage. `roleBefore`/`roleAfter` sont l'exception assumée : ce sont des
 * faits PASSÉS d'un changement déjà appliqué, pas une promesse d'accès.
 */
export type NotificationPayload = {
  /** Repli quand l'espace a été supprimé — la relation est en Cascade, mais on
   *  affiche aussi des notifications dont l'espace vient de disparaître. */
  workspaceName?: string;
  /** Repli quand l'acteur a été supprimé (la FK est en SetNull). */
  actorName?: string;
  roleBefore?: WorkspaceRole;
  roleAfter?: WorkspaceRole;
};

/**
 * Ne lève JAMAIS : une ligne au JSON illisible doit s'afficher en dégradé, pas
 * faire tomber le panneau entier. Même contrat que les `parse*` de lib/db.ts.
 */
export function parseNotificationPayload(raw: string | null | undefined): NotificationPayload {
  if (!raw) return {};
  try {
    const v: unknown = JSON.parse(raw);
    return v && typeof v === "object" && !Array.isArray(v) ? (v as NotificationPayload) : {};
  } catch {
    return {};
  }
}

export function serializeNotificationPayload(p: NotificationPayload): string {
  return JSON.stringify(p);
}

/**
 * Rétention. Une SEULE règle, par ÂGE, lue ou non.
 *
 * Motifs, du plus fort au plus faible : la notification est un artefact de
 * DISTRIBUTION, pas la piste d'audit (celle-ci existe déjà — `RecordRevision`,
 * à rétention indéfinie) ; garder les non-lues indéfiniment ferait croître la
 * table sans borne pour un compte inactif ; les autres rétentions du projet
 * sont plates et par âge (30 j corbeille, 30 j uploads, 7 j invitations) ; et
 * 90 j dépasse largement les 30 j de récupérabilité d'une carte, donc on ne
 * purge jamais une notification dont la cible est encore restaurable.
 */
export const NOTIFICATION_PURGE_DAYS = 90;

export function notificationPurgeCutoff(now: Date = new Date()): Date {
  return new Date(now.getTime() - NOTIFICATION_PURGE_DAYS * 86_400_000);
}

/**
 * Une notification d'invitation porte-t-elle encore un bouton utilisable ?
 *
 * ⚠️ Le FILTRE est l'autorité, la purge n'est que du ménage — mot pour mot la
 * doctrine des invitations. `WorkspaceInvitation` ne purge ses expirées qu'au
 * claim d'un email donné, donc jamais si la personne ne se connecte pas : la
 * notification NE DOIT PAS se fier à la disparition de la ligne pour cesser
 * d'être actionnable.
 */
export function isInvitationActionable(
  invitation: { createdAt: Date; declinedAt: Date | null } | null | undefined,
  invitationCutoff: Date
): boolean {
  if (!invitation) return false;
  if (invitation.declinedAt) return false;
  return invitation.createdAt >= invitationCutoff;
}

/** Ce dont l'affichage a besoin, une fois les références résolues. */
export type NotificationView = {
  id: string;
  type: string;
  createdAt: Date;
  read: boolean;
  /** Phrase rendue À LA LECTURE, jamais stockée. */
  message: string;
  /** Vrai seulement pour une invitation encore vivante : porte Accepter/Refuser. */
  actionable: boolean;
  workspaceId: string | null;
};

const NOM_INCONNU = "Quelqu'un";
const ESPACE_INCONNU = "un espace";

const ROLE_LABELS: Record<string, string> = {
  admin: "admin",
  editor: "éditeur",
  viewer: "lecteur",
};

const roleLabel = (r: string | undefined) => (r && ROLE_LABELS[r]) || r || "?";

/**
 * Rend la phrase. PURE, et tolérante à tout ce qui a pu disparaître depuis
 * l'émission : l'espace supprimé, l'acteur supprimé (FK en SetNull), le type
 * inconnu après un retour arrière du code.
 */
export function notificationMessage(input: {
  type: string;
  payload: NotificationPayload;
  /** Nom LU en base à l'affichage — prioritaire sur l'instantané du payload. */
  workspaceName?: string | null;
  actorName?: string | null;
}): string {
  const espace = input.workspaceName || input.payload.workspaceName || ESPACE_INCONNU;
  const acteur = input.actorName || input.payload.actorName || NOM_INCONNU;

  switch (input.type) {
    case "workspace_invitation":
      return `${acteur} t'invite à rejoindre « ${espace} ».`;
    case "workspace_joined":
      return `Tu as rejoint « ${espace} ».`;
    case "role_changed":
      return `${acteur} a changé ton rôle dans « ${espace} » : ${roleLabel(
        input.payload.roleBefore
      )} → ${roleLabel(input.payload.roleAfter)}.`;
    case "membership_removed":
      return `${acteur} t'a retiré de « ${espace} ».`;
    case "invitation_declined":
      return `${acteur} a refusé ton invitation à « ${espace} ».`;
    default:
      // Type inconnu : on affiche une ligne neutre plutôt que de casser.
      return `Nouvel événement dans « ${espace} ».`;
  }
}
