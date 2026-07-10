import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/session";
import { getMembership } from "@/lib/workspace";

const LIMIT = 12;

export type SearchResult =
  | { kind: "page"; id: string; title: string; icon: string | null; parentId: string | null }
  | { kind: "record"; id: string; pageId: string; title: string; icon: string | null };

export async function GET(req: Request) {
  const user = await getSession();
  if (!user) return NextResponse.json({ error: "Non authentifié" }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const q = searchParams.get("q")?.trim();
  const workspaceId = searchParams.get("workspaceId") ?? undefined;
  if (!q || q.length < 1) return NextResponse.json([]);

  // Scope workspace : soit celui demandé (après vérif Membership), soit — à défaut —
  // l'ensemble des workspaces dont l'user est membre. Sans ce garde, une recherche
  // sans workspaceId remonterait les pages "team" de TOUTE l'instance.
  let workspaceIds: string[];
  if (workspaceId) {
    const membership = await getMembership(user.id, workspaceId);
    if (!membership) return NextResponse.json({ error: "Not found" }, { status: 404 });
    workspaceIds = [workspaceId];
  } else {
    const memberships = await prisma.membership.findMany({
      where: { userId: user.id },
      select: { workspaceId: true },
    });
    workspaceIds = memberships.map((m) => m.workspaceId);
  }

  // Un record n'a pas de visibility propre : on applique la règle team OU
  // private+owner sur sa PAGE hôte (via database → page), comme pour les pages.
  // Le scope workspace ci-dessus s'applique AUSSI aux records (sinon une recherche
  // sans workspaceId remonterait les fiches "team" de toute l'instance).
  const pageVisibility = {
    workspaceId: { in: workspaceIds },
    trashedAt: null, // exclut la corbeille (pages, et pages hôtes des records)
    OR: [
      { visibility: "team" },
      { visibility: "private", ownerId: user.id },
    ],
  };

  const [pages, records] = await Promise.all([
    prisma.page.findMany({
      where: {
        ...pageVisibility,
        AND: [{ OR: [{ title: { contains: q } }, { content: { contains: q } }] }],
      },
      select: { id: true, title: true, icon: true, parentId: true, updatedAt: true },
      take: LIMIT,
      orderBy: { updatedAt: "desc" },
    }),
    prisma.record.findMany({
      where: {
        title: { contains: q },
        trashedAt: null, // record lui-même hors corbeille
        database: { page: pageVisibility }, // + page hôte hors corbeille
      },
      select: {
        id: true,
        title: true,
        icon: true,
        updatedAt: true,
        database: { select: { pageId: true } },
      },
      take: LIMIT,
      orderBy: { updatedAt: "desc" },
    }),
  ]);

  const merged = [
    ...pages.map((p) => ({
      result: {
        kind: "page" as const,
        id: p.id,
        title: p.title,
        icon: p.icon,
        parentId: p.parentId,
      },
      updatedAt: p.updatedAt,
    })),
    ...records.map((r) => ({
      result: {
        kind: "record" as const,
        id: r.id,
        pageId: r.database.pageId,
        title: r.title,
        icon: r.icon,
      },
      updatedAt: r.updatedAt,
    })),
  ]
    .sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime())
    .slice(0, LIMIT)
    .map((m) => m.result);

  return NextResponse.json(merged satisfies SearchResult[]);
}
