import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/session";
import { getMembership, hasRole } from "@/lib/workspace";
import {
  parseTemplateRow,
  resolveBuiltinTemplate,
  isBuiltinTemplateId,
} from "@/lib/templates";

/** Charge un template DB en vérifiant l'accès workspace de l'utilisateur. */
async function loadOwned(id: string, userId: string) {
  const row = await prisma.template.findUnique({ where: { id } });
  if (!row) return null;
  const membership = await getMembership(userId, row.workspaceId);
  if (!membership) return null;
  return { row, membership };
}

export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getSession();
  if (!user) return NextResponse.json({ error: "Non authentifié" }, { status: 401 });

  const { id } = await params;
  if (isBuiltinTemplateId(id)) {
    const builtin = resolveBuiltinTemplate(id);
    return builtin
      ? NextResponse.json(builtin)
      : NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const owned = await loadOwned(id, user.id);
  if (!owned) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json(parseTemplateRow(owned.row));
}

const sectionSchema = z.object({ id: z.string().optional(), label: z.string().min(1).max(100) });
const patchTemplateSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  icon: z.string().nullable().optional(),
  columns: z
    .array(
      z.object({
        name: z.string().min(1).max(100),
        type: z.string().min(1),
        config: z.record(z.string(), z.unknown()),
      })
    )
    .optional(),
  kanbanGroupProperty: z.string().nullable().optional(),
  sections: z.array(sectionSchema).optional(),
});

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getSession();
  if (!user) return NextResponse.json({ error: "Non authentifié" }, { status: 401 });

  const { id } = await params;
  if (isBuiltinTemplateId(id)) {
    return NextResponse.json({ error: "Les templates fournis ne sont pas modifiables" }, { status: 400 });
  }

  const body = await req.json().catch(() => null);
  const result = patchTemplateSchema.safeParse(body);
  if (!result.success) {
    return NextResponse.json(
      { error: "Validation failed", details: result.error.flatten() },
      { status: 400 }
    );
  }

  const owned = await loadOwned(id, user.id);
  if (!owned) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (!hasRole(owned.membership, "editor")) {
    return NextResponse.json({ error: "Rôle insuffisant" }, { status: 403 });
  }

  const { name, icon, columns, kanbanGroupProperty, sections } = result.data;
  const updated = await prisma.template.update({
    where: { id },
    data: {
      ...(name !== undefined && { name }),
      ...(icon !== undefined && { icon }),
      ...(columns !== undefined && { columns: JSON.stringify(columns) }),
      ...(kanbanGroupProperty !== undefined && { kanbanGroupProperty }),
      ...(sections !== undefined && {
        sections: JSON.stringify(
          sections.map((s) => ({ id: s.id || crypto.randomUUID().slice(0, 8), label: s.label }))
        ),
      }),
    },
  });

  return NextResponse.json(parseTemplateRow(updated));
}

export async function DELETE(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getSession();
  if (!user) return NextResponse.json({ error: "Non authentifié" }, { status: 401 });

  const { id } = await params;
  if (isBuiltinTemplateId(id)) {
    return NextResponse.json({ error: "Les templates fournis ne sont pas supprimables" }, { status: 400 });
  }

  const owned = await loadOwned(id, user.id);
  if (!owned) return NextResponse.json({ error: "Not found" }, { status: 404 });
  // Suppression DÉFINITIVE (Template sans corbeille) : admin.
  if (!hasRole(owned.membership, "admin")) {
    return NextResponse.json({ error: "Rôle insuffisant" }, { status: 403 });
  }

  await prisma.template.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
