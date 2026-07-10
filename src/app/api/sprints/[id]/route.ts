import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/session";
import { checkSprintAccess } from "@/lib/workspace";
import { parseManyRecords } from "@/lib/db";

// Renommage, objectif, dates, position et transitions d'état (state) :
// "future" → "active" = démarrer le sprint, "active" → "completed" = terminer.
// - Single active : refus 409 si un autre sprint de la database est déjà actif.
// - Clôture : si moveIncompleteToBacklog (+ statusPropertyId + doneStatusOptionId),
//   les issues non terminées (status != doneOption) retournent au backlog
//   (sprintId = null) dans la même transaction que le passage à "completed".
const patchSprintSchema = z.object({
  name: z.string().min(1).max(120).optional(),
  goal: z.string().max(2000).nullable().optional(),
  startDate: z.string().nullable().optional(),
  endDate: z.string().nullable().optional(),
  state: z.enum(["future", "active", "completed"]).optional(),
  position: z.number().optional(),
  // Clôture : renvoyer les issues non terminées au backlog (le client passe les ids
  // de propriété/option statut, qui vivent dans le View.config du backlog/board).
  moveIncompleteToBacklog: z.boolean().optional(),
  statusPropertyId: z.string().optional(),
  doneStatusOptionId: z.string().optional(),
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

  const {
    name, goal, startDate, endDate, state, position,
    moveIncompleteToBacklog, statusPropertyId, doneStatusOptionId,
  } = result.data;

  const data = {
    ...(name !== undefined && { name }),
    ...(goal !== undefined && { goal }),
    ...(state !== undefined && { state }),
    ...(position !== undefined && { position }),
    ...(startDate !== undefined && { startDate: startDate ? new Date(startDate) : null }),
    ...(endDate !== undefined && { endDate: endDate ? new Date(endDate) : null }),
  };

  // Le garde-fou « un seul sprint actif » ET l'update vivent dans la MÊME transaction :
  // sinon deux PATCH state=active concurrents (UI + MCP) passent tous les deux le
  // findFirst avant que l'un n'écrive → deux sprints actifs. La transaction sérialise
  // le check+write. Le conflit remonte via une exception typée (→ 409 hors transaction).
  try {
    const sprint = await prisma.$transaction(async (tx) => {
      if (state === "active") {
        const other = await tx.sprint.findFirst({
          where: { databaseId: access.databaseId, state: "active", id: { not: id } },
          select: { id: true },
        });
        if (other) throw new SprintAlreadyActiveError();
      }

      const updated = await tx.sprint.update({ where: { id }, data });

      // Clôture avec renvoi des incomplètes au backlog, dans la même transaction.
      if (
        state === "completed" && moveIncompleteToBacklog &&
        statusPropertyId && doneStatusOptionId
      ) {
        const recs = await tx.record.findMany({
          where: { databaseId: access.databaseId, sprintId: id, trashedAt: null },
        });
        const incompleteIds = parseManyRecords(recs)
          .filter((r) => r.properties[statusPropertyId] !== doneStatusOptionId)
          .map((r) => r.id);
        if (incompleteIds.length > 0) {
          await tx.record.updateMany({
            where: { id: { in: incompleteIds } },
            data: { sprintId: null },
          });
        }
      }

      return updated;
    });
    return NextResponse.json(sprint);
  } catch (err) {
    if (err instanceof SprintAlreadyActiveError) {
      return NextResponse.json(
        { error: "Un sprint est déjà actif. Termine-le d'abord." },
        { status: 409 }
      );
    }
    throw err;
  }
}

/** Levée dans la transaction quand un autre sprint est déjà actif → 409. */
class SprintAlreadyActiveError extends Error {}

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
