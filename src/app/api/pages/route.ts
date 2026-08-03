import { NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { getMembership, hasRole } from "@/lib/workspace";
import { createPage } from "@/lib/pages";
import { prisma } from "@/lib/prisma";

export async function GET(req: Request) {
  const user = await getSession();
  if (!user) return NextResponse.json({ error: "Non authentifié" }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const workspaceId = searchParams.get("workspaceId");
  if (!workspaceId) return NextResponse.json([]);

  const membership = await getMembership(user.id, workspaceId);
  if (!membership) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const pages = await prisma.page.findMany({
    where: {
      workspaceId,
      trashedAt: null, // exclut la corbeille
      OR: [
        { visibility: "team" },
        { visibility: "private", ownerId: user.id },
      ],
    },
    orderBy: [{ position: "asc" }],
    select: {
      id: true,
      title: true,
      icon: true,
      parentId: true,
      position: true,
      sectionId: true,
      visibility: true,
      ownerId: true,
    },
  });
  return NextResponse.json(pages);
}

export async function POST(req: Request) {
  const user = await getSession();
  if (!user) return NextResponse.json({ error: "Non authentifié" }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const { parentId = null, title = "Sans titre", workspaceId, sectionId = null } = body;

  if (!workspaceId) {
    return NextResponse.json({ error: "workspaceId requis" }, { status: 400 });
  }
  const membership = await getMembership(user.id, workspaceId);
  if (!membership) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (!hasRole(membership, "editor")) {
    return NextResponse.json({ error: "Rôle insuffisant" }, { status: 403 });
  }

  const page = await createPage({ title, parentId, workspaceId, ownerId: user.id, sectionId });
  return NextResponse.json(page);
}
