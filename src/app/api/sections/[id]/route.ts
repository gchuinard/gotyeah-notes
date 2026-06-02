import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/session";
import { getMembership } from "@/lib/workspace";

async function getSectionWithMembership(sectionId: string, userId: string) {
  const section = await prisma.section.findUnique({
    where: { id: sectionId },
    select: { id: true, workspaceId: true },
  });
  if (!section) return null;
  const membership = await getMembership(userId, section.workspaceId);
  if (!membership) return null;
  return section;
}

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getSession();
  if (!user) return NextResponse.json({ error: "Non authentifié" }, { status: 401 });

  const { id } = await params;
  const section = await getSectionWithMembership(id, user.id);
  if (!section) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const data = await req.json();
  const { name, icon, position } = data;
  const updated = await prisma.section.update({
    where: { id },
    data: { name, icon, position },
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
  const section = await getSectionWithMembership(id, user.id);
  if (!section) return NextResponse.json({ error: "Not found" }, { status: 404 });

  await prisma.section.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
