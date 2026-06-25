import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/session";
import { getMembership } from "@/lib/workspace";
import {
  serializeDatabaseProperty,
  serializeView,
  parseManyDatabaseProperties,
  parseManyViews,
} from "@/lib/db";

const createDatabaseSchema = z.object({
  pageId: z.string().min(1),
});

export async function POST(req: Request) {
  const user = await getSession();
  if (!user) return NextResponse.json({ error: "Non authentifié" }, { status: 401 });

  const body = await req.json().catch(() => null);
  const result = createDatabaseSchema.safeParse(body);
  if (!result.success) {
    return NextResponse.json(
      { error: "Validation failed", details: result.error.flatten() },
      { status: 400 }
    );
  }

  const { pageId } = result.data;

  const page = await prisma.page.findUnique({
    where: { id: pageId },
    select: { workspaceId: true },
  });
  if (!page) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const membership = await getMembership(user.id, page.workspaceId);
  if (!membership) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const existing = await prisma.database.findUnique({ where: { pageId } });
  if (existing) {
    return NextResponse.json({ error: "Page already has a database" }, { status: 409 });
  }

  const db = await prisma.$transaction(async (tx) => {
    const database = await tx.database.create({ data: { pageId } });

    const property = await tx.databaseProperty.create({
      data: {
        databaseId: database.id,
        name: "Titre",
        type: "title",
        position: 1000,
        ...serializeDatabaseProperty({ config: { type: "title" } }),
      },
    });

    const view = await tx.view.create({
      data: {
        databaseId: database.id,
        name: "Vue principale",
        type: "table",
        position: 1000,
        ...serializeView({ config: {} }),
      },
    });

    return { ...database, properties: [property], views: [view] };
  });

  return NextResponse.json(
    {
      ...db,
      properties: parseManyDatabaseProperties(db.properties),
      views: parseManyViews(db.views),
    },
    { status: 201 }
  );
}
