import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/session";
import { getMembership, hasRole, isPageAccessible } from "@/lib/workspace";
import {
  serializeDatabaseProperty,
  serializeView,
  parseManyDatabaseProperties,
  parseManyViews,
  type ViewConfig,
} from "@/lib/db";
import {
  resolveBuiltinTemplate,
  isBuiltinTemplateId,
  parseTemplateRow,
  type TemplateShape,
} from "@/lib/templates";

const createDatabaseSchema = z.object({
  pageId: z.string().min(1),
  // Id d'un template fourni ("builtin-…") ou d'un Template du workspace.
  templateId: z.string().optional(),
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

  const { pageId, templateId } = result.data;

  const page = await prisma.page.findUnique({
    where: { id: pageId },
    select: { workspaceId: true, visibility: true, ownerId: true, trashedAt: true },
  });
  if (!page || page.trashedAt) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const membership = await getMembership(user.id, page.workspaceId);
  if (!membership) return NextResponse.json({ error: "Not found" }, { status: 404 });

  // Une database posée sur une page privée d'autrui reste inaccessible (404 anti-leak).
  if (!isPageAccessible(page, user.id, membership.user.isService)) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  if (!hasRole(membership, "editor")) {
    return NextResponse.json({ error: "Rôle insuffisant" }, { status: 403 });
  }

  const existing = await prisma.database.findUnique({ where: { pageId } });
  if (existing) {
    return NextResponse.json({ error: "Page already has a database" }, { status: 409 });
  }

  // Résolution du template (fourni ou du workspace de la page).
  let tpl: TemplateShape | null = null;
  if (templateId) {
    if (isBuiltinTemplateId(templateId)) {
      tpl = resolveBuiltinTemplate(templateId);
    } else {
      const row = await prisma.template.findUnique({ where: { id: templateId } });
      if (row && row.workspaceId === page.workspaceId) tpl = parseTemplateRow(row);
    }
    if (!tpl) return NextResponse.json({ error: "Template introuvable" }, { status: 400 });
  }

  const db = await prisma.$transaction(async (tx) => {
    const database = await tx.database.create({
      data: {
        pageId,
        ...(tpl && {
          templateId: tpl.id,
          recordSections: JSON.stringify(tpl.sections),
        }),
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

    // Scaffolding d'un template : colonnes + (si défini) vue kanban groupée.
    if (tpl) {
      const idByName: Record<string, string> = {};
      let position = 2000;
      for (const col of tpl.columns) {
        const prop = await tx.databaseProperty.create({
          data: {
            databaseId: database.id,
            name: col.name,
            type: col.type,
            position,
            ...serializeDatabaseProperty({ config: col.config }),
          },
        });
        properties.push(prop);
        idByName[col.name] = prop.id;
        position += 1000;
      }

      const groupId = tpl.kanbanGroupProperty
        ? idByName[tpl.kanbanGroupProperty]
        : undefined;
      if (groupId) {
        // Pour un template scrum (backlog défini), le board est scopé au sprint actif
        // (Scrum board) et connaît l'option « terminé » pour la clôture.
        const isScrum = !!tpl.backlog;
        const kanbanConfig: ViewConfig = { groupByPropertyId: groupId };
        if (isScrum) {
          kanbanConfig.sprintScope = "active";
          if (tpl.backlog?.doneOptionId) kanbanConfig.doneStatusOptionId = tpl.backlog.doneOptionId;
        }
        const kanbanView = await tx.view.create({
          data: {
            databaseId: database.id,
            name: isScrum ? "Sprint actif" : "Par statut",
            type: "kanban",
            position: 2000,
            ...serializeView({ config: kanbanConfig }),
          },
        });
        views.push(kanbanView);
      }

      // Vue Backlog (façon Jira) : câblée sur les colonnes points/statut/épic.
      // Position 500 < table (1000) → onglet par défaut pour une DB scrum.
      if (tpl.backlog) {
        const b = tpl.backlog;
        const config: ViewConfig = {};
        if (b.statusColumn && idByName[b.statusColumn]) config.statusPropertyId = idByName[b.statusColumn];
        if (b.pointsColumn && idByName[b.pointsColumn]) config.pointsPropertyId = idByName[b.pointsColumn];
        if (b.epicColumn && idByName[b.epicColumn]) config.epicPropertyId = idByName[b.epicColumn];
        if (b.doneOptionId) config.doneStatusOptionId = b.doneOptionId;

        const backlogView = await tx.view.create({
          data: {
            databaseId: database.id,
            name: "Backlog",
            type: "backlog",
            position: 500,
            ...serializeView({ config }),
          },
        });
        views.push(backlogView);
      }
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
