import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/session";
import { checkViewAccess } from "@/lib/workspace";
import { serializeView, parseView, type ViewConfig } from "@/lib/db";

const patchViewSchema = z.object({
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

  const result = patchViewSchema.safeParse(body);
  if (!result.success) {
    return NextResponse.json(
      { error: "Validation failed", details: result.error.flatten() },
      { status: 400 }
    );
  }

  const access = await checkViewAccess(id, user.id);
  if (!access) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const { name, config, position } = result.data;

  const updated = await prisma.view.update({
    where: { id },
    data: serializeView({
      ...(name !== undefined && { name }),
      ...(config !== undefined && { config: config as ViewConfig }),
      ...(position !== undefined && { position }),
    }),
  });

  return NextResponse.json(parseView(updated));
}

export async function DELETE(
  _: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getSession();
  if (!user) return NextResponse.json({ error: "Non authentifié" }, { status: 401 });

  const { id } = await params;
  const access = await checkViewAccess(id, user.id);
  if (!access) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const viewCount = await prisma.view.count({
    where: { databaseId: access.databaseId },
  });
  if (viewCount === 1) {
    return NextResponse.json(
      { error: "Cannot delete the last view of a database" },
      { status: 400 }
    );
  }

  await prisma.view.delete({ where: { id } });

  return NextResponse.json({ ok: true });
}
