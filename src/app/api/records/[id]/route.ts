import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/session";
import { checkRecordAccess, hasRole } from "@/lib/workspace";
import { validateRelationValues } from "@/lib/relations";
import { validateUserValues } from "@/lib/assignees";
import {
  serializeRecord,
  parseRecord,
  parseSectionsBody,
  mergeRecordProperties,
  serializeSectionsBody,
  diffRecordRevisions,
  shouldCoalesceRevision,
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
  // Gate AVANT le diff des révisions et la transaction : un refus n'écrit rien.
  if (!hasRole(access.membership, "editor")) {
    return NextResponse.json({ error: "Rôle insuffisant" }, { status: 403 });
  }

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
    // Sur le patch BRUT, jamais sur le merge : un assigné devenu ex-membre ne
    // doit pas bloquer les écritures suivantes sur les autres champs.
    const assigneeCheck = await validateUserValues(
      access.workspaceId,
      access.databaseId,
      rawProperties as RecordProperties
    );
    if (!assigneeCheck.ok) {
      return NextResponse.json({ error: assigneeCheck.error }, { status: 400 });
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

  // Piste d'audit : une révision par CHAMP réellement changé (title/content/
  // property/section). Diff calculé AVANT l'update, à partir de l'état existant.
  const changes = diffRecordRevisions(
    {
      title: access.record.title,
      content: access.record.content,
      properties: parseRecord(access.record).properties,
      sectionsBody: parseSectionsBody(access.record.sectionsBody),
    },
    {
      ...(title !== undefined && { title }),
      ...(content !== undefined && { content }),
      ...(rawProperties !== undefined && { properties: rawProperties as RecordProperties }),
      ...(sectionsBody !== undefined && { sectionsBody: sectionsBody as RecordSection[] | null }),
    }
  );
  const now = new Date();

  const updated = await prisma.$transaction(async (tx) => {
    const row = await tx.record.update({
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

    for (const change of changes) {
      // Coalescence : fusion dans la dernière révision du champ si même acteur < 2 min,
      // sinon nouvelle ligne. On conserve le `before` d'origine, on rafraîchit after+date.
      const last = await tx.recordRevision.findFirst({
        where: { recordId: id, field: change.field },
        orderBy: { createdAt: "desc" },
        select: { id: true, actorId: true, createdAt: true },
      });
      if (shouldCoalesceRevision(last, user.id, now)) {
        await tx.recordRevision.update({
          where: { id: last!.id },
          data: { after: JSON.stringify(change.after ?? null), createdAt: now },
        });
      } else {
        await tx.recordRevision.create({
          data: {
            recordId: id,
            actorId: user.id,
            field: change.field,
            before: JSON.stringify(change.before ?? null),
            after: JSON.stringify(change.after ?? null),
            createdAt: now,
          },
        });
      }
    }

    return row;
  });

  return NextResponse.json(parseRecord(updated));
}

export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getSession();
  if (!user) return NextResponse.json({ error: "Non authentifié" }, { status: 401 });

  const { id } = await params;
  // ?permanent=1 : suppression DÉFINITIVE (depuis la corbeille) — accède aux records trashés.
  const permanent = new URL(req.url).searchParams.get("permanent") === "1";

  const access = await checkRecordAccess(id, user.id, permanent);
  if (!access) return NextResponse.json({ error: "Not found" }, { status: 404 });
  // Double gate : corbeille (réversible) = editor, ?permanent=1 (définitif) = admin.
  if (!hasRole(access.membership, permanent ? "admin" : "editor")) {
    return NextResponse.json({ error: "Rôle insuffisant" }, { status: 403 });
  }

  if (permanent) {
    await prisma.record.delete({ where: { id } });
  } else {
    // Soft delete : mise en corbeille (restaurable, purge auto après 30 j).
    await prisma.record.update({ where: { id }, data: { trashedAt: new Date() } });
  }

  return NextResponse.json({ ok: true });
}
