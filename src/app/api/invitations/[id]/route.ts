import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/session";
import { normalizeEmail } from "@/lib/oidc";
import { invitationCutoff } from "@/lib/invitations";
import { notify } from "@/lib/notify";
import { WORKSPACE_ROLES, type WorkspaceRole } from "@/lib/workspace";

/**
 * Accepter ou refuser une invitation qui me VISE — pour quelqu'un qui a déjà un
 * compte. Le parcours de l'invité sans compte passe par `/api/invitations/claim`,
 * qui porte un jeton au lieu d'une session.
 *
 * ⚠️ L'autorité est l'INVITATION, jamais la notification : on retrouve la ligne
 * par son id et on vérifie qu'elle vise bien l'email du demandeur. Une
 * notification supprimée, purgée ou jamais lue ne change donc rien aux droits —
 * sans cette règle, la purge paresseuse deviendrait une révocation silencieuse.
 *
 * ⚠️ 404 et non 403 quand l'invitation ne me vise pas : on ne dit pas à un tiers
 * qu'une invitation existe pour quelqu'un d'autre.
 */

const actionSchema = z.object({ action: z.enum(["accept", "decline"]) });

/** Repli au moindre privilège si le rôle stocké est illisible (cf. safeRole). */
const safeRole = (role: string): WorkspaceRole =>
  (WORKSPACE_ROLES as readonly string[]).includes(role) ? (role as WorkspaceRole) : "viewer";

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getSession();
  if (!user) return NextResponse.json({ error: "Non authentifié" }, { status: 401 });

  const { id } = await params;
  const body = await req.json().catch(() => null);
  const parsed = actionSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Validation failed", details: parsed.error.flatten() },
      { status: 400 }
    );
  }

  const invitation = await prisma.workspaceInvitation.findUnique({
    where: { id },
    select: {
      id: true,
      email: true,
      role: true,
      createdAt: true,
      declinedAt: true,
      workspaceId: true,
      invitedBy: true,
      workspace: { select: { name: true } },
    },
  });

  // Ne me vise pas, ou n'existe plus : 404 dans les deux cas.
  if (!invitation || invitation.email !== normalizeEmail(user.email)) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  if (invitation.declinedAt) {
    return NextResponse.json({ error: "Invitation déjà refusée" }, { status: 409 });
  }
  // Périmée : le FILTRE est l'autorité, pas la purge — la ligne peut très bien
  // exister encore si personne ne s'est connecté depuis.
  if (invitation.createdAt < invitationCutoff()) {
    return NextResponse.json({ error: "Invitation expirée" }, { status: 409 });
  }

  if (parsed.data.action === "decline") {
    await prisma.$transaction(async (tx) => {
      await tx.workspaceInvitation.update({
        where: { id: invitation.id },
        data: { declinedAt: new Date() },
      });
      // L'émetteur apprend le refus : sans ça il voit « en attente » disparaître
      // sans savoir si c'est un refus ou une expiration, et relance dans le vide.
      if (invitation.invitedBy) {
        await notify(tx, [
          {
            userId: invitation.invitedBy,
            type: "invitation_declined",
            workspaceId: invitation.workspaceId,
            actorId: user.id,
            payload: {
              workspaceName: invitation.workspace?.name,
              actorName: user.displayName,
            },
          },
        ]);
      }
    });
    return NextResponse.json({ status: "declined" });
  }

  // ─── Accepter ────────────────────────────────────────────────────────────────
  // Tout dans UNE transaction : la Membership, la consommation de l'invitation
  // (la Membership créée EST la trace, pas de claimedAt) et l'annonce. Un échec
  // partiel laisserait soit un accès sans invitation consommée, soit l'inverse.
  const workspaceId = invitation.workspaceId;
  await prisma.$transaction(async (tx) => {
    const existing = await tx.membership.findUnique({
      where: { userId_workspaceId: { userId: user.id, workspaceId } },
      select: { userId: true },
    });
    // role TOUJOURS explicite : Membership.role a @default("admin") en schéma.
    if (!existing) {
      await tx.membership.create({
        data: { userId: user.id, workspaceId, role: safeRole(invitation.role) },
      });
    }
    await tx.workspaceInvitation.delete({ where: { id: invitation.id } });
    await notify(tx, [
      {
        userId: user.id,
        type: "workspace_joined",
        workspaceId,
        payload: { workspaceName: invitation.workspace?.name },
      },
    ]);
  });

  return NextResponse.json({ status: "accepted", workspaceId });
}
