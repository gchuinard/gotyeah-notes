import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/session";
import { checkPropertyAccess, hasRole } from "@/lib/workspace";
import {
  serializeDatabaseProperty,
  parseDatabaseProperty,
  parseManyRecords,
  parseManyViews,
  removePropertyKey,
  type PropertyConfig,
  type ParsedDatabaseProperty,
  type SelectOption,
} from "@/lib/db";
import {
  validatePropertyConfig,
  removedOptionIds,
  findReferencedOptionIds,
} from "@/lib/propertyConfig";

const patchPropertySchema = z.object({
  name: z.string().min(1).max(100).optional(),
  config: z.record(z.string(), z.unknown()).optional(),
  position: z.number().optional(),
});

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getSession();
  if (!user) return NextResponse.json({ error: "Non authentifié" }, { status: 401 });

  const { id } = await params;

  const body = await req.json().catch(() => null);

  if (body && typeof body === "object" && "type" in body) {
    return NextResponse.json({ error: "type cannot be changed" }, { status: 400 });
  }

  const result = patchPropertySchema.safeParse(body);
  if (!result.success) {
    return NextResponse.json(
      { error: "Validation failed", details: result.error.flatten() },
      { status: 400 }
    );
  }

  const access = await checkPropertyAccess(id, user.id);
  if (!access) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (!hasRole(access.membership, "editor")) {
    return NextResponse.json({ error: "Rôle insuffisant" }, { status: 403 });
  }

  const { name, config: rawConfig, position } = result.data;

  if (rawConfig !== undefined) {
    const existingRow = await prisma.databaseProperty.findUnique({ where: { id } });
    if (!existingRow) return NextResponse.json({ error: "Not found" }, { status: 404 });

    const cfgType = (rawConfig as { type?: unknown }).type;
    if (cfgType !== existingRow.type) {
      return NextResponse.json(
        { error: "config.type must match type" },
        { status: 400 }
      );
    }

    const validation = validatePropertyConfig(rawConfig);
    if (!validation.ok) {
      return NextResponse.json(
        { error: "Validation failed", details: validation.details },
        { status: 400 }
      );
    }

    // v1 : add / rename / recolor seulement. Retirer une option ENCORE référencée
    // (record ou View.config.doneStatusOptionId) orphelinerait la donnée → 400.
    if (existingRow.type === "select" || existingRow.type === "multiselect") {
      const prevConfig = parseDatabaseProperty(existingRow).config as {
        options?: SelectOption[];
      };
      const nextOptions = (rawConfig as { options: SelectOption[] }).options;
      const removed = removedOptionIds(prevConfig.options ?? [], nextOptions);

      if (removed.length > 0) {
        const [recordRows, viewRows] = await Promise.all([
          prisma.record.findMany({ where: { databaseId: access.databaseId } }),
          prisma.view.findMany({ where: { databaseId: access.databaseId } }),
        ]);
        const referenced = findReferencedOptionIds(
          id,
          removed,
          parseManyRecords(recordRows),
          parseManyViews(viewRows)
        );
        if (referenced.length > 0) {
          return NextResponse.json(
            {
              error: "Option référencée : impossible de la supprimer",
              details: { optionIds: referenced },
            },
            { status: 400 }
          );
        }
      }
    }
  }

  const updateData: Partial<ParsedDatabaseProperty> = {};
  if (name !== undefined) updateData.name = name;
  if (rawConfig !== undefined) updateData.config = rawConfig as PropertyConfig;
  if (position !== undefined) updateData.position = position;

  const updated = await prisma.databaseProperty.update({
    where: { id },
    data: serializeDatabaseProperty(updateData),
  });

  return NextResponse.json(parseDatabaseProperty(updated));
}

export async function DELETE(
  _: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getSession();
  if (!user) return NextResponse.json({ error: "Non authentifié" }, { status: 401 });

  const { id } = await params;

  const access = await checkPropertyAccess(id, user.id);
  if (!access) return NextResponse.json({ error: "Not found" }, { status: 404 });
  // Suppression DÉFINITIVE + purge de la clé dans tous les records : admin.
  if (!hasRole(access.membership, "admin")) {
    return NextResponse.json({ error: "Rôle insuffisant" }, { status: 403 });
  }

  const property = await prisma.databaseProperty.findUnique({
    where: { id },
    select: { type: true },
  });
  if (property?.type === "title") {
    return NextResponse.json({ error: "Cannot delete the title property" }, { status: 400 });
  }

  await prisma.$transaction(async (tx) => {
    const records = await tx.record.findMany({
      where: { databaseId: access.databaseId },
    });

    const updates = removePropertyKey(records, id);

    await Promise.all(
      updates.map((u) =>
        tx.record.update({
          where: { id: u.id },
          data: { properties: u.properties },
        })
      )
    );

    await tx.databaseProperty.delete({ where: { id } });
  });

  return NextResponse.json({ ok: true });
}
