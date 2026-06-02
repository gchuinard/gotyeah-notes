import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/session";
import { getMembership } from "@/lib/workspace";

async function getPageWithMembership(pageId: string, userId: string) {
  const page = await prisma.page.findUnique({
    where: { id: pageId },
    select: {
      id: true,
      workspaceId: true,
      visibility: true,
      ownerId: true,
    },
  });
  if (!page) return null;

  const membership = await getMembership(userId, page.workspaceId);
  if (!membership) return null;

  // Private pages are only accessible to their owner
  if (page.visibility === "private" && page.ownerId !== userId) return null;

  return page;
}

export async function GET(
  _: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getSession();
  if (!user) return NextResponse.json({ error: "Non authentifié" }, { status: 401 });

  const { id } = await params;
  const page = await getPageWithMembership(id, user.id);
  if (!page) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const full = await prisma.page.findUnique({ where: { id } });
  return NextResponse.json(full);
}

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getSession();
  if (!user) return NextResponse.json({ error: "Non authentifié" }, { status: 401 });

  const { id } = await params;
  const page = await getPageWithMembership(id, user.id);
  if (!page) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const data = await req.json().catch(() => ({}));
  const { title, content, icon, parentId, position, sectionId } = data;
  const updated = await prisma.page.update({
    where: { id },
    data: { title, content, icon, parentId, position, sectionId },
  });
  return NextResponse.json(updated);
}

export async function DELETE(
  _: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getSession();
  if (!user) return NextResponse.json({ error: "Non authentifié" }, { status: 401 });

  const { id } = await params;
  const page = await getPageWithMembership(id, user.id);
  if (!page) return NextResponse.json({ error: "Not found" }, { status: 404 });

  await prisma.page.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
