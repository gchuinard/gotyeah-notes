import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/session";
import { checkRecordAccess } from "@/lib/workspace";
import { validateRelationValues } from "@/lib/relations";
import {
  serializeRecord,
  parseRecord,
  mergeRecordProperties,
  serializeSectionsBody,
  type RecordProperties,
  type RecordSection,
} from "@/lib/db";

export async function GET(
  _: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getSession();
  if (!user) return NextResponse.json({ error: "Non authentifié" }, { status: 401 });

  const { id } = await params;
  const access = await checkRecordAccess(id, user.id);
  if (!access) return NextResponse.json({ error: "Not found" }, { status: 404 });

  return NextResponse.json(parseRecord(access.record));
}

const patchRecordSchema = z.object({
  title: z.string().optional(),
  icon: z.string().optional(),
  content: z.string().optional(),
  properties: z.record(z.string(), z.unknown()).optional(),
  position: z.number().optional(),
  // Corps sectionné (templates) : remplacement TOTAL des sections fournies.
  // null = repasser en corps libre. templateId = template appliqué à ce record.
  sectionsBody: z
    .array(
      z.object({
        id: z.string(),
        label: z.string(),
        content: z.array(z.unknown()),
      })
    )
    .nullable()
    .optional(),
  templateId: z.string().nullable().optional(),
  // Affectation à un sprint (vue backlog). null = renvoyer au backlog.
  sprintId: z.string().nullable().optional(),
});

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getSession();
  if (!user) return NextResponse.json({ error: "Non authentifié" }, { status: 401 });

  const { id } = await params;

  const body = await req.json().catch(() => null);
  const result = patchRecordSchema.safeParse(body);
  if (!result.success) {
    return NextResponse.json(
      { error: "Validation failed", details: result.error.flatten() },
      { status: 400 }
    );
  }

  const access = await checkRecordAccess(id, user.id);
  if (!access) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const {
    title,
    icon,
    content,
    properties: rawProperties,
    position,
    sectionsBody,
    templateId,
    sprintId,
  } = result.data;

  let mergedProperties: RecordProperties | undefined;
  if (rawProperties !== undefined) {
    // Garde-fou : les ids d'une propriété relation doivent appartenir à sa database
    // cible. On valide le PATCH entrant (une valeur null = suppression, tolérée).
    const relationCheck = await validateRelationValues(
      access.databaseId,
      rawProperties as RecordProperties
    );
    if (!relationCheck.ok) {
      return NextResponse.json({ error: relationCheck.error }, { status: 400 });
    }
    const existing = parseRecord(access.record).properties;
    mergedProperties = mergeRecordProperties(existing, rawProperties as RecordProperties);
  }

  // Garde-fou : un sprint affecté doit appartenir à la même database (sinon FK 500
  // ou affectation incohérente entre bases).
  if (sprintId) {
    const sprint = await prisma.sprint.findFirst({
      where: { id: sprintId, databaseId: access.databaseId },
      select: { id: true },
    });
    if (!sprint) {
      return NextResponse.json({ error: "Sprint introuvable" }, { status: 400 });
    }
  }

  const updated = await prisma.record.update({
    where: { id },
    data: {
      ...serializeRecord({
        ...(title !== undefined && { title }),
        ...(icon !== undefined && { icon }),
        ...(content !== undefined && { content }),
        ...(position !== undefined && { position }),
        ...(mergedProperties !== undefined && { properties: mergedProperties }),
      }),
      ...(sectionsBody !== undefined && {
        sectionsBody:
          sectionsBody === null ? null : serializeSectionsBody(sectionsBody as RecordSection[]),
      }),
      ...(templateId !== undefined && { templateId }),
      ...(sprintId !== undefined && { sprintId }),
    },
  });

  return NextResponse.json(parseRecord(updated));
}

export async function DELETE(
  _: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getSession();
  if (!user) return NextResponse.json({ error: "Non authentifié" }, { status: 401 });

  const { id } = await params;
  const access = await checkRecordAccess(id, user.id);
  if (!access) return NextResponse.json({ error: "Not found" }, { status: 404 });

  await prisma.record.delete({ where: { id } });

  return NextResponse.json({ ok: true });
}
