import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/session";
import { checkRecordAccess } from "@/lib/workspace";
import { parseRecordRevision } from "@/lib/db";

/**
 * Historique des modifications d'un record (onglet « Historique » de la carte).
 * Renvoie les révisions du plus récent au plus ancien, chacune exposant l'acteur
 * (id + displayName), le champ, before, after et createdAt. Accès verrouillé par
 * checkRecordAccess (404 si pas d'accès, 401 sans session).
 */
export async function GET(
  _: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getSession();
  if (!user) return NextResponse.json({ error: "Non authentifié" }, { status: 401 });

  const { id } = await params;
  const access = await checkRecordAccess(id, user.id);
  if (!access) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const revisions = await prisma.recordRevision.findMany({
    where: { recordId: id },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      recordId: true,
      field: true,
      before: true,
      after: true,
      createdAt: true,
      actor: { select: { id: true, displayName: true } },
    },
  });

  return NextResponse.json(revisions.map(parseRecordRevision));
}
