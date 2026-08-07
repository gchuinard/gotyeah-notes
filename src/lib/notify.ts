import { serializeNotificationPayload, type NotificationType } from "./notifications";
import type { NotificationPayload } from "./notifications";

/**
 * ÉCRITURE des notifications. Séparé de `lib/notifications.ts`, qui reste pur et
 * importable côté client : ici on touche à Prisma, donc jamais de navigateur.
 *
 * ⚠️ À appeler DANS la transaction qui produit l'événement, jamais après. C'est
 * la doctrine de `RecordRevision` : une notification écrite hors transaction
 * survivrait à un rollback et annoncerait un fait qui n'a pas eu lieu.
 *
 * ⚠️ NE LÈVE JAMAIS. Un libellé qui plante ne doit pas faire échouer l'ajout
 * d'un membre ou un changement de rôle — le geste métier prime sur son
 * annonce. Même enveloppe que `claimInvitationsSafely`.
 */

/** Ligne telle qu'on l'écrit — les champs générés (id, createdAt) sont omis. */
type NotificationRow = {
  userId: string;
  type: string;
  workspaceId: string | null;
  actorId: string | null;
  invitationId?: string | null;
  payload: string;
};

/**
 * Le sous-ensemble de client Prisma dont on a besoin, décrit STRUCTURELLEMENT
 * plutôt qu'importé : la même signature accepte le client global et le `tx`
 * d'une transaction — c'est le patron de `nextPosition` et de
 * `revokeInvitationsFrom`, qui rend ces helpers appelables des deux côtés.
 */
type NotifyClient = {
  notification: {
    createMany: (args: { data: NotificationRow[] }) => Promise<{ count: number }>;
    upsert: (args: {
      where: { userId_invitationId: { userId: string; invitationId: string } };
      create: NotificationRow;
      update: {
        type: string;
        payload: string;
        actorId: string | null;
        readAt: Date | null;
        createdAt: Date;
      };
    }) => Promise<unknown>;
  };
  user: {
    findMany: (args: {
      where: { id: { in: string[] }; isService: boolean };
      select: { id: true };
    }) => Promise<{ id: string }[]>;
  };
};

export type NotifyInput = {
  userId: string;
  type: NotificationType;
  workspaceId?: string | null;
  actorId?: string | null;
  invitationId?: string | null;
  payload?: NotificationPayload;
};

/**
 * Écrit des notifications, en filtrant ce qui ne doit jamais en produire.
 *
 * ⚠️ Deux filtres, tous deux load-bearing :
 *  - on ne se notifie JAMAIS de sa propre action (l'acteur est exclu) — sinon
 *    changer son propre rôle ou quitter un espace s'annoncerait à soi-même ;
 *  - un compte de SERVICE n'est jamais destinataire : il n'a pas de boîte, pas
 *    de cloche, et il voit les pages privées des espaces où il est membre.
 */
export async function notify(
  client: NotifyClient,
  inputs: NotifyInput[]
): Promise<number> {
  try {
    const candidates = inputs.filter((n) => n.userId && n.userId !== n.actorId);
    if (candidates.length === 0) return 0;

    // Un seul aller-retour pour écarter les comptes de service, quel que soit
    // le nombre de destinataires.
    const humains = await client.user.findMany({
      where: { id: { in: [...new Set(candidates.map((n) => n.userId))] }, isService: false },
      select: { id: true },
    });
    const ok = new Set(humains.map((u) => u.id));
    const retenus = candidates.filter((n) => ok.has(n.userId));
    if (retenus.length === 0) return 0;

    // Les notifications d'INVITATION passent par un upsert : ré-inviter met à
    // jour la même ligne d'invitation, sans cette clé chaque relance empilerait
    // une carte « Accepter » de plus. Les autres n'ont pas d'invitationId, donc
    // pas de contrainte d'unicité (les NULL restent distincts en SQLite).
    const avecInvitation = retenus.filter((n) => n.invitationId);
    const simples = retenus.filter((n) => !n.invitationId);

    for (const n of avecInvitation) {
      await client.notification.upsert({
        where: { userId_invitationId: { userId: n.userId, invitationId: n.invitationId! } },
        create: {
          userId: n.userId,
          type: n.type,
          workspaceId: n.workspaceId ?? null,
          actorId: n.actorId ?? null,
          invitationId: n.invitationId,
          payload: serializeNotificationPayload(n.payload ?? {}),
        },
        update: {
          type: n.type,
          payload: serializeNotificationPayload(n.payload ?? {}),
          actorId: n.actorId ?? null,
          // Une relance remet la carte en évidence : elle redevient non lue.
          readAt: null,
          createdAt: new Date(),
        },
      });
    }

    if (simples.length > 0) {
      await client.notification.createMany({
        data: simples.map((n) => ({
          userId: n.userId,
          type: n.type,
          workspaceId: n.workspaceId ?? null,
          actorId: n.actorId ?? null,
          payload: serializeNotificationPayload(n.payload ?? {}),
        })),
      });
    }

    return retenus.length;
  } catch (err) {
    console.error(`[notify-failed] err=${err instanceof Error ? err.name : "unknown"}`);
    return 0;
  }
}
