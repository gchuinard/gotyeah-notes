import { NextResponse } from "next/server";
import { z } from "zod";
import { getSession } from "@/lib/session";
import {
  getMembership,
  hasRole,
  updateMemberRole,
  removeMember,
} from "@/lib/workspace";

const patchMemberSchema = z.object({
  role: z.enum(["admin", "editor", "viewer"]),
});

const LAST_ADMIN_ERROR = "Impossible de retirer le dernier admin de l'espace";

/** Changement de rôle d'un membre — admin. Garde-fou « dernier admin » → 409. */
export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string; userId: string }> }
) {
  const user = await getSession();
  if (!user) return NextResponse.json({ error: "Non authentifié" }, { status: 401 });

  const { id: workspaceId, userId: targetUserId } = await params;
  const membership = await getMembership(user.id, workspaceId);
  if (!membership) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (!hasRole(membership, "admin")) {
    return NextResponse.json({ error: "Rôle insuffisant" }, { status: 403 });
  }

  const body = await req.json().catch(() => null);
  const parsed = patchMemberSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Validation failed", details: parsed.error.flatten() },
      { status: 400 }
    );
  }

  const result = await updateMemberRole(workspaceId, targetUserId, parsed.data.role);
  if (!result.ok) {
    if (result.code === "last_admin") {
      return NextResponse.json({ error: LAST_ADMIN_ERROR }, { status: 409 });
    }
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  return NextResponse.json(result.membership);
}

/**
 * Retrait d'un membre — admin, SAUF sa propre membership (quitter l'espace,
 * ouvert à tout membre). Garde-fou « dernier admin » dans les deux cas → 409.
 */
export async function DELETE(
  _: Request,
  { params }: { params: Promise<{ id: string; userId: string }> }
) {
  const user = await getSession();
  if (!user) return NextResponse.json({ error: "Non authentifié" }, { status: 401 });

  const { id: workspaceId, userId: targetUserId } = await params;
  const membership = await getMembership(user.id, workspaceId);
  if (!membership) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (targetUserId !== user.id && !hasRole(membership, "admin")) {
    return NextResponse.json({ error: "Rôle insuffisant" }, { status: 403 });
  }

  const result = await removeMember(workspaceId, targetUserId);
  if (!result.ok) {
    if (result.code === "last_admin") {
      return NextResponse.json({ error: LAST_ADMIN_ERROR }, { status: 409 });
    }
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  return NextResponse.json({ ok: true });
}
