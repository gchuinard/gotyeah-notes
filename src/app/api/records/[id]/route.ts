import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/session";
import { checkRecordAccess } from "@/lib/workspace";
import {
  serializeRecord,
  parseRecord,
  mergeRecordProperties,
  type RecordProperties,
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

  const { title, icon, content, properties: rawProperties, position } = result.data;

  let mergedProperties: RecordProperties | undefined;
  if (rawProperties !== undefined) {
    const existing = parseRecord(access.record).properties;
    mergedProperties = mergeRecordProperties(existing, rawProperties as RecordProperties);
  }

  const updated = await prisma.record.update({
    where: { id },
    data: serializeRecord({
      ...(title !== undefined && { title }),
      ...(icon !== undefined && { icon }),
      ...(content !== undefined && { content }),
      ...(position !== undefined && { position }),
      ...(mergedProperties !== undefined && { properties: mergedProperties }),
    }),
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
