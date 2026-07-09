import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/session";
import { getMembership } from "@/lib/workspace";

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

  const pages = await prisma.page.findMany({
    where: {
      workspaceId: { in: workspaceIds },
      OR: [
        { visibility: "team" },
        { visibility: "private", ownerId: user.id },
      ],
      AND: [
        {
          OR: [
            { title: { contains: q } },
            { content: { contains: q } },
          ],
        },
      ],
    },
    select: { id: true, title: true, icon: true, parentId: true },
    take: 12,
    orderBy: { updatedAt: "desc" },
  });

  return NextResponse.json(pages);
}
