import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/session";
import { invitationCutoff } from "@/lib/invitations";
import {
  parseNotificationPayload,
  notificationMessage,
  notificationPurgeCutoff,
  isInvitationActionable,
} from "@/lib/notifications";

/**
 * La cloche. Deux modes sur la MÊME route :
 *  - `?count=1` → juste le nombre de non-lues. C'est le GET le PLUS CHAUD de
 *    l'application (tous les utilisateurs, toutes les pages) : il ne joint rien
 *    et n'écrit rien.
 *  - sans paramètre → la liste, avec les libellés résolus. C'est l'ouverture du
 *    panneau : un geste délibéré, donc le bon endroit pour la purge paresseuse.
 *
 * ⚠️ La purge ne va JAMAIS sur le compteur. Un `deleteMany` à chaque sondage
 * serait exactement la faute que `claimInvitations` évite en se scopant à un
 * email — « une écriture bornée sur un chemin chaud ». Ici elle est scopée au
 * destinataire, donc bornée par construction.
 *
 * ⚠️ Le compteur applique le MÊME filtre d'âge que la liste, sans compter sur la
 * purge pour l'avoir fait : qui n'ouvre jamais son panneau n'est jamais purgé, et
 * le badge dirait N quand le panneau en montre N−3.
 */

const LIMIT = 50;

export async function GET(req: Request) {
  const user = await getSession();
  if (!user) return NextResponse.json({ error: "Non authentifié" }, { status: 401 });

  const cutoff = notificationPurgeCutoff();
  const url = new URL(req.url);

  if (url.searchParams.get("count") === "1") {
    const unread = await prisma.notification.count({
      where: { userId: user.id, readAt: null, createdAt: { gte: cutoff } },
    });
    return NextResponse.json({ unread });
  }

  // Purge paresseuse, scopée au caller — pas de cron en self-host, même patron
  // que la corbeille. Le filtre reste l'autorité, ceci n'est que du ménage.
  await prisma.notification
    .deleteMany({ where: { userId: user.id, createdAt: { lt: cutoff } } })
    .catch(() => undefined);

  const rows = await prisma.notification.findMany({
    where: { userId: user.id, createdAt: { gte: cutoff } },
    orderBy: { createdAt: "desc" },
    take: LIMIT,
    select: {
      id: true,
      type: true,
      createdAt: true,
      readAt: true,
      workspaceId: true,
      payload: true,
      workspace: { select: { name: true } },
      actor: { select: { displayName: true } },
      invitation: { select: { id: true, role: true, createdAt: true, declinedAt: true } },
    },
  });

  const invCutoff = invitationCutoff();

  return NextResponse.json(
    rows.map((n) => {
      const payload = parseNotificationPayload(n.payload);
      return {
        id: n.id,
        type: n.type,
        createdAt: n.createdAt,
        read: n.readAt !== null,
        workspaceId: n.workspaceId,
        message: notificationMessage({
          type: n.type,
          payload,
          workspaceName: n.workspace?.name ?? null,
          actorName: n.actor?.displayName ?? null,
        }),
        // ⚠️ Calculé À LA LECTURE, jamais stocké : `WorkspaceInvitation` ne
        // purge ses expirées qu'au claim d'un email donné, donc jamais si la
        // personne ne se connecte pas. Se fier à la disparition de la ligne
        // laisserait un bouton « Accepter » qui rendrait une erreur.
        actionable: isInvitationActionable(n.invitation, invCutoff),
        invitationId: n.invitation?.id ?? null,
        // Le rôle est lu SUR L'INVITATION, jamais copié dans la notification :
        // ré-inviter le change sur la même ligne, une copie afficherait
        // « éditeur » sur un bouton qui accorde « lecteur ».
        invitationRole: n.invitation?.role ?? null,
      };
    })
  );
}

/** Tout marquer comme lu. Geste sur SOI : aucun gate de rôle, comme /api/me. */
export async function PATCH() {
  const user = await getSession();
  if (!user) return NextResponse.json({ error: "Non authentifié" }, { status: 401 });

  const { count } = await prisma.notification.updateMany({
    where: { userId: user.id, readAt: null },
    data: { readAt: new Date() },
  });
  return NextResponse.json({ read: count });
}
