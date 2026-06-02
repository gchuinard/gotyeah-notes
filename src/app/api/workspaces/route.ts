import { NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { createWorkspaceWithDefaults } from "@/lib/workspace";
import { prisma } from "@/lib/prisma";

export async function GET() {
  const user = await getSession();
  if (!user) return NextResponse.json({ error: "Non authentifié" }, { status: 401 });

  const memberships = await prisma.membership.findMany({
    where: { userId: user.id },
    orderBy: { createdAt: "asc" },
    select: { workspace: { select: { id: true, name: true } } },
  });
  return NextResponse.json(memberships.map((m) => m.workspace));
}

export async function POST(req: Request) {
  const user = await getSession();
  if (!user) return NextResponse.json({ error: "Non authentifié" }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const { name = "Mon espace" } = body;
  const workspace = await createWorkspaceWithDefaults(name, user.id);
  return NextResponse.json(workspace);
}
