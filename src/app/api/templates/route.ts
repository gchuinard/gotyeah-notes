import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/session";
import { getMembership } from "@/lib/workspace";
import { BUILTIN_TEMPLATES, parseTemplateRow } from "@/lib/templates";

export async function GET(req: Request) {
  const user = await getSession();
  if (!user) return NextResponse.json({ error: "Non authentifié" }, { status: 401 });

  const workspaceId = new URL(req.url).searchParams.get("workspaceId");
  if (!workspaceId) return NextResponse.json(BUILTIN_TEMPLATES);

  const membership = await getMembership(user.id, workspaceId);
  if (!membership) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const rows = await prisma.template.findMany({
    where: { workspaceId },
    orderBy: { createdAt: "asc" },
  });

  return NextResponse.json([...BUILTIN_TEMPLATES, ...rows.map(parseTemplateRow)]);
}

const sectionSchema = z.object({ id: z.string().optional(), label: z.string().min(1).max(100) });
const columnSchema = z.object({
  name: z.string().min(1).max(100),
  type: z.string().min(1),
  config: z.record(z.string(), z.unknown()),
});

const createTemplateSchema = z.object({
  workspaceId: z.string().min(1),
  name: z.string().min(1).max(100),
  icon: z.string().nullable().optional(),
  columns: z.array(columnSchema).default([]),
  kanbanGroupProperty: z.string().nullable().optional(),
  sections: z.array(sectionSchema).default([]),
});

const withSectionIds = (sections: Array<{ id?: string; label: string }>) =>
  sections.map((s) => ({ id: s.id || crypto.randomUUID().slice(0, 8), label: s.label }));

export async function POST(req: Request) {
  const user = await getSession();
  if (!user) return NextResponse.json({ error: "Non authentifié" }, { status: 401 });

  const body = await req.json().catch(() => null);
  const result = createTemplateSchema.safeParse(body);
  if (!result.success) {
    return NextResponse.json(
      { error: "Validation failed", details: result.error.flatten() },
      { status: 400 }
    );
  }

  const { workspaceId, name, icon, columns, kanbanGroupProperty, sections } = result.data;

  const membership = await getMembership(user.id, workspaceId);
  if (!membership) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const template = await prisma.template.create({
    data: {
      workspaceId,
      name,
      icon: icon ?? null,
      columns: JSON.stringify(columns),
      kanbanGroupProperty: kanbanGroupProperty ?? null,
      sections: JSON.stringify(withSectionIds(sections)),
    },
  });

  return NextResponse.json(parseTemplateRow(template), { status: 201 });
}
