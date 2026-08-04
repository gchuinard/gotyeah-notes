import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/session";
import { getMembership, pageVisibilityFilter } from "@/lib/workspace";
import { purgeExpiredTrash } from "@/lib/trash";

/**
 * Contenu de la corbeille d'un workspace : pages (racines de suppression seulement)
 * + records trashés individuellement (dont la page hôte n'est PAS trashée).
 * Purge paresseusement les éléments en corbeille depuis plus de 30 j (pas de cron).
 */
export async function GET(req: Request) {
  const user = await getSession();
  if (!user) return NextResponse.json({ error: "Non authentifié" }, { status: 401 });

  const workspaceId = new URL(req.url).searchParams.get("workspaceId");
  if (!workspaceId) return NextResponse.json({ pages: [], records: [] });

  const membership = await getMembership(user.id, workspaceId);
  if (!membership) return NextResponse.json({ error: "Not found" }, { status: 404 });

  await purgeExpiredTrash();

  // `undefined` pour un compte de service : le spread ci-dessous n'ajoute alors
  // aucune restriction (un `OR: undefined` serait, lui, refusé par Prisma).
  const visibility = pageVisibilityFilter(user.id, user.isService);
  const [pages, records] = await Promise.all([
    prisma.page.findMany({
      where: { workspaceId, trashedAt: { not: null }, ...(visibility ?? {}) },
      orderBy: { trashedAt: "desc" },
      select: { id: true, title: true, icon: true, parentId: true, trashedAt: true },
    }),
    prisma.record.findMany({
      // Record trashé isolément, sous une page NON trashée (sinon il revient avec la page).
      where: {
        trashedAt: { not: null },
        database: { page: { workspaceId, trashedAt: null, ...(visibility ?? {}) } },
      },
      orderBy: { trashedAt: "desc" },
      take: 200,
      select: { id: true, title: true, icon: true, trashedAt: true, database: { select: { pageId: true } } },
    }),
  ]);

  // Pages : ne montrer que les RACINES de suppression (pas chaque descendant du sous-arbre).
  const trashedIds = new Set(pages.map((p) => p.id));
  const roots = pages.filter((p) => !p.parentId || !trashedIds.has(p.parentId));

  return NextResponse.json({
    pages: roots.map((p) => ({ id: p.id, title: p.title, icon: p.icon, trashedAt: p.trashedAt })),
    records: records.map((r) => ({
      id: r.id, title: r.title, icon: r.icon, trashedAt: r.trashedAt, pageId: r.database.pageId,
    })),
  });
}
