import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/session";
import { getMembership, isPageAccessible } from "@/lib/workspace";

export async function POST(
  _: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getSession();
  if (!user) return NextResponse.json({ error: "Non authentifié" }, { status: 401 });

  const { id } = await params;
  const page = await prisma.page.findUnique({
    where: { id },
    select: { workspaceId: true, visibility: true, ownerId: true, trashedAt: true },
  });
  if (!page || page.trashedAt) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const membership = await getMembership(user.id, page.workspaceId);
  if (!membership) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (!isPageAccessible(page, user.id, user.isService)) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  await prisma.pageVisit.upsert({
    where: { userId_pageId: { userId: user.id, pageId: id } },
    update: { visitedAt: new Date() },
    create: { userId: user.id, pageId: id },
  });

  return NextResponse.json({ ok: true });
}
