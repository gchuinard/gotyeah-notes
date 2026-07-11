import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/session";
import { getMembership } from "@/lib/workspace";

export async function GET(req: Request) {
  const user = await getSession();
  if (!user) return NextResponse.json({ error: "Non authentifié" }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const workspaceId = searchParams.get("workspaceId");
  if (!workspaceId) return NextResponse.json([]);

  const membership = await getMembership(user.id, workspaceId);
  if (!membership) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const visits = await prisma.pageVisit.findMany({
    where: {
      userId: user.id,
      // Exclut les pages en corbeille (la ligne PageVisit survit au soft delete).
      page: { workspaceId, trashedAt: null },
    },
    orderBy: { visitedAt: "desc" },
    take: 5,
    select: {
      page: { select: { id: true, title: true, icon: true } },
    },
  });

  return NextResponse.json(visits.map((v) => v.page));
}
