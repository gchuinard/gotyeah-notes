import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/session";
import { checkDatabaseAccess } from "@/lib/workspace";
import { nextPosition } from "@/lib/positions";
import {
  serializeRecord,
  parseRecord,
  parseManyRecords,
  serializeSectionsBody,
  type RecordProperties,
} from "@/lib/db";
import { emptySectionsBody } from "@/lib/templates";

export async function GET(
  _: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getSession();
  if (!user) return NextResponse.json({ error: "Non authentifié" }, { status: 401 });

  const { id: databaseId } = await params;
  const access = await checkDatabaseAccess(databaseId, user.id);
  if (!access) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const records = await prisma.record.findMany({
    where: { databaseId },
    orderBy: { position: "asc" },
  });

  return NextResponse.json(parseManyRecords(records));
}

const createRecordSchema = z.object({
  title: z.string().optional(),
  icon: z.string().optional(),
  content: z.string().optional(),
  // Property keys are not validated against existing DatabaseProperties.
  // Coherence between properties and the database schema is intentionally
  // left to the client — the server only stores what it receives.
  properties: z.record(z.string(), z.unknown()).optional(),
});

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getSession();
  if (!user) return NextResponse.json({ error: "Non authentifié" }, { status: 401 });

  const { id: databaseId } = await params;
  const access = await checkDatabaseAccess(databaseId, user.id);
  if (!access) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const body = await req.json().catch(() => null);
  const result = createRecordSchema.safeParse(body);
  if (!result.success) {
    return NextResponse.json(
      { error: "Validation failed", details: result.error.flatten() },
      { status: 400 }
    );
  }

  const { title, icon, content, properties: rawProperties = {} } = result.data;
  const properties = rawProperties as RecordProperties;

  // Corps du record. Si la database est templatée (recordSections), on estampe un
  // corps SECTIONNÉ vide + le templateId. Sinon, si un modèle de corps LIBRE existe
  // et qu'aucun `content` n'est fourni, on l'applique. Point unique → web + MCP.
  const dbRow = await prisma.database.findUnique({
    where: { id: databaseId },
    select: { recordTemplate: true, recordSections: true, templateId: true },
  });

  let initialContent = content;
  let sectionsBody: string | undefined;
  let recordTemplateId: string | undefined;
  if (content === undefined && dbRow?.recordSections) {
    const secs = JSON.parse(dbRow.recordSections) as { id: string; label: string }[];
    sectionsBody = serializeSectionsBody(emptySectionsBody(secs));
    recordTemplateId = dbRow.templateId ?? undefined;
  } else if (initialContent === undefined && dbRow?.recordTemplate) {
    initialContent = dbRow.recordTemplate;
  }

  const position = await nextPosition("record", { databaseId });

  const record = await prisma.record.create({
    data: {
      databaseId,
      createdBy: user.id,
      position,
      ...(title !== undefined && { title }),
      ...(icon !== undefined && { icon }),
      ...(initialContent !== undefined && { content: initialContent }),
      ...(sectionsBody !== undefined && { sectionsBody }),
      ...(recordTemplateId !== undefined && { templateId: recordTemplateId }),
      ...serializeRecord({ properties }),
    },
  });

  return NextResponse.json(parseRecord(record), { status: 201 });
}
