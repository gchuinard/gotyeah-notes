import { sendEmail, appBaseUrl, type OutgoingEmail, type MailResult } from "./mailer";

/**
 * Contenu des emails d'invitation / d'ajout à un espace.
 *
 * ⚠️ AUCUN JETON n'est transporté ici, et c'est le cœur du design (décision du
 * 05/08) : l'invitation est une pré-autorisation posée sur une ADRESSE, et c'est
 * l'IdP (Keycloak, realm `gotyeah`, `email_verified` vérifié au callback) qui
 * garantit que la personne connectée possède bien cette adresse. Un jeton dans
 * l'email n'ajouterait aucune preuve — il ne ferait que mettre un secret
 * réutilisable dans une boîte mail, un historique de navigation et un Referer.
 *
 * Conséquence pratique : ces emails sont de simples NOTIFICATIONS. Les perdre ne
 * coûte que la notification ; l'invitation, elle, reste en base.
 */

const ROLE_LABELS: Record<string, string> = {
  admin: "administrateur",
  editor: "éditeur",
  viewer: "lecteur",
};

/** Rôle inconnu (base plus récente que ce code) : on n'affiche rien plutôt qu'un id brut. */
export function roleLabel(role: string): string {
  return ROLE_LABELS[role] ?? "membre";
}

/**
 * ⚠️ Obligatoire : le nom d'un espace et le displayName d'un inviteur sont des
 * chaînes libres écrites par des utilisateurs. Injectées telles quelles dans le
 * HTML d'un email, elles y placeraient des balises arbitraires — un `<a>` de
 * hameçonnage sous l'apparence d'un email GotYeah. Le JS ne s'exécute pas dans
 * un client mail, mais un lien, si.
 */
export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

type EmailContext = {
  workspaceName: string;
  inviterName: string;
  role: string;
  /** Origine publique de l'app. Vide = email sans bouton (cf. appBaseUrl). */
  url: string;
};

function layout(heading: string, body: string, url: string): string {
  const button = url
    ? `<tr><td align="center" style="padding:26px 32px 6px;">
        <a href="${escapeHtml(url)}" style="display:inline-block;padding:13px 34px;font-family:Segoe UI,Arial,sans-serif;font-size:15px;font-weight:600;color:#ffffff;background:#2f6feb;text-decoration:none;border-radius:8px;">Ouvrir GotYeah Notes</a>
      </td></tr>
      <tr><td style="padding:18px 32px 0;">
        <p style="margin:0;font-family:Courier New,monospace;font-size:12px;line-height:1.5;color:#4a5568;word-break:break-all;">${escapeHtml(url)}</p>
      </td></tr>`
    : "";

  return `<!DOCTYPE html>
<html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>GotYeah Notes</title></head>
<body style="margin:0;padding:0;background:#f4f6f8;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#f4f6f8;">
<tr><td align="center" style="padding:32px 16px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:460px;background:#ffffff;border:1px solid #e2e8f0;border-radius:12px;">
  <tr><td style="padding:30px 32px 0;">
    <div style="font-family:Segoe UI,Arial,sans-serif;font-size:13px;font-weight:700;letter-spacing:3px;color:#2f6feb;text-transform:uppercase;">GotYeah Notes</div>
  </td></tr>
  <tr><td style="padding:18px 32px 0;">
    <h1 style="margin:0 0 10px;font-family:Segoe UI,Arial,sans-serif;font-size:19px;font-weight:600;color:#1a202c;">${heading}</h1>
    ${body}
  </td></tr>
  ${button}
  <tr><td style="padding:24px 32px 30px;">
    <p style="margin:0;font-family:Segoe UI,Arial,sans-serif;font-size:12px;color:#718096;">Si tu ne t'attendais pas à ce message, ignore-le : aucun accès n'est ouvert tant que tu ne t'es pas connecté.</p>
  </td></tr>
</table>
</td></tr></table>
</body></html>`;
}

const paragraph = (text: string) =>
  `<p style="margin:0 0 10px;font-family:Segoe UI,Arial,sans-serif;font-size:14px;line-height:1.6;color:#4a5568;">${text}</p>`;

/** Email à une adresse SANS compte : la connexion créera le compte et l'accès. */
export function invitationEmail(ctx: EmailContext): Omit<OutgoingEmail, "to"> {
  const who = escapeHtml(ctx.inviterName);
  const where = escapeHtml(ctx.workspaceName);
  const what = roleLabel(ctx.role);

  return {
    subject: `${ctx.inviterName} t'invite sur l'espace « ${ctx.workspaceName} »`,
    html: layout(
      "Tu es invité",
      paragraph(`<strong>${who}</strong> t'a invité à rejoindre l'espace <strong>${where}</strong> sur GotYeah Notes, avec le rôle <strong>${what}</strong>.`) +
        paragraph(
          "Connecte-toi avec ton compte GotYeah : ton accès sera créé automatiquement, il n'y a rien à accepter."
        ),
      ctx.url
    ),
    text: `${ctx.inviterName} t'a invité à rejoindre l'espace « ${ctx.workspaceName} » sur GotYeah Notes, avec le rôle ${what}.

Connecte-toi avec ton compte GotYeah : ton accès sera créé automatiquement, il n'y a rien à accepter.
${ctx.url || ""}

Si tu ne t'attendais pas à ce message, ignore-le : aucun accès n'est ouvert tant que tu ne t'es pas connecté.`,
  };
}

/** Email à une adresse qui A DÉJÀ un compte : l'accès est immédiat, on prévient. */
export function addedToWorkspaceEmail(ctx: EmailContext): Omit<OutgoingEmail, "to"> {
  const who = escapeHtml(ctx.inviterName);
  const where = escapeHtml(ctx.workspaceName);
  const what = roleLabel(ctx.role);

  return {
    subject: `Tu as rejoint l'espace « ${ctx.workspaceName} »`,
    html: layout(
      "Nouvel espace",
      paragraph(`<strong>${who}</strong> t'a ajouté à l'espace <strong>${where}</strong>, avec le rôle <strong>${what}</strong>.`) +
        paragraph("Il apparaît dès maintenant dans ton sélecteur d'espaces."),
      ctx.url
    ),
    text: `${ctx.inviterName} t'a ajouté à l'espace « ${ctx.workspaceName} », avec le rôle ${what}.

Il apparaît dès maintenant dans ton sélecteur d'espaces.
${ctx.url || ""}`,
  };
}

/**
 * Notifie une adresse d'une invitation ou d'un ajout. Ne lève jamais (sendEmail
 * avale déjà tout) : l'appelant a déjà écrit en base quand on arrive ici.
 */
export async function notifyInvitation(
  to: string,
  kind: "invited" | "member",
  ctx: Omit<EmailContext, "url">
): Promise<MailResult> {
  const full = { ...ctx, url: appBaseUrl() };
  const content = kind === "invited" ? invitationEmail(full) : addedToWorkspaceEmail(full);
  return sendEmail({ to, ...content });
}
