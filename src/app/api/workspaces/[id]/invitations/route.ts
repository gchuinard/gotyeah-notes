import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/session";
import { getMembership, hasRole } from "@/lib/workspace";

/**
 * Invitations en attente d'un espace — ADMIN uniquement.
 *
 * ⚠️ Volontairement séparée de GET /members, qui est ouverte à tout membre et
 * dont la clé SWR est partagée avec le board (useWorkspaceMembers alimente les
 * cellules « utilisateur », les filtres et les colonnes kanban). Y injecter des
 * pseudo-membres sans userId ferait apparaître des assignés fantômes.
 *
 * Réservée aux admins parce qu'un email invité est l'adresse de quelqu'un qui
 * n'a rien accepté et n'est pas encore partie prenante de l'espace.
 */
export async function GET(
  _: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getSession();
  if (!user) return NextResponse.json({ error: "Non authentifié" }, { status: 401 });

  const { id: workspaceId } = await params;
  const membership = await getMembership(user.id, workspaceId);
  if (!membership) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (!hasRole(membership, "admin")) {
    return NextResponse.json({ error: "Rôle insuffisant" }, { status: 403 });
  }

  const invitations = await prisma.workspaceInvitation.findMany({
    where: { workspaceId },
    select: {
      id: true,
      email: true,
      role: true,
      createdAt: true,
      inviter: { select: { displayName: true } },
    },
    orderBy: { createdAt: "asc" },
  });

  return NextResponse.json(
    invitations.map((i) => ({
      id: i.id,
      email: i.email,
      role: i.role,
      createdAt: i.createdAt,
      invitedByName: i.inviter?.displayName ?? null,
    }))
  );
}
