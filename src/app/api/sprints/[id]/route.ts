import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/session";
import { checkSprintAccess } from "@/lib/workspace";
import {
  parseManyRecords,
  reconcileDelivered,
  buildReleaseNotesBlocks,
} from "@/lib/db";
import { appendReleaseNotesToPage } from "@/lib/pages";

// Renommage, objectif, dates, position et transitions d'état (state) :
// "future" → "active" = démarrer le sprint, "active" → "completed" = terminer.
// - Single active : refus 409 si un autre sprint de la database est déjà actif.
// - Clôture : si moveIncompleteToBacklog (+ statusPropertyId + doneStatusOptionId),
//   les issues non terminées (status != doneOption) retournent au backlog
//   (sprintId = null) dans la même transaction que le passage à "completed".
// - Clôture : les notes de version (Sprint.releaseNotes) sont générées UNE FOIS, et
//   un bloc daté est auto-appendé À LA FIN de la page « Patch notes » mappée
//   (Database.patchNotesPageId), dans la MÊME transaction (Ticket 8). Garde-fous :
//   réconciliation d'exhaustivité (listées == livrées) sinon rollback+422 ;
//   idempotence via un marqueur sprintId sur le bloc ; page illisible → rollback+422 ;
//   pas de page mappée → clôture OK + flag `patchNotesAppend` explicite.
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
  // La clôture (renvoi backlog + génération notes + append page) est atomique dans la
  // même transaction : toute erreur (réconciliation, page illisible) annule le tout.
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

      if (state !== "completed") return updated;

      // ── Clôture ──────────────────────────────────────────────────────────
      // Renvoi des issues non terminées au backlog (si demandé + statut câblé).
      let reportedCount = 0;
      if (moveIncompleteToBacklog && statusPropertyId && doneStatusOptionId) {
        const recs = await tx.record.findMany({
          where: { databaseId: access.databaseId, sprintId: id, trashedAt: null },
        });
        const incompleteIds = parseManyRecords(recs)
          .filter((r) => r.properties[statusPropertyId] !== doneStatusOptionId)
          .map((r) => r.id);
        reportedCount = incompleteIds.length;
        if (incompleteIds.length > 0) {
          await tx.record.updateMany({
            where: { id: { in: incompleteIds } },
            data: { sprintId: null },
          });
        }
      }

      // Idempotence : notes déjà générées (re-clôture / retry) → aucune régénération
      // ni second append. Le contenu de la page reste strictement identique.
      if (updated.releaseNotes) {
        return { ...updated, patchNotesAppend: "already" as const };
      }

      // Issues LIVRÉES = celles encore dans le sprint après le renvoi des incomplètes.
      const deliveredRecs = parseManyRecords(
        await tx.record.findMany({
          where: { databaseId: access.databaseId, sprintId: id, trashedAt: null },
          orderBy: { position: "asc" },
        })
      );

      // Garde-fou : réconciliation d'exhaustivité (si le statut est câblé). Toute
      // issue listée doit être « terminée », sinon le bloc mentirait → rollback.
      if (statusPropertyId && doneStatusOptionId) {
        const rec = reconcileDelivered(deliveredRecs, statusPropertyId, doneStatusOptionId);
        if (!rec.ok) throw new ReconciliationError(rec.listed, rec.delivered);
      }

      const withNotes = await tx.sprint.update({
        where: { id },
        data: { releaseNotes: buildReleaseNotes(updated, deliveredRecs, reportedCount) },
      });

      // Append (idempotent) à la page « Patch notes » mappée, même transaction.
      const db = await tx.database.findUnique({
        where: { id: access.databaseId },
        select: { patchNotesPageId: true },
      });
      const blocks = buildReleaseNotesBlocks({
        sprintId: id,
        sprintName: updated.name,
        closedDate: (updated.endDate ?? new Date()).toISOString().slice(0, 10),
        deliveredTitles: deliveredRecs.map((r) => r.title),
        reportedCount,
      });
      const append = await appendReleaseNotesToPage(tx, {
        pageId: db?.patchNotesPageId ?? null,
        workspaceId: access.workspaceId,
        userId: user.id,
        sprintId: id,
        blocks,
      });
      if (append.status === "corrupt") throw new PatchNotesCorruptError();

      return { ...withNotes, patchNotesAppend: append.status };
    });
    return NextResponse.json(sprint);
  } catch (err) {
    if (err instanceof SprintAlreadyActiveError) {
      return NextResponse.json(
        { error: "Un sprint est déjà actif. Termine-le d'abord." },
        { status: 409 }
      );
    }
    if (err instanceof ReconciliationError) {
      return NextResponse.json(
        {
          error:
            `Incohérence : ${err.listed} issue(s) rattachée(s) au sprint mais ` +
            `${err.delivered} marquée(s) terminée(s). Corrige le statut des issues ` +
            `(ou renvoie-les au backlog) puis rejoue la clôture.`,
        },
        { status: 422 }
      );
    }
    if (err instanceof PatchNotesCorruptError) {
      return NextResponse.json(
        {
          error:
            "Le contenu de la page « Patch notes » est illisible (JSON invalide). " +
            "Clôture annulée pour ne pas l'écraser ; corrige la page puis rejoue.",
        },
        { status: 422 }
      );
    }
    throw err;
  }
}

/** Levée dans la transaction quand un autre sprint est déjà actif → 409. */
class SprintAlreadyActiveError extends Error {}

/** Levée quand les issues listées ≠ issues livrées (statut câblé) → rollback + 422. */
class ReconciliationError extends Error {
  constructor(readonly listed: number, readonly delivered: number) {
    super("reconciliation");
  }
}

/** Levée quand la page « Patch notes » a un content JSON illisible → rollback + 422. */
class PatchNotesCorruptError extends Error {}

/**
 * Notes de version auto (markdown, `Sprint.releaseNotes`) : nom du sprint, date de
 * clôture, objectif, issues livrées, et — distinct — le nombre d'issues reportées.
 */
function buildReleaseNotes(
  sprint: { name: string; goal: string | null; endDate: Date | null },
  records: { title: string }[],
  reportedCount: number
): string {
  const date = (sprint.endDate ?? new Date()).toISOString().slice(0, 10);
  const lines = [`# ${sprint.name}`, `Clôturé le ${date}.`];
  if (sprint.goal) lines.push("", sprint.goal);
  const n = records.length;
  lines.push("", `${n} issue${n > 1 ? "s" : ""} livrée${n > 1 ? "s" : ""} :`);
  for (const r of records) lines.push(`- ${r.title || "Sans titre"}`);
  if (reportedCount > 0) {
    lines.push(
      "",
      `${reportedCount} issue${reportedCount > 1 ? "s" : ""} reportée${reportedCount > 1 ? "s" : ""} au backlog.`
    );
  }
  return lines.join("\n");
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
