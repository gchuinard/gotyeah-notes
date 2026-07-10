import { NextResponse } from "next/server";
import { z } from "zod";
import { getSession } from "@/lib/session";
import { getAppConfig, setAppConfig } from "@/lib/appConfig";
import { purgeOrphanUploads } from "@/lib/uploads";

/** Réglages globaux de l'instance. Le GET déclenche la purge paresseuse des orphelins. */
export async function GET() {
  const user = await getSession();
  if (!user) return NextResponse.json({ error: "Non authentifié" }, { status: 401 });

  // Purge des uploads orphelins > 30 j (pas de cron en self-host ; page réglages = rare).
  // Bornée : ne scanne le contenu que s'il existe des fichiers assez vieux.
  await purgeOrphanUploads().catch(() => {});

  const cfg = await getAppConfig();
  return NextResponse.json({ uploadMaxMb: cfg.uploadMaxMb });
}

const patchSchema = z.object({
  uploadMaxMb: z.number().int().min(1).max(200).optional(),
});

export async function PATCH(req: Request) {
  const user = await getSession();
  if (!user) return NextResponse.json({ error: "Non authentifié" }, { status: 401 });

  const body = await req.json().catch(() => null);
  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Validation failed", details: parsed.error.flatten() },
      { status: 400 }
    );
  }

  const cfg = await setAppConfig(parsed.data);
  return NextResponse.json({ uploadMaxMb: cfg.uploadMaxMb });
}
