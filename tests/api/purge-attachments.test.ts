import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { promises as fs } from "node:fs";
import path from "node:path";
import { prisma } from "@/lib/prisma";
import { purgeOrphanUploads, uploadsDir, UPLOAD_PURGE_DAYS } from "@/lib/uploads";
import { seedUserWithWorkspace } from "../helpers/seed";

/**
 * La purge des orphelins face aux PIÈCES JOINTES.
 *
 * ⚠️ Écrit AVANT les routes, à dessein. C'est l'étape du lot qui peut détruire
 * des données : `purgeOrphanUploads` ne connaît que ce qu'on lui donne, et un
 * fichier référencé ailleurs est `unlink` — 30 jours après son dépôt, donc
 * JAMAIS pendant une recette. La bombe a une mèche d'un mois.
 */

let recordId: string;
let dir: string;

/** Un fichier sur disque, vieilli pour être candidat à la purge. */
async function fichierAncien(nom: string) {
  const p = path.join(dir, nom);
  await fs.writeFile(p, "contenu");
  const vieux = new Date(Date.now() - (UPLOAD_PURGE_DAYS + 1) * 86_400_000);
  await fs.utimes(p, vieux, vieux);
  return p;
}

const existe = (nom: string) =>
  fs.access(path.join(dir, nom)).then(() => true).catch(() => false);

beforeAll(async () => {
  const seeded = await seedUserWithWorkspace(`purge-att-${Date.now()}@x.tld`);
  const section = await prisma.section.create({
    data: { name: "S", type: "team", position: 0, workspaceId: seeded.workspace.id },
  });
  const page = await prisma.page.create({
    data: {
      title: "Hôte",
      workspaceId: seeded.workspace.id,
      ownerId: seeded.user.id,
      visibility: "team",
      sectionId: section.id,
    },
  });
  const db = await prisma.database.create({ data: { pageId: page.id } });
  recordId = (await prisma.record.create({ data: { databaseId: db.id, title: "Carte" } })).id;

  dir = uploadsDir();
  await fs.mkdir(dir, { recursive: true });
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe("⚠️ purgeOrphanUploads connaît les pièces jointes", () => {
  it("un fichier RÉFÉRENCÉ par une pièce jointe SURVIT, même vieux", async () => {
    // LE cas qui aurait détruit des données. Sans l'ajout de fileName au Set,
    // ce fichier serait supprimé 30 jours après son dépôt.
    const nom = `garde-${Date.now()}.pdf`;
    await fichierAncien(nom);
    await prisma.recordAttachment.create({
      data: { recordId, fileName: nom, name: "contrat.pdf", mimeType: "application/pdf", size: 7 },
    });

    await purgeOrphanUploads();
    expect(await existe(nom)).toBe(true);
  });

  it("⚠️ le nom est lu DIRECTEMENT, pas via la regex des URL", async () => {
    // Le champ contient `uuid.pdf`, pas `/api/files/uuid.pdf` : passer par
    // extractUploadRefs rendrait un ensemble VIDE. Ce test le prouve — un
    // fichier référencé UNIQUEMENT par une pièce jointe survit, alors que la
    // regex n'aurait rien trouvé dans ce nom nu.
    const nom = `nu-${Date.now()}.docx`;
    await fichierAncien(nom);
    await prisma.recordAttachment.create({
      data: {
        recordId,
        fileName: nom,
        name: "devis.docx",
        mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        size: 7,
      },
    });

    await purgeOrphanUploads();
    expect(await existe(nom)).toBe(true);
  });

  it("un fichier SANS aucune référence est bien supprimé — la purge fait toujours son travail", async () => {
    const nom = `orphelin-${Date.now()}.pdf`;
    await fichierAncien(nom);

    await purgeOrphanUploads();
    expect(await existe(nom)).toBe(false);
  });

  it("le fichier est libéré quand la DERNIÈRE pièce jointe qui le cite disparaît", async () => {
    // C'est ce qui rend la duplication d'une carte gratuite : deux lignes
    // peuvent citer le même octet, la dernière retirée le libère.
    const nom = `partage-${Date.now()}.pdf`;
    await fichierAncien(nom);
    const a = await prisma.recordAttachment.create({
      data: { recordId, fileName: nom, name: "a.pdf", mimeType: "application/pdf", size: 7 },
    });
    const b = await prisma.recordAttachment.create({
      data: { recordId, fileName: nom, name: "b.pdf", mimeType: "application/pdf", size: 7 },
    });

    await prisma.recordAttachment.delete({ where: { id: a.id } });
    await purgeOrphanUploads();
    expect(await existe(nom)).toBe(true); // b le cite encore

    await prisma.recordAttachment.delete({ where: { id: b.id } });
    await purgeOrphanUploads();
    expect(await existe(nom)).toBe(false);
  });

  it("⚠️ une carte en CORBEILLE protège encore ses pièces jointes", async () => {
    // La purge ne filtre pas trashedAt, et c'est voulu : sinon restaurer une
    // carte rendrait ses pièces jointes mortes.
    const nom = `corbeille-${Date.now()}.pdf`;
    await fichierAncien(nom);
    const rec = await prisma.record.findUniqueOrThrow({ where: { id: recordId } });
    const trashe = await prisma.record.create({
      data: { databaseId: rec.databaseId, title: "En corbeille", trashedAt: new Date() },
    });
    await prisma.recordAttachment.create({
      data: { recordId: trashe.id, fileName: nom, name: "x.pdf", mimeType: "application/pdf", size: 7 },
    });

    await purgeOrphanUploads();
    expect(await existe(nom)).toBe(true);
  });

  it("supprimer la carte DÉFINITIVEMENT emporte ses pièces jointes (Cascade)", async () => {
    const nom = `cascade-${Date.now()}.pdf`;
    await fichierAncien(nom);
    const rec = await prisma.record.findUniqueOrThrow({ where: { id: recordId } });
    const jetable = await prisma.record.create({
      data: { databaseId: rec.databaseId, title: "Jetable" },
    });
    await prisma.recordAttachment.create({
      data: { recordId: jetable.id, fileName: nom, name: "y.pdf", mimeType: "application/pdf", size: 7 },
    });

    await prisma.record.delete({ where: { id: jetable.id } });
    expect(await prisma.recordAttachment.count({ where: { fileName: nom } })).toBe(0);

    // Plus aucune ligne ne le cite : le fichier redevient un orphelin ordinaire.
    await purgeOrphanUploads();
    expect(await existe(nom)).toBe(false);
  });
});
