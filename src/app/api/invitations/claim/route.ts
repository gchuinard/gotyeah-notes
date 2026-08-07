import { NextResponse } from "next/server";
import { z } from "zod";
import { randomBytes } from "node:crypto";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/prisma";
import { hashToken, createSession, SESSION_COOKIE } from "@/lib/session";
import { invitationCutoff } from "@/lib/invitations";
import { createWorkspaceWithDefaults, WORKSPACE_ROLES, type WorkspaceRole } from "@/lib/workspace";
import { notify } from "@/lib/notify";
import { magicLinkEnabled } from "@/lib/magicLink";

/**
 * Écran d'acceptation d'un invité qui n'a AUCUN compte — la seule route qui crée
 * un User sans qu'aucune session n'existe. Portée par le jeton du lien email, pas
 * par un cookie ; elle est donc PUBLIQUE (cf. PUBLIC_PATHS du proxy).
 *
 * ⚠️ GET = APERÇU, il ne consomme rien. `consumeMagicLink` détruit le jeton à la
 * lecture par conception — « la suppression EST la preuve de possession » — mais
 * un écran qui demande « acceptes-tu ? » doit pouvoir s'afficher, puis attendre.
 * L'aperçu ne rend donc QUE des libellés : jamais le rôle offert, jamais un
 * identifiant exploitable. Ce qu'un attaquant en tirerait avec un jeton volé,
 * c'est le nom d'un espace — et avec ce jeton il pouvait déjà entrer.
 *
 * ⚠️ POST = ACCEPTATION, et c'est LUI qui consomme, atomiquement. Rien n'est
 * créé avant : ni User, ni Membership. C'est la décision du 07/08.
 */

const acceptSchema = z.object({
  token: z.string().min(1),
  action: z.enum(["accept", "decline"]),
});

const safeRole = (role: string): WorkspaceRole =>
  (WORKSPACE_ROLES as readonly string[]).includes(role) ? (role as WorkspaceRole) : "viewer";

/** Le jeton est-il vivant, et à quelle adresse invitée correspond-il ? */
async function resolveToken(token: string) {
  if (!token) return null;
  const row = await prisma.loginToken.findUnique({
    where: { id: hashToken(token) },
    select: { id: true, email: true, expiresAt: true },
  });
  if (!row || row.expiresAt.getTime() <= Date.now()) return null;
  return row;
}

export async function GET(req: Request) {
  if (!magicLinkEnabled()) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const token = new URL(req.url).searchParams.get("token") ?? "";
  const row = await resolveToken(token);
  // Réponse UNIFORME sur tout échec : un jeton inventé, expiré ou déjà consommé
  // rend la même chose. Distinguer ferait de cette route publique un oracle.
  if (!row) return NextResponse.json({ valid: false });

  const invitations = await prisma.workspaceInvitation.findMany({
    where: { email: row.email, declinedAt: null, createdAt: { gte: invitationCutoff() } },
    select: { id: true, workspace: { select: { name: true } }, inviter: { select: { displayName: true } } },
  });
  if (invitations.length === 0) return NextResponse.json({ valid: false });

  // Déjà un compte : ce n'est pas le bon écran, la personne doit se connecter et
  // répondre depuis sa cloche.
  const existing = await prisma.user.findUnique({
    where: { email: row.email },
    select: { id: true },
  });

  return NextResponse.json({
    valid: true,
    hasAccount: existing !== null,
    email: row.email,
    // Libellés SEULEMENT — pas de rôle, pas d'id d'espace.
    invitations: invitations.map((i) => ({
      workspaceName: i.workspace?.name ?? "un espace",
      inviterName: i.inviter?.displayName ?? null,
    })),
  });
}

export async function POST(req: Request) {
  if (!magicLinkEnabled()) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const body = await req.json().catch(() => null);
  const parsed = acceptSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Validation failed", details: parsed.error.flatten() },
      { status: 400 }
    );
  }

  const row = await resolveToken(parsed.data.token);
  if (!row) return NextResponse.json({ error: "Lien invalide ou expiré" }, { status: 410 });

  // ⚠️ CONSOMMATION ATOMIQUE, avant toute écriture. `deleteMany` rend le nombre
  // de lignes retirées : sur deux requêtes concurrentes portant le même jeton,
  // une seule obtient 1. C'est la garantie d'usage unique, au même endroit et
  // pour la même raison que dans `consumeMagicLink`.
  const { count } = await prisma.loginToken.deleteMany({ where: { id: row.id } });
  if (count !== 1) return NextResponse.json({ error: "Lien invalide ou expiré" }, { status: 410 });

  const email = row.email;
  const pending = await prisma.workspaceInvitation.findMany({
    where: { email, declinedAt: null, createdAt: { gte: invitationCutoff() } },
    select: { id: true, workspaceId: true, role: true, invitedBy: true, workspace: { select: { name: true } } },
  });
  if (pending.length === 0) {
    return NextResponse.json({ error: "Aucune invitation en attente" }, { status: 410 });
  }

  if (parsed.data.action === "decline") {
    // Refuser ne crée AUCUN compte : c'est tout l'objet de cet écran.
    await prisma.workspaceInvitation.updateMany({
      where: { id: { in: pending.map((i) => i.id) } },
      data: { declinedAt: new Date() },
    });
    return NextResponse.json({ status: "declined" });
  }

  const local = email.split("@")[0];
  // Aucun mot de passe utilisable : ce chemin n'en demande jamais, et
  // LEGACY_LOGIN est fermé en production. Un hash aléatoire vaut « aucun ».
  const passwordHash = await bcrypt.hash(randomBytes(32).toString("base64url"), 12);

  const created = await prisma.$transaction(async (tx) => {
    const user = await tx.user.create({
      data: { email, firstName: local, lastName: "", displayName: local, passwordHash },
      select: { id: true },
    });
    await tx.membership.createMany({
      data: pending.map((i) => ({
        userId: user.id,
        workspaceId: i.workspaceId,
        role: safeRole(i.role),
      })),
    });
    await tx.workspaceInvitation.deleteMany({ where: { id: { in: pending.map((i) => i.id) } } });
    // L'émetteur apprend que son invité est entré.
    await notify(
      tx,
      pending
        .filter((i) => i.invitedBy)
        .map((i) => ({
          userId: i.invitedBy!,
          type: "workspace_joined" as const,
          workspaceId: i.workspaceId,
          actorId: user.id,
          payload: { workspaceName: i.workspace?.name, actorName: local },
        }))
    );
    return user;
  });

  // « Mon espace » APRÈS la transaction : son échec ne doit pas annuler
  // l'acceptation, qui est ce que la personne vient de demander.
  const own = await createWorkspaceWithDefaults("Mon espace", created.id).catch(() => null);

  const session = await createSession(created.id, pending[0].workspaceId ?? own?.id ?? null);
  const res = NextResponse.json({ status: "accepted", workspaceId: pending[0].workspaceId });
  res.cookies.set(SESSION_COOKIE, session, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: 60 * 60 * 24 * 30,
    path: "/",
  });
  return res;
}
