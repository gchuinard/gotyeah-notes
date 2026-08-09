import { NextResponse } from "next/server";
import { z } from "zod";
import { getSession } from "@/lib/session";
import { checkRecordAccess, hasRole } from "@/lib/workspace";
import { prisma } from "@/lib/prisma";

/**
 * Fil de discussion d'une carte — APPEND-ONLY.
 *
 * ⚠️ Il n'y a ni PATCH ni DELETE, et ce n'est pas un manque : décision de
 * Gautier du 09/08. Un fil qu'on réécrit n'est plus une trace, et leur absence
 * supprime avec elle la question « qui a le droit de modifier », la modale de
 * confirmation et la mention « modifié ».
 *
 * ⚠️ AUCUNE notification n'est écrite ici. Le message porterait un extrait de
 * texte : le prévenir à quelqu'un qui ne peut pas ouvrir la carte lui
 * divulguerait ce contenu — c'est le piège que la garde de `record_assigned` a
 * mis deux jours à cerner. Décision de ne pas notifier prise le 09/08, ce qui
 * ferme le sujet plutôt que de le contourner.
 */

/** Au-delà, ce n'est plus une remarque : ça a sa place dans le corps de la carte. */
const MAX_BODY = 4000;

const createSchema = z.object({
  body: z.string().trim().min(1).max(MAX_BODY),
});

/** Le plus récent d'abord — un fil se lit par le haut. */
const TAKE = 200;

export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getSession();
  if (!user) return NextResponse.json({ error: "Non authentifié" }, { status: 401 });

  const { id } = await params;
  const access = await checkRecordAccess(id, user.id);
  if (!access) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const rows = await prisma.recordComment.findMany({
    where: { recordId: id },
    orderBy: { createdAt: "desc" },
    take: TAKE,
    select: {
      id: true,
      body: true,
      createdAt: true,
      // ⚠️ displayName SEULEMENT, jamais l'email : règle du projet pour toute
      // surface de consultation.
      author: { select: { displayName: true } },
    },
  });

  return NextResponse.json(
    rows.map((r) => ({
      id: r.id,
      body: r.body,
      createdAt: r.createdAt,
      // L'auteur supprimé (SetNull) devient anonyme sans casser la phrase —
      // même dégradation que les notifications.
      author: r.author?.displayName ?? null,
    }))
  );
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getSession();
  if (!user) return NextResponse.json({ error: "Non authentifié" }, { status: 401 });

  const { id } = await params;
  const access = await checkRecordAccess(id, user.id);
  if (!access) return NextResponse.json({ error: "Not found" }, { status: 404 });
  // ⚠️ ÉDITEUR, pas lecteur. Décision de Gautier du 09/08 : « lecteur = lecture
  // seule TOTALE » n'est pas assoupli pour les commentaires. Un lecteur lit le
  // fil, il n'y écrit pas.
  if (!hasRole(access.membership, "editor")) {
    return NextResponse.json({ error: "Rôle insuffisant" }, { status: 403 });
  }

  const parsed = createSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Validation failed", details: parsed.error.flatten() },
      { status: 400 }
    );
  }

  const row = await prisma.recordComment.create({
    data: { recordId: id, body: parsed.data.body, authorId: user.id },
    select: { id: true, body: true, createdAt: true },
  });

  return NextResponse.json({ ...row, author: user.displayName }, { status: 201 });
}
