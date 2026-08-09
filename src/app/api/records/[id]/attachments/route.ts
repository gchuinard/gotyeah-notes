import { NextResponse } from "next/server";
import { promises as fs } from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { getSession } from "@/lib/session";
import { checkRecordAccess, hasRole } from "@/lib/workspace";
import { getAppConfig } from "@/lib/appConfig";
import { prisma } from "@/lib/prisma";
import { uploadsDir, attachmentExtForType } from "@/lib/uploads";

/**
 * Pièces jointes d'une carte.
 *
 * ⚠️ Route SÉPARÉE de POST /api/upload, qui reste image-only. Élargir celle-là
 * ouvrirait les documents aux éditeurs BlockNote — donc aux pages — et ils
 * seraient servis par GET /api/files/[name], qui ne vérifie qu'une session et
 * n'est scopé à aucun espace. Ici l'accès passe par checkRecordAccess : la carte
 * décide, comme pour tout le reste.
 */

/** Longueur du nom d'origine conservé. Au-delà, c'est du remplissage. */
const MAX_NAME = 200;

export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getSession();
  if (!user) return NextResponse.json({ error: "Non authentifié" }, { status: 401 });

  const { id } = await params;
  const access = await checkRecordAccess(id, user.id);
  if (!access) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const rows = await prisma.recordAttachment.findMany({
    where: { recordId: id },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      name: true,
      mimeType: true,
      size: true,
      createdAt: true,
      // ⚠️ displayName SEULEMENT, jamais l'email : règle du projet pour toute
      // surface de consultation.
      uploader: { select: { displayName: true } },
    },
  });
  return NextResponse.json(
    rows.map((r) => ({
      id: r.id,
      name: r.name,
      mimeType: r.mimeType,
      size: r.size,
      createdAt: r.createdAt,
      uploadedBy: r.uploader?.displayName ?? null,
    }))
  );
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getSession();
  if (!user) return NextResponse.json({ error: "Non authentifié" }, { status: 401 });

  const { id } = await params;
  const access = await checkRecordAccess(id, user.id);
  if (!access) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (!hasRole(access.membership, "editor")) {
    return NextResponse.json({ error: "Rôle insuffisant" }, { status: 403 });
  }

  const form = await req.formData().catch(() => null);
  const file = form?.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "Fichier manquant" }, { status: 400 });
  }

  const ext = attachmentExtForType(file.type);
  if (!ext) {
    return NextResponse.json(
      { error: "Type non supporté (PDF, Office, texte, CSV, ZIP ou image)" },
      { status: 415 }
    );
  }

  // Même plafond que les images : un seul réglage, dans Réglages → Stockage.
  // Un second champ obligerait la route à choisir lequel appliquer.
  const { uploadMaxMb } = await getAppConfig();
  if (file.size > uploadMaxMb * 1024 * 1024) {
    return NextResponse.json(
      { error: `Fichier trop volumineux (max ${uploadMaxMb} Mo)` },
      { status: 413 }
    );
  }

  const fileName = `${crypto.randomUUID()}.${ext}`;
  const dir = uploadsDir();
  await fs.mkdir(dir, { recursive: true });

  // ⚠️ ORDRE : le fichier D'ABORD, la ligne ENSUITE. L'inverse laisserait une
  // ligne visible pointant dans le vide ; ce sens-là ne laisse au pire qu'un
  // orphelin, ramassé par la purge à J+30.
  await fs.writeFile(path.join(dir, fileName), Buffer.from(await file.arrayBuffer()));

  const nomOrigine = (file.name || "document").trim().slice(0, MAX_NAME) || "document";
  const row = await prisma.recordAttachment.create({
    data: {
      recordId: id,
      fileName,
      name: nomOrigine,
      mimeType: file.type,
      size: file.size,
      uploadedBy: user.id,
    },
    select: { id: true, name: true, mimeType: true, size: true, createdAt: true },
  });

  return NextResponse.json({ ...row, uploadedBy: user.displayName }, { status: 201 });
}
