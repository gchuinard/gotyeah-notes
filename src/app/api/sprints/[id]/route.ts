import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/session";
import { checkSprintAccess } from "@/lib/workspace";

// Renommage, objectif, dates, position et transitions d'état (state) :
// "future" → "active" = démarrer le sprint, "active" → "completed" = terminer.
// Terminer ne déplace pas les issues (archivage simple) : elles gardent leur
// sprintId et le sprint sort du board actif côté UI.
const patchSprintSchema = z.object({
  name: z.string().min(1).max(120).optional(),
  goal: z.string().max(2000).nullable().optional(),
  startDate: z.string().nullable().optional(),
  endDate: z.string().nullable().optional(),
  state: z.enum(["future", "active", "completed"]).optional(),
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
  const result = patchSprintSchema.safeParse(body);
  if (!result.success) {
    return NextResponse.json(
      { error: "Validation failed", details: result.error.flatten() },
      { status: 400 }
    );
  }

  const access = await checkSprintAccess(id, user.id);
  if (!access) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const { name, goal, startDate, endDate, state, position } = result.data;

  const sprint = await prisma.sprint.update({
    where: { id },
    data: {
      ...(name !== undefined && { name }),
      ...(goal !== undefined && { goal }),
      ...(state !== undefined && { state }),
      ...(position !== undefined && { position }),
      ...(startDate !== undefined && { startDate: startDate ? new Date(startDate) : null }),
      ...(endDate !== undefined && { endDate: endDate ? new Date(endDate) : null }),
    },
  });

  return NextResponse.json(sprint);
}

export async function DELETE(
  _: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getSession();
  if (!user) return NextResponse.json({ error: "Non authentifié" }, { status: 401 });

  const { id } = await params;
  const access = await checkSprintAccess(id, user.id);
  if (!access) return NextResponse.json({ error: "Not found" }, { status: 404 });

  // Record.sprintId est en onDelete: SetNull → les issues retombent au backlog.
  await prisma.sprint.delete({ where: { id } });

  return NextResponse.json({ ok: true });
}
