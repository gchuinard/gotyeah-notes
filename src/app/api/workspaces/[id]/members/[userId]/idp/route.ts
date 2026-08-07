import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/session";
import { getMembership, hasRole } from "@/lib/workspace";
import { normalizeEmail } from "@/lib/oidc";
import {
  keycloakAdminEnabled,
  provisionIdpAccount,
  setIdpAccountEnabled,
} from "@/lib/keycloak";
import {
  tooManyFailures,
  recordFailure,
  retryAfterSeconds,
  recipientAllowed,
  recipientKey,
  INVITE_BUDGET,
} from "@/lib/rateLimit";

/**
 * Compte d'identité (IdP) d'un membre : création, suspension, réactivation.
 *
 * ⚠️ CE QUE CETTE ROUTE NE FAIT PAS, et pourquoi.
 *
 * Elle ne SUPPRIME rien. Le realm est partagé par tous les sites de
 * l'écosystème : supprimer un compte détruit le `sub` sur lequel les autres
 * reconnaissent la personne, ainsi que son MFA et ses identités fédérées, sans
 * corbeille ni sauvegarde (le snapshot pré-MEP ne couvre que la SQLite de
 * notes). La suspension obtient le même effet et se défait d'un clic.
 *
 * Elle ne RÉVOQUE PAS l'accès à notes. Suspendre le compte IdP laisse intactes
 * la Membership, le compte notes et le canal de connexion par lien email. Le
 * geste qui met quelqu'un dehors reste `DELETE /members/[userId]` — l'écran doit
 * le dire, sans quoi l'admin croira avoir fermé une porte qui reste ouverte.
 */

const idpActionSchema = z.object({
  action: z.enum(["create", "suspend", "resume"]),
  /**
   * Confirmation par recopie de l'adresse, exigée pour suspendre. Le rayon de
   * l'action DÉPASSE cette application — la personne perd l'accès à tous les
   * sites du realm. Une modale « es-tu sûr ? » se clique sans lire ; recopier
   * l'adresse oblige à regarder QUI est visé.
   */
  confirmEmail: z.string().trim().optional(),
});

const inviteLimitKey = (userId: string) => `invites:${userId}`;

export async function POST(
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
  const parsed = idpActionSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Validation failed", details: parsed.error.flatten() },
      { status: 400 }
    );
  }
  const { action, confirmEmail } = parsed.data;

  // La cible doit être membre de CET espace — sinon un admin de son propre
  // espace agirait sur l'identité de n'importe qui.
  const target = await prisma.membership.findUnique({
    where: { userId_workspaceId: { userId: targetUserId, workspaceId } },
    select: {
      user: { select: { email: true, firstName: true, lastName: true, isService: true } },
    },
  });
  if (!target) return NextResponse.json({ error: "Not found" }, { status: 404 });

  // Même refus que POST /members : un compte de service n'a pas de boîte mail,
  // et il voit les pages privées des espaces où il est membre. Lui fabriquer une
  // identité humaine avec une activation en attente n'a aucun sens.
  if (target.user.isService) {
    return NextResponse.json(
      { error: "Ce compte est un compte de service : il ne se connecte pas par SSO." },
      { status: 409 }
    );
  }

  if (!keycloakAdminEnabled()) {
    return NextResponse.json(
      { error: "La gestion des comptes SSO n'est pas configurée sur cette instance." },
      { status: 409 }
    );
  }

  const email = normalizeEmail(target.user.email);

  if (action === "create") {
    // ⚠️ L'email d'activation est émis par KEYCLOAK, pas par lib/mailer : il
    // échappe donc aux compteurs de l'invitation. Sans ce passage, un bouton
    // re-cliquable rouvrirait le canal d'envoi vers l'adresse d'un tiers que
    // RECIPIENT_BUDGET a précisément fermé.
    const actorKey = inviteLimitKey(user.id);
    if (tooManyFailures(actorKey, Date.now(), INVITE_BUDGET)) {
      return NextResponse.json(
        { error: "Trop d'envois. Réessaie plus tard." },
        { status: 429, headers: { "Retry-After": String(retryAfterSeconds(actorKey)) } }
      );
    }
    // ⚠️ Ici, contrairement à l'invitation, le plafond destinataire REFUSE
    // l'action au lieu de la laisser passer sans email : provisionner un compte
    // dont l'activation ne part pas produit un compte sans mot de passe, donc
    // exactement le cul-de-sac que `resent` sert à réparer. Et il n'y a pas
    // d'oracle à craindre — l'admin voit déjà ce membre et son adresse.
    if (!recipientAllowed(email)) {
      return NextResponse.json(
        { error: "Trop d'envois vers cette adresse. Réessaie plus tard." },
        { status: 429, headers: { "Retry-After": String(retryAfterSeconds(recipientKey(email))) } }
      );
    }
    recordFailure(actorKey, Date.now(), INVITE_BUDGET);

    const result = await provisionIdpAccount({
      email,
      firstName: target.user.firstName,
      lastName: target.user.lastName,
    });
    console.info(
      `[idp-action] actor=${user.id} workspace=${workspaceId} target=${targetUserId} action=create status=${result.status}`
    );
    return NextResponse.json({ action, ...result });
  }

  if (action === "suspend") {
    // Garde anti-verrouillage. LEGACY_LOGIN vaut `off` en production : un admin
    // qui suspend son propre compte IdP n'a plus que le lien email pour rentrer,
    // et ce canal dépend d'une clé Brevo qui peut être absente. Se couper soi-même
    // ne doit pas être un clic.
    if (targetUserId === user.id) {
      return NextResponse.json(
        { error: "Tu ne peux pas suspendre ton propre accès SSO." },
        { status: 409 }
      );
    }
    if (!confirmEmail || normalizeEmail(confirmEmail) !== email) {
      return NextResponse.json(
        { error: "Recopie l'adresse du membre pour confirmer la suspension." },
        { status: 400 }
      );
    }
  }

  const result = await setIdpAccountEnabled(email, action === "resume");
  console.info(
    `[idp-action] actor=${user.id} workspace=${workspaceId} target=${targetUserId} action=${action} status=${result.status}`
  );
  return NextResponse.json({ action, ...result });
}
