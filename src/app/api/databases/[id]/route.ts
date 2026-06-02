import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/session";
import { checkDatabaseAccess } from "@/lib/workspace";
import { parseManyDatabaseProperties, parseManyViews } from "@/lib/db";

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
