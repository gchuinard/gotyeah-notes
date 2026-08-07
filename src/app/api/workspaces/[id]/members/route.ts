import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/session";
import { getMembership, hasRole } from "@/lib/workspace";
import { notify } from "@/lib/notify";
import { normalizeEmail } from "@/lib/oidc";
import { notifyInvitation } from "@/lib/invitationEmail";
import { issueMagicLink, INVITE_LINK_TTL_MINUTES } from "@/lib/magicLink";
import { appBaseUrl } from "@/lib/mailer";
import type { MailResult } from "@/lib/mailer";
import {
  tooManyFailures,
  recordFailure,
  clearFailures,
  retryAfterSeconds,
  recipientAllowed,
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

/**
 * ⚠️ Le plafond par destinataire (`recipientAllowed`, lib/rateLimit) retient
 * l'EMAIL, jamais l'écriture, et ne change PAS le code HTTP ici.
 *
 * Les deux points sont load-bearing. Refuser l'invitation punirait un admin pour
 * un abus qu'il ne commet pas (c'est la cible qui est saturée, pas lui). Et
 * répondre 429 ferait de la route un oracle : « cette adresse a déjà été visée
 * récemment » est une information sur un tiers.
 */

const addMemberSchema = z.object({
  // .trim() AVANT .email() : zod valide avant que normalizeEmail passe, donc un
  // email collé avec une espace parasite serait refusé en 400 « Validation failed ».
  email: z.string().trim().email(),
  // Moindre privilège : lecteur par défaut, l'admin élève explicitement.
  role: z.enum(["admin", "editor", "viewer"]).default("viewer"),
});

/**
 * Champs ADDITIFS de la réponse : le front et le MCP qui les ignorent ne cassent
 * pas. Ils sont là parce qu'un email silencieusement raté est pire qu'un email
 * absent — l'admin croirait la personne prévenue et attendrait une connexion qui
 * ne viendra pas. `disabled` (pas de clé Brevo) n'est pas une panne : c'est le
 * mode historique, où l'on prévient à la main.
 */
const mailStatus = (r: MailResult) =>
  r.ok ? { emailSent: true } : { emailSent: false, emailReason: r.reason };

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

/**
 * Ajout par email — admin. Deux issues selon que l'adresse a déjà un compte :
 * membership immédiate (200, `member`) ou pré-autorisation (201, `invited`).
 * Dans les deux cas un email de notification est tenté (jamais bloquant).
 * C'est aussi le chemin du bouton « Renvoyer » : l'upsert ré-émet l'invitation.
 */
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

  // Nom de l'espace pour l'email — chargé une fois, avant les deux branches.
  const workspace = await prisma.workspace.findUnique({
    where: { id: workspaceId },
    select: { name: true },
  });
  const mailCtx = {
    workspaceName: workspace?.name ?? "un espace",
    inviterName: user.displayName,
    role: parsed.data.role,
  };

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

  // ─── Le compte existe : on PROPOSE, on n'ajoute plus d'office ───────────────
  // ⚠️ CHANGEMENT DE CONTRAT (07/08). Auparavant la Membership était créée
  // immédiatement : l'espace apparaissait dans la barre latérale de quelqu'un
  // qui n'avait rien demandé. Pire, ce comportement était le TREMPLIN de
  // l'escalade trouvée sur les comptes SSO — « admin de cet espace » devenait
  // auto-attribuable en fabriquant un espace et en y ajoutant de force sa cible.
  //
  // Désormais : une invitation en attente, plus une notification dans la cloche.
  // La réponse ne dit plus jamais `member` — le pont MCP et l'écran Membres
  // lisent ce champ, ils ont été mis à jour en conséquence.
  if (target) {
    const existing = await prisma.membership.findUnique({
      where: { userId_workspaceId: { userId: target.id, workspaceId } },
      select: { userId: true },
    });
    if (existing) {
      recordFailure(rateKey);
      return NextResponse.json({ error: "Déjà membre de cet espace" }, { status: 409 });
    }

    const invitation = await prisma.$transaction(async (tx) => {
      const inv = await tx.workspaceInvitation.upsert({
        where: { workspaceId_email: { workspaceId, email } },
        create: { workspaceId, email, role: parsed.data.role, invitedBy: user.id },
        // ⚠️ `declinedAt: null` remet un refus à zéro : ré-inviter est un geste
        // délibéré, il rouvre la porte que la personne avait fermée. Sans ça,
        // une invitation refusée resterait morte et le bouton « Renvoyer »
        // n'aurait aucun effet visible.
        update: {
          role: parsed.data.role,
          invitedBy: user.id,
          createdAt: new Date(),
          declinedAt: null,
        },
        select: { id: true, email: true, role: true, createdAt: true },
      });
      await notify(tx, [
        {
          userId: target.id,
          type: "workspace_invitation",
          workspaceId,
          actorId: user.id,
          invitationId: inv.id,
          payload: { workspaceName: mailCtx.workspaceName, actorName: mailCtx.inviterName },
        },
      ]);
      return inv;
    });

    recordFailure(inviteKey, Date.now(), INVITE_BUDGET);
    // L'email reste un simple RAPPEL : la cloche est le canal principal pour
    // quelqu'un qui a déjà un compte, et il la verra à sa prochaine visite.
    const mail = recipientAllowed(email)
      ? await notifyInvitation(email, "invited", mailCtx)
      : ({ ok: false, reason: "throttled" } as const);
    return NextResponse.json(
      {
        status: "invited",
        id: invitation.id,
        email: invitation.email,
        role: invitation.role,
        createdAt: invitation.createdAt,
        /** Champ ADDITIF : la personne a un compte, elle verra la cloche. */
        notified: true,
        ...mailStatus(mail),
      },
      { status: 201 }
    );
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
    // c'est le geste attendu quand on s'est trompé de rôle. C'est AUSSI le
    // chemin du bouton « Renvoyer » — d'où le rafraîchissement de createdAt, qui
    // vaut donc « dernière émission » et prolonge les INVITATION_TTL_DAYS.
    // Sans lui, relancer une invitation périmée enverrait un email déjà mort.
    update: {
      role: parsed.data.role,
      invitedBy: user.id,
      createdAt: new Date(),
      // Ré-inviter rouvre une porte qu'un refus avait fermée.
      declinedAt: null,
    },
    select: { id: true, email: true, role: true, createdAt: true },
  });
  recordFailure(inviteKey, Date.now(), INVITE_BUDGET);

  // Lien de connexion glissé DANS l'email d'invitation : un message, un clic,
  // et l'invité est dans son espace. Émis APRÈS l'écriture, comme l'email —
  // l'invitation est la source de vérité, et un jeton qui ne partirait pas ne
  // doit pas l'annuler. Son TTL est celui de l'invitation : plus court, l'invité
  // qui ouvre son courrier le lendemain trouverait un lien mort.
  const token = await issueMagicLink(email, INVITE_LINK_TTL_MINUTES);
  const base = appBaseUrl();
  const loginUrl =
    token && base ? `${base}/api/auth/magic/consume?token=${encodeURIComponent(token)}` : undefined;

  const mail = recipientAllowed(email)
    ? await notifyInvitation(email, "invited", { ...mailCtx, loginUrl })
    : ({ ok: false, reason: "throttled" } as const);
  // Ni l'adresse invitée ni le résultat détaillé : l'acteur et l'espace suffisent
  // à corréler, la ligne d'invitation est en base.
  console.info(
    `[member-invited] actor=${user.id} workspace=${workspaceId} role=${parsed.data.role} mail=${mail.ok ? "sent" : mail.reason} lien=${loginUrl ? "oui" : "non"}`
  );
  return NextResponse.json(
    {
      status: "invited",
      ...invitation,
      ...mailStatus(mail),
      // Champ ADDITIF : l'email contient-il un lien de connexion direct ? Sans
      // lui, l'invité devra demander son lien depuis l'écran de connexion.
      loginLink: Boolean(loginUrl),
    },
    { status: 201 }
  );
}
