import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/session";
import { getMembership } from "@/lib/workspace";
import { deleteSectionReassigningRoots } from "@/lib/pages";

const patchSectionSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  icon: z.string().nullable().optional(),
  position: z.number().optional(),
});

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

  // req.json() sans catch renvoyait 500 sur un body vide/malformé → 400 structuré (zod).
  const body = await req.json().catch(() => null);
  const parsed = patchSectionSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Validation failed", details: parsed.error.flatten() },
      { status: 400 }
    );
  }
  const { name, icon, position } = parsed.data;
  const updated = await prisma.section.update({
    where: { id },
    data: {
      ...(name !== undefined && { name }),
      ...(icon !== undefined && { icon }),
      ...(position !== undefined && { position }),
    },
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

  const result = await deleteSectionReassigningRoots(id);
  if (!result.ok) {
    if (result.code === "no_fallback") {
      return NextResponse.json(
        {
          error:
            "Impossible de supprimer la dernière section de ce type : ses pages n'auraient plus de section de repli.",
        },
        { status: 409 }
      );
    }
    // section_not_found : disparue entre le check d'accès et la transaction (anti-leak).
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  return NextResponse.json({ ok: true });
}
