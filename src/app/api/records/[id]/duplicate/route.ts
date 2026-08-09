import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/session";
import { checkRecordAccess, hasRole } from "@/lib/workspace";
import { nextPosition } from "@/lib/positions";
import { checkCreationTransitions } from "@/lib/transitionGuard";
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

  // Dupliquer une carte assise dans une colonne verrouillée PRODUIT une seconde
  // carte dans cette colonne : le résultat observable est identique à une
  // création directe, et le bouton est exposé dans les 5 vues. Gater la création
  // sans gater la duplication laisserait un contournement à un clic.
  const transitionCheck = await checkCreationTransitions(
    databaseId,
    parseRecord(src).properties,
    { userId: user.id, role: access.membership.role }
  );
  if (transitionCheck) return transitionCheck;

  const record = await prisma.$transaction(async (tx) => {
    const position = await nextPosition("record", { databaseId }, tx);
    const copie = await tx.record.create({
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

    // ⚠️ Les pièces jointes suivent, en PARTAGEANT le fichier : on recopie les
    // lignes, jamais les octets. C'est gratuit et sûr, parce que le `Set` de
    // purgeOrphanUploads EST le comptage de références du projet — un fichier
    // cité par deux lignes survit, cité par zéro il part. Copier les octets
    // coûterait ×N sur le NVMe du Pi pour résoudre un problème déjà résolu.
    //
    // ⚠️ `uploadedBy` est celui de l'ORIGINAL, pas le duplicateur : la ligne
    // dit qui a déposé le document, et ça reste vrai après une copie.
    const jointes = await tx.recordAttachment.findMany({
      where: { recordId: id },
      select: { fileName: true, name: true, mimeType: true, size: true, uploadedBy: true },
    });
    if (jointes.length > 0) {
      await tx.recordAttachment.createMany({
        data: jointes.map((a) => ({ ...a, recordId: copie.id })),
      });
    }
    return copie;
  });

  return NextResponse.json(parseRecord(record), { status: 201 });
}
