import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/session";
import { checkDatabaseAccess } from "@/lib/workspace";
import { nextPosition } from "@/lib/positions";
import { serializeRecord, parseRecord, parseManyRecords, type RecordProperties } from "@/lib/db";

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

  const { title, icon, properties: rawProperties = {} } = result.data;
  const properties = rawProperties as RecordProperties;

  const position = await nextPosition("record", { databaseId });

  const record = await prisma.record.create({
    data: {
      databaseId,
      createdBy: user.id,
      position,
      ...(title !== undefined && { title }),
      ...(icon !== undefined && { icon }),
      ...serializeRecord({ properties }),
    },
  });

  return NextResponse.json(parseRecord(record), { status: 201 });
}
