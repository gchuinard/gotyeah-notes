import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/session";
import { checkRecordAccess, hasRole } from "@/lib/workspace";
import { nextPosition } from "@/lib/positions";
import { parseRecord } from "@/lib/db";

// Duplication d'un record côté SERVEUR (copie atomique). Remplace la logique
// client fragile (GET + POST qui réimplémentait sectionsBody). Copie title +
// « (copie) », icon/coverUrl, et à l'identique properties/content/sectionsBody/
// templateId/sprintId ; nouvelle position en fin ; createdBy = utilisateur courant.
export async function POST(
  _: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getSession();
  if (!user) return NextResponse.json({ error: "Non authentifié" }, { status: 401 });

  const { id } = await params;
  const access = await checkRecordAccess(id, user.id);
  if (!access) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (!hasRole(access.membership, "editor")) {
    return NextResponse.json({ error: "Rôle insuffisant" }, { status: 403 });
  }

  const src = access.record;
  const { databaseId } = access;

  const record = await prisma.$transaction(async (tx) => {
    const position = await nextPosition("record", { databaseId }, tx);
    return tx.record.create({
      data: {
        databaseId,
        createdBy: user.id,
        position,
        title: `${src.title ?? ""} (copie)`.trim(),
        icon: src.icon,
        coverUrl: src.coverUrl,
        content: src.content,
        properties: src.properties,
        sectionsBody: src.sectionsBody,
        templateId: src.templateId,
        sprintId: src.sprintId,
      },
    });
  });

  return NextResponse.json(parseRecord(record), { status: 201 });
}
