import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/session";
import { checkRecordAccess, hasRole } from "@/lib/workspace";

/** Restaure un record en corbeille. Refuse si la page hôte est elle-même en corbeille. */
export async function POST(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getSession();
  if (!user) return NextResponse.json({ error: "Non authentifié" }, { status: 401 });

  const { id } = await params;
  // includeTrashed : accéder au record trashé pour l'auth (membership + confidentialité).
  const access = await checkRecordAccess(id, user.id, true);
  if (!access) return NextResponse.json({ error: "Not found" }, { status: 404 });
  // Restaurer = inverse de la mise à la corbeille, même niveau : editor.
  if (!hasRole(access.membership, "editor")) {
    return NextResponse.json({ error: "Rôle insuffisant" }, { status: 403 });
  }

  // On ne restaure pas un record dans une page hôte encore en corbeille : restaurer la page.
  const host = await prisma.record.findUnique({
    where: { id },
    select: { database: { select: { page: { select: { trashedAt: true } } } } },
  });
  if (host?.database.page.trashedAt) {
    return NextResponse.json(
      { error: "La page hôte est en corbeille — restaure-la d'abord." },
      { status: 409 }
    );
  }

  await prisma.record.update({ where: { id }, data: { trashedAt: null } });
  return NextResponse.json({ ok: true });
}
