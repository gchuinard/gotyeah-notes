import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/session";
import { getMembership, hasRole } from "@/lib/workspace";

/**
 * Révoque une invitation en attente — ADMIN. Définitif : une invitation n'a pas
 * de corbeille (seuls Page et Record en ont), la ré-émettre coûte un clic.
 */
export async function DELETE(
  _: Request,
  { params }: { params: Promise<{ id: string; invitationId: string }> }
) {
  const user = await getSession();
  if (!user) return NextResponse.json({ error: "Non authentifié" }, { status: 401 });

  const { id: workspaceId, invitationId } = await params;
  const membership = await getMembership(user.id, workspaceId);
  if (!membership) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (!hasRole(membership, "admin")) {
    return NextResponse.json({ error: "Rôle insuffisant" }, { status: 403 });
  }

  // Le workspaceId est dans le WHERE : un id d'invitation d'un AUTRE espace ne
  // doit pas être supprimable depuis celui-ci, même par un admin légitime d'ici.
  const { count } = await prisma.workspaceInvitation.deleteMany({
    where: { id: invitationId, workspaceId },
  });
  if (count === 0) return NextResponse.json({ error: "Not found" }, { status: 404 });

  return NextResponse.json({ ok: true });
}
