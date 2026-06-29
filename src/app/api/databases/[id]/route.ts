import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/session";
import { checkDatabaseAccess } from "@/lib/workspace";
import { parseManyDatabaseProperties, parseManyViews } from "@/lib/db";

const patchDatabaseSchema = z.object({
  // Document BlockNote JSON (modèle de corps des records), ou null pour l'effacer.
  recordTemplate: z.string().nullable().optional(),
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
