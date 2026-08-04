import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/session";
import { getMembership, hasRole, isPageAccessible } from "@/lib/workspace";
import { setPageSection, type SetPageSectionInput } from "@/lib/pages";
import { trashPageSubtree } from "@/lib/trash";

async function getPageWithMembership(pageId: string, userId: string, includeTrashed = false) {
  const page = await prisma.page.findUnique({
    where: { id: pageId },
    select: {
      id: true,
      workspaceId: true,
      visibility: true,
      ownerId: true,
      trashedAt: true,
    },
  });
  if (!page) return null;

  // Page en corbeille → inaccessible en accès normal (restore/purge passent includeTrashed).
  if (!includeTrashed && page.trashedAt) return null;

  const membership = await getMembership(userId, page.workspaceId);
  if (!membership) return null;

  // Page privée : réservée à son propriétaire — sauf compte de service.
  if (!isPageAccessible(page, userId, membership.user.isService)) return null;

  return { page, membership };
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
  const access = await getPageWithMembership(id, user.id);
  if (!access) return NextResponse.json({ error: "Not found" }, { status: 404 });

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
  const access = await getPageWithMembership(id, user.id);
  if (!access) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (!hasRole(access.membership, "editor")) {
    return NextResponse.json({ error: "Rôle insuffisant" }, { status: 403 });
  }

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
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getSession();
  if (!user) return NextResponse.json({ error: "Non authentifié" }, { status: 401 });

  const { id } = await params;
  // ?permanent=1 : suppression DÉFINITIVE (depuis la corbeille) — accède aux pages trashées.
  const permanent = new URL(req.url).searchParams.get("permanent") === "1";

  const access = await getPageWithMembership(id, user.id, permanent);
  if (!access) return NextResponse.json({ error: "Not found" }, { status: 404 });
  // Double gate : corbeille (réversible) = editor, ?permanent=1 (définitif) = admin.
  if (!hasRole(access.membership, permanent ? "admin" : "editor")) {
    return NextResponse.json({ error: "Rôle insuffisant" }, { status: 403 });
  }

  if (permanent) {
    // Hard delete : cascade FK sur le sous-arbre + database + records.
    await prisma.page.delete({ where: { id } });
    return NextResponse.json({ ok: true });
  }

  // Soft delete : estampe trashedAt sur toute la page + son sous-arbre (corbeille).
  await trashPageSubtree(id);
  return NextResponse.json({ ok: true });
}
