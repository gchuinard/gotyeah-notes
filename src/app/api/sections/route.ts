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

  const sections = await prisma.section.findMany({
    where: { workspaceId },
    orderBy: { position: "asc" },
    select: { id: true, name: true, type: true, icon: true, position: true },
  });
  return NextResponse.json(sections);
}

export async function POST(req: Request) {
  const user = await getSession();
  if (!user) return NextResponse.json({ error: "Non authentifié" }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const { workspaceId, name, type = "team", icon } = body;
  if (!workspaceId || !name) {
    return NextResponse.json({ error: "workspaceId et name requis" }, { status: 400 });
  }

  const membership = await getMembership(user.id, workspaceId);
  if (!membership) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const last = await prisma.section.findFirst({
    where: { workspaceId },
    orderBy: { position: "desc" },
    select: { position: true },
  });
  const position = (last?.position ?? 0) + 1;

  const section = await prisma.section.create({
    data: { workspaceId, name, type, icon, position },
  });
  return NextResponse.json(section);
}
