import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/session";
import { checkDatabaseAccess, hasRole } from "@/lib/workspace";
import { nextPosition } from "@/lib/positions";
import { serializeView, parseView, type ViewConfig } from "@/lib/db";

const VIEW_TYPES = ["table", "kanban", "calendar", "gallery", "backlog"] as const;

const createViewSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  type: z.enum(VIEW_TYPES),
  config: z.record(z.string(), z.unknown()).optional(),
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
  if (!hasRole(access.membership, "editor")) {
    return NextResponse.json({ error: "Rôle insuffisant" }, { status: 403 });
  }

  const body = await req.json().catch(() => null);
  const result = createViewSchema.safeParse(body);
  if (!result.success) {
    return NextResponse.json(
      { error: "Validation failed", details: result.error.flatten() },
      { status: 400 }
    );
  }

  const { name, type, config = {} } = result.data;

  // MAX(position) + create atomiques : évite deux positions identiques sous concurrence.
  const view = await prisma.$transaction(async (tx) => {
    const position = await nextPosition("view", { databaseId }, tx);
    return tx.view.create({
      data: {
        databaseId,
        type,
        position,
        ...(name !== undefined && { name }),
        ...serializeView({ config: config as ViewConfig }),
      },
    });
  });

  return NextResponse.json(parseView(view), { status: 201 });
}
