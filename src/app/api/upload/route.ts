import { NextResponse } from "next/server";
import { promises as fs } from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { getSession } from "@/lib/session";
import { getAppConfig } from "@/lib/appConfig";
import { uploadsDir, extForType } from "@/lib/uploads";

/** Upload d'une image (session requise). Taille max = AppConfig.uploadMaxMb. */
export async function POST(req: Request) {
  const user = await getSession();
  if (!user) return NextResponse.json({ error: "Non authentifié" }, { status: 401 });

  const form = await req.formData().catch(() => null);
  const file = form?.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "Fichier manquant" }, { status: 400 });
  }

  const ext = extForType(file.type);
  if (!ext) {
    return NextResponse.json(
      { error: "Type non supporté (images png/jpg/gif/webp/svg seulement)" },
      { status: 415 }
    );
  }

  const { uploadMaxMb } = await getAppConfig();
  if (file.size > uploadMaxMb * 1024 * 1024) {
    return NextResponse.json(
      { error: `Fichier trop volumineux (max ${uploadMaxMb} Mo)` },
      { status: 413 }
    );
  }

  const dir = uploadsDir();
  await fs.mkdir(dir, { recursive: true });
  const name = `${crypto.randomUUID()}.${ext}`;
  await fs.writeFile(path.join(dir, name), Buffer.from(await file.arrayBuffer()));

  return NextResponse.json({ url: `/api/files/${name}` });
}
