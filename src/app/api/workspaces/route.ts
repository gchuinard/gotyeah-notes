import { NextResponse } from "next/server";
import { z } from "zod";
import { getSession } from "@/lib/session";
import { createWorkspaceWithDefaults } from "@/lib/workspace";
import { prisma } from "@/lib/prisma";

const createWorkspaceSchema = z.object({
  name: z.string().min(1).max(100).default("Mon espace"),
});

export async function GET() {
  const user = await getSession();
  if (!user) return NextResponse.json({ error: "Non authentifié" }, { status: 401 });

  const memberships = await prisma.membership.findMany({
    where: { userId: user.id },
    orderBy: { createdAt: "asc" },
    select: { role: true, workspace: { select: { id: true, name: true } } },
  });
  // Champ additif : les consommateurs historiques ({ id, name }) l'ignorent.
  return NextResponse.json(memberships.map((m) => ({ ...m.workspace, role: m.role })));
}

export async function POST(req: Request) {
  const user = await getSession();
  if (!user) return NextResponse.json({ error: "Non authentifié" }, { status: 401 });

  const parsed = createWorkspaceSchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Validation failed", details: parsed.error.flatten() },
      { status: 400 }
    );
  }
  // Seul appelant à rattacher les comptes de service : c'est le geste explicite
  // « créer un espace ». Les trois autres appels fabriquent un « Mon espace »
  // personnel — cf. le commentaire de l'option dans lib/workspace.ts.
  const workspace = await createWorkspaceWithDefaults(parsed.data.name, user.id, {
    withServiceAccounts: true,
  });
  return NextResponse.json(workspace);
}
