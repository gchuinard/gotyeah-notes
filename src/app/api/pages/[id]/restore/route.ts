import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/session";
import { getMembership, hasRole, isPageAccessible } from "@/lib/workspace";
import { restorePageSubtree } from "@/lib/trash";

/** Restaure une page en corbeille ET tout son sous-arbre (trashedAt = null). */
export async function POST(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getSession();
  if (!user) return NextResponse.json({ error: "Non authentifié" }, { status: 401 });

  const { id } = await params;
  // Accès à une page TRASHÉE (les check*Access normaux la filtreraient) : on revérifie
  // membership + confidentialité à la main.
  const page = await prisma.page.findUnique({
    where: { id },
    select: { workspaceId: true, visibility: true, ownerId: true, trashedAt: true },
  });
  if (!page) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const membership = await getMembership(user.id, page.workspaceId);
  if (!membership) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (!isPageAccessible(page, user.id, user.isService)) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  // Restaurer = inverse de la mise à la corbeille, même niveau : editor.
  if (!hasRole(membership, "editor")) {
    return NextResponse.json({ error: "Rôle insuffisant" }, { status: 403 });
  }

  await restorePageSubtree(id);
  return NextResponse.json({ ok: true });
}
