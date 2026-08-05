import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/session";
import { getMembership, hasRole } from "@/lib/workspace";
import { normalizeEmail } from "@/lib/oidc";
import {
  tooManyFailures,
  recordFailure,
  clearFailures,
  retryAfterSeconds,
  INVITE_BUDGET,
} from "@/lib/rateLimit";

/**
 * Clé de rate-limit de l'ajout de membre. Le PRÉFIXE est indispensable : le
 * login partage la même Map avec des clés `ip:email`, une clé nue collisionnerait.
 * On limite par utilisateur appelant (il est authentifié), pas par IP.
 */
const rateLimitKey = (userId: string) => `members:${userId}`;
/** Famille distincte : inviter est un SUCCÈS, pas un échec (cf. INVITE_BUDGET). */
const inviteLimitKey = (userId: string) => `invites:${userId}`;

const addMemberSchema = z.object({
  // .trim() AVANT .email() : zod valide avant que normalizeEmail passe, donc un
  // email collé avec une espace parasite serait refusé en 400 « Validation failed ».
  email: z.string().trim().email(),
  // Moindre privilège : lecteur par défaut, l'admin élève explicitement.
  role: z.enum(["admin", "editor", "viewer"]).default("viewer"),
});

const memberSelect = {
  userId: true,
  role: true,
  createdAt: true,
  user: { select: { email: true, displayName: true, isService: true } },
} as const;

type MemberRow = {
  userId: string;
  role: string;
  createdAt: Date;
  user: { email: string; displayName: string; isService: boolean };
};

const toMember = (m: MemberRow) => ({
  userId: m.userId,
  role: m.role,
  email: m.user.email,
  displayName: m.user.displayName,
  // Champ ADDITIF : un compte de service voit les pages PRIVÉES de l'espace
  // (isPageAccessible). Sans ce drapeau, rien à l'écran ne distingue une
  // automatisation d'un collègue. useWorkspaceMembers l'ignore côté board.
  isService: m.user.isService,
  createdAt: m.createdAt,
});

/** Liste des membres de l'espace — ouverte à tout membre (afficher qui est là). */
export async function GET(
  _: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getSession();
  if (!user) return NextResponse.json({ error: "Non authentifié" }, { status: 401 });

  const { id: workspaceId } = await params;
  const membership = await getMembership(user.id, workspaceId);
  if (!membership) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const members = await prisma.membership.findMany({
    where: { workspaceId },
    select: memberSelect,
    orderBy: { createdAt: "asc" },
  });
  return NextResponse.json(members.map(toMember));
}

/** Ajout d'un compte EXISTANT par email (pas d'envoi d'email en v1) — admin. */
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getSession();
  if (!user) return NextResponse.json({ error: "Non authentifié" }, { status: 401 });

  const { id: workspaceId } = await params;
  const membership = await getMembership(user.id, workspaceId);
  if (!membership) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (!hasRole(membership, "admin")) {
    return NextResponse.json({ error: "Rôle insuffisant" }, { status: 403 });
  }

  // Deux compteurs, deux natures. `members:` compte les ÉCHECS (409 déjà membre,
  // compte de service refusé) et partage le budget du login. `invites:` compte
  // les invitations, qui sont des SUCCÈS : les mélanger ferait qu'inviter une
  // équipe déclencherait un 429 accusant l'admin de sonder des comptes.
  // Placés après le rôle pour ne pas polluer le compteur d'un non-admin.
  const rateKey = rateLimitKey(user.id);
  if (tooManyFailures(rateKey)) {
    return NextResponse.json(
      { error: "Trop de tentatives infructueuses. Réessaie plus tard." },
      { status: 429, headers: { "Retry-After": String(retryAfterSeconds(rateKey)) } }
    );
  }
  const inviteKey = inviteLimitKey(user.id);
  if (tooManyFailures(inviteKey, Date.now(), INVITE_BUDGET)) {
    return NextResponse.json(
      { error: "Trop d'invitations envoyées. Réessaie plus tard." },
      { status: 429, headers: { "Retry-After": String(retryAfterSeconds(inviteKey)) } }
    );
  }

  const body = await req.json().catch(() => null);
  const parsed = addMemberSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Validation failed", details: parsed.error.flatten() },
      { status: 400 }
    );
  }

  const email = normalizeEmail(parsed.data.email);
  const target = await prisma.user.findUnique({
    where: { email },
    select: { id: true, isService: true },
  });

  // Un compte de service voit les pages PRIVÉES des espaces où il est membre
  // (isPageAccessible). L'ajouter par un champ email anonyme reviendrait à ouvrir
  // toute la confidentialité de l'espace à l'automatisation sans qu'aucun écran
  // ne le dise : sa mise en place reste le ressort de create-service-account.mjs.
  if (target?.isService) {
    recordFailure(rateKey);
    return NextResponse.json(
      {
        error:
          "Ce compte est un compte de service : il ne s'ajoute pas depuis cet écran (script d'exploitation dédié).",
      },
      { status: 409 }
    );
  }

  // ─── Le compte existe : membership immédiate, comme avant ────────────────────
  if (target) {
    const existing = await prisma.membership.findUnique({
      where: { userId_workspaceId: { userId: target.id, workspaceId } },
      select: { userId: true },
    });
    if (existing) {
      recordFailure(rateKey);
      return NextResponse.json({ error: "Déjà membre de cet espace" }, { status: 409 });
    }

    // role TOUJOURS explicite : Membership.role a @default("admin") en schéma —
    // un create qui l'omettrait fabriquerait un admin silencieux.
    const created = await prisma.membership.create({
      data: { userId: target.id, workspaceId, role: parsed.data.role },
      select: memberSelect,
    });
    clearFailures(rateKey);
    return NextResponse.json({ status: "member", ...toMember(created) });
  }

  // ─── Pas de compte : PRÉ-AUTORISATION ────────────────────────────────────────
  // ⚠️ Ceci ne FERME PAS l'oracle d'énumération, ça en change la forme : le 404
  // distinctif disparaît, mais « member » vs « invited » dit exactement la même
  // chose. Le fermer vraiment exigerait de ne jamais matérialiser immédiatement,
  // au prix d'un collègue déjà inscrit qui n'apparaîtrait qu'à sa connexion
  // suivante. Le rate-limit reste donc le vrai plafond du sondage.
  const invitation = await prisma.workspaceInvitation.upsert({
    where: { workspaceId_email: { workspaceId, email } },
    create: { workspaceId, email, role: parsed.data.role, invitedBy: user.id },
    // Ré-inviter le même email met à jour le rôle plutôt que de rendre un 409 :
    // c'est le geste attendu quand on s'est trompé de rôle.
    update: { role: parsed.data.role, invitedBy: user.id },
    select: { id: true, email: true, role: true, createdAt: true },
  });
  recordFailure(inviteKey, Date.now(), INVITE_BUDGET);
  console.info(
    `[member-invited] actor=${user.id} workspace=${workspaceId} role=${parsed.data.role}`
  );
  return NextResponse.json({ status: "invited", ...invitation }, { status: 201 });
}
