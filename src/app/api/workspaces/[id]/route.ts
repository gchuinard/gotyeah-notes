import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/session";
import { getMembership } from "@/lib/workspace";

export async function DELETE(
  _: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getSession();
  if (!user) return NextResponse.json({ error: "Non authentifié" }, { status: 401 });

  const { id } = await params;
  const membership = await getMembership(user.id, id);
  if (!membership || membership.role !== "admin") {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  await prisma.workspace.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
