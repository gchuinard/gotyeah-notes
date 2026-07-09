import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/session";
import { getMembership } from "@/lib/workspace";
import { setPageSection, type SetPageSectionInput } from "@/lib/pages";

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

const patchPageSchema = z.object({
  title: z.string().optional(),
  content: z.string().optional(),
  icon: z.string().nullable().optional(),
  position: z.number().optional(),
  parentId: z.string().nullable().optional(),
  sectionId: z.string().nullable().optional(),
});

export async function GET(
  _: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getSession();
  if (!user) return NextResponse.json({ error: "Non authentifié" }, { status: 401 });

  const { id } = await params;
  const page = await getPageWithMembership(id, user.id);
  if (!page) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const full = await prisma.page.findUnique({
    where: { id },
    include: { database: { select: { id: true } } },
  });
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

  const raw = await req.json().catch(() => null);
  const parsed = patchPageSchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Validation failed", details: parsed.error.flatten() },
      { status: 400 }
    );
  }
  const data = parsed.data;
  const hasKey = (k: string) => !!raw && typeof raw === "object" && k in raw;

  // Déplacement (parentId/sectionId) : passe par setPageSection (transaction,
  // resync visibility récursive, anti-cycle, garde section-hors-racine).
  if (hasKey("parentId") || hasKey("sectionId")) {
    const moveInput: SetPageSectionInput = {};
    if (hasKey("parentId")) moveInput.parentId = data.parentId ?? null;
    if (hasKey("sectionId")) moveInput.sectionId = data.sectionId ?? null;

    const result = await setPageSection(id, moveInput);
    if (!result.ok) {
      const status = result.code === "target_not_found" || result.code === "page_not_found" ? 404 : 400;
      return NextResponse.json({ error: result.code }, { status });
    }
  }

  // Champs de contenu (title/content/icon/position) : mise à jour simple.
  const contentData: {
    title?: string;
    content?: string;
    icon?: string | null;
    position?: number;
  } = {};
  if (hasKey("title")) contentData.title = data.title;
  if (hasKey("content")) contentData.content = data.content;
  if (hasKey("icon")) contentData.icon = data.icon;
  if (hasKey("position")) contentData.position = data.position;
  if (Object.keys(contentData).length > 0) {
    await prisma.page.update({ where: { id }, data: contentData });
  }

  const updated = await prisma.page.findUnique({ where: { id } });
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
