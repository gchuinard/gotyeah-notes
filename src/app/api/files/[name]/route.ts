import { NextResponse } from "next/server";
import { promises as fs } from "node:fs";
import path from "node:path";
import { getSession } from "@/lib/session";
import { uploadsDir, isSafeUploadName, fileResponseHeaders } from "@/lib/uploads";

/** Sert un fichier uploadé (session requise, nom validé anti path-traversal). */
export async function GET(_: Request, { params }: { params: Promise<{ name: string }> }) {
  const user = await getSession();
  if (!user) return NextResponse.json({ error: "Non authentifié" }, { status: 401 });

  const { name } = await params;
  if (!isSafeUploadName(name)) {
    return NextResponse.json({ error: "Nom invalide" }, { status: 400 });
  }

  try {
    const buf = await fs.readFile(path.join(uploadsDir(), name));
    return new NextResponse(new Uint8Array(buf), {
      headers: fileResponseHeaders(name),
    });
  } catch {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
}
