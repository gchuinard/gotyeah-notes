import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/session";
import { checkDatabaseAccess, isPageAccessible } from "@/lib/workspace";
import { parseManyDatabaseProperties, parseManyViews } from "@/lib/db";

const patchDatabaseSchema = z.object({
  // Document BlockNote JSON (modèle de corps des records), ou null pour l'effacer.
  recordTemplate: z.string().nullable().optional(),
  // Page « 📓 Patch notes » cible pour l'auto-append à la clôture d'un sprint, ou
  // null pour retirer le mapping. La page doit appartenir au même workspace ET être
  // accessible à l'utilisateur (jamais la page privée d'un autre membre).
  patchNotesPageId: z.string().nullable().optional(),
});

export async function GET(
  _: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getSession();
  if (!user) return NextResponse.json({ error: "Non authentifié" }, { status: 401 });

  const { id } = await params;
  const access = await checkDatabaseAccess(id, user.id);
  if (!access) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const db = await prisma.database.findUnique({
    where: { id },
    include: {
      properties: { orderBy: { position: "asc" } },
      views: { orderBy: { position: "asc" } },
    },
  });

  // db is guaranteed to exist since checkDatabaseAccess succeeded
  return NextResponse.json({
    ...db!,
    properties: parseManyDatabaseProperties(db!.properties),
    views: parseManyViews(db!.views),
  });
}

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getSession();
  if (!user) return NextResponse.json({ error: "Non authentifié" }, { status: 401 });

  const { id } = await params;
  const access = await checkDatabaseAccess(id, user.id);
  if (!access) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const body = await req.json().catch(() => null);
  const result = patchDatabaseSchema.safeParse(body);
  if (!result.success) {
    return NextResponse.json(
      { error: "Validation failed", details: result.error.flatten() },
      { status: 400 }
    );
  }

  // Mapping « Patch notes » : la page cible doit exister dans le même workspace ET
  // être accessible à l'utilisateur — jamais la page privée d'un autre membre, sinon
  // l'auto-append écrirait dans un contenu privé. null retire le mapping, sans contrôle.
  if (result.data.patchNotesPageId) {
    const target = await prisma.page.findUnique({
      where: { id: result.data.patchNotesPageId },
      select: { workspaceId: true, visibility: true, ownerId: true },
    });
    if (
      !target ||
      target.workspaceId !== access.workspaceId ||
      !isPageAccessible(target, user.id)
    ) {
      return NextResponse.json(
        { error: "Page « Patch notes » introuvable ou inaccessible dans ce workspace." },
        { status: 400 }
      );
    }
  }

  const updated = await prisma.database.update({
    where: { id },
    data: result.data,
    include: {
      properties: { orderBy: { position: "asc" } },
      views: { orderBy: { position: "asc" } },
    },
  });

  return NextResponse.json({
    ...updated,
    properties: parseManyDatabaseProperties(updated.properties),
    views: parseManyViews(updated.views),
  });
}

export async function DELETE(
  _: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getSession();
  if (!user) return NextResponse.json({ error: "Non authentifié" }, { status: 401 });

  const { id } = await params;
  const access = await checkDatabaseAccess(id, user.id);
  if (!access) return NextResponse.json({ error: "Not found" }, { status: 404 });

  await prisma.database.delete({ where: { id } });

  return NextResponse.json({ ok: true });
}
