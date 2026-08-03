import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/session";
import { getMembership, hasRole } from "@/lib/workspace";

const createSectionSchema = z.object({
  workspaceId: z.string().min(1),
  name: z.string().min(1).max(100),
  type: z.enum(["team", "private"]).default("team"),
  icon: z.string().nullable().optional(),
});

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

  const body = await req.json().catch(() => null);
  const parsed = createSectionSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Validation failed", details: parsed.error.flatten() },
      { status: 400 }
    );
  }
  const { workspaceId, name, type, icon } = parsed.data;

  const membership = await getMembership(user.id, workspaceId);
  if (!membership) return NextResponse.json({ error: "Not found" }, { status: 404 });
  // Créer une section = organiser la sidebar : geste éditeur (seul le DELETE est admin).
  if (!hasRole(membership, "editor")) {
    return NextResponse.json({ error: "Rôle insuffisant" }, { status: 403 });
  }

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
