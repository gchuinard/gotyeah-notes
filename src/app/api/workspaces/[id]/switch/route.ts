import { NextResponse } from "next/server";
import { getSession, getSessionToken, setSessionWorkspace } from "@/lib/session";
import { getMembership } from "@/lib/workspace";

export async function POST(
  _: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getSession();
  if (!user) return NextResponse.json({ error: "Non authentifié" }, { status: 401 });

  const { id } = await params;
  const membership = await getMembership(user.id, id);
  if (!membership) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const token = await getSessionToken();
  if (token) await setSessionWorkspace(token, id);

  return NextResponse.json({ ok: true });
}
