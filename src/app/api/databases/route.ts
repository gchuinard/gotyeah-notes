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
import { DATABASE_TEMPLATES } from "@/lib/templates";

const createDatabaseSchema = z.object({
  pageId: z.string().min(1),
  template: z.enum(["ticket", "bug"]).optional(),
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

  const { pageId, template } = result.data;

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

  const tpl = template ? DATABASE_TEMPLATES[template] : null;

  const db = await prisma.$transaction(async (tx) => {
    const database = await tx.database.create({
      data: {
        pageId,
        ...(tpl && { recordTemplate: tpl.body }),
      },
    });

    const titleProperty = await tx.databaseProperty.create({
      data: {
        databaseId: database.id,
        name: "Titre",
        type: "title",
        position: 1000,
        ...serializeDatabaseProperty({ config: { type: "title" } }),
      },
    });

    const tableView = await tx.view.create({
      data: {
        databaseId: database.id,
        name: "Vue principale",
        type: "table",
        position: 1000,
        ...serializeView({ config: {} }),
      },
    });

    const properties = [titleProperty];
    const views = [tableView];

    // Scaffolding d'un modèle (tickets, bugs…) : colonnes + vue kanban groupée.
    if (tpl) {
      const idByName: Record<string, string> = {};
      let position = 2000;
      for (const preset of tpl.properties) {
        const prop = await tx.databaseProperty.create({
          data: {
            databaseId: database.id,
            name: preset.name,
            type: preset.type,
            position,
            ...serializeDatabaseProperty({ config: preset.config }),
          },
        });
        properties.push(prop);
        idByName[preset.name] = prop.id;
        position += 1000;
      }

      const kanbanView = await tx.view.create({
        data: {
          databaseId: database.id,
          name: "Par statut",
          type: "kanban",
          position: 2000,
          ...serializeView({
            config: { groupByPropertyId: idByName[tpl.kanbanGroupProperty] },
          }),
        },
      });
      views.push(kanbanView);
    }

    return { ...database, properties, views };
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
