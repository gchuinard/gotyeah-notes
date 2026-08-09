import { NextResponse } from "next/server";
import { createReadStream } from "node:fs";
import { promises as fs } from "node:fs";
import { Readable } from "node:stream";
import path from "node:path";
import { getSession } from "@/lib/session";
import { checkRecordAccess, hasRole } from "@/lib/workspace";
import { prisma } from "@/lib/prisma";
import { uploadsDir, isSafeUploadName, FILE_CSP } from "@/lib/uploads";

/**
 * Téléchargement et retrait d'une pièce jointe.
 *
 * ⚠️ L'accès passe par la CARTE (checkRecordAccess), pas par le nom du fichier.
 * C'est toute la différence avec GET /api/files/[name], qui ne vérifie qu'une
 * session : là-bas, connaître le nom suffit ; ici, perdre l'accès à la carte
 * ferme aussi le document.
 */

async function accessibleAttachment(id: string, userId: string) {
  const row = await prisma.recordAttachment.findUnique({
    where: { id },
    select: { id: true, recordId: true, fileName: true, name: true, mimeType: true },
  });
  if (!row) return null;
  const access = await checkRecordAccess(row.recordId, userId);
  if (!access) return null;
  return { row, access };
}

export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getSession();
  if (!user) return NextResponse.json({ error: "Non authentifié" }, { status: 401 });

  const { id } = await params;
  const found = await accessibleAttachment(id, user.id);
  if (!found || !isSafeUploadName(found.row.fileName)) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const chemin = path.join(uploadsDir(), found.row.fileName);
  let taille: number;
  try {
    taille = (await fs.stat(chemin)).size;
  } catch {
    // La ligne survit à son fichier (purge, restauration partielle) : 404 plutôt
    // qu'une erreur serveur, l'écran affiche alors un lien mort.
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  // ⚠️ STREAMING, pas fs.readFile. Le patron de /api/files charge le fichier
  // ENTIER en RAM ; recopié ici avec des documents de plusieurs Mo, trois
  // téléchargements simultanés feraient un pic proportionnel sur un Pi arm64 où
  // le build sature déjà la mémoire.
  const flux = Readable.toWeb(createReadStream(chemin)) as ReadableStream<Uint8Array>;

  // Le nom d'ORIGINE est restitué ici — il n'existe que dans cette ligne, le
  // disque ne connaît qu'un UUID. RFC 5987 pour les accents et les espaces.
  const encode = encodeURIComponent(found.row.name);
  return new NextResponse(flux, {
    headers: {
      "Content-Type": "application/octet-stream",
      "Content-Length": String(taille),
      "Content-Disposition": `attachment; filename*=UTF-8''${encode}`,
      "Content-Security-Policy": FILE_CSP,
      "Cross-Origin-Resource-Policy": "same-origin",
      // ⚠️ no-store, contrairement à /api/files : un document retiré, ou un
      // accès révoqué, resterait sinon servi par le cache du navigateur.
      "Cache-Control": "no-store",
    },
  });
}

export async function DELETE(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getSession();
  if (!user) return NextResponse.json({ error: "Non authentifié" }, { status: 401 });

  const { id } = await params;
  const found = await accessibleAttachment(id, user.id);
  if (!found) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (!hasRole(found.access.membership, "editor")) {
    return NextResponse.json({ error: "Rôle insuffisant" }, { status: 403 });
  }

  // ⚠️ On supprime la LIGNE, jamais le fichier. Un autre enregistrement peut le
  // citer (duplication de carte), et c'est purgeOrphanUploads qui décide : elle
  // recalcule l'ensemble des noms référencés à chaque passage. Un `unlink` ici
  // casserait la pièce jointe de la carte dupliquée.
  await prisma.recordAttachment.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
