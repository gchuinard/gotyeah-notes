import { appOrigin } from "./oidc";

/**
 * Transport d'email — API HTTP Brevo (même contrat que gotyeah-sonar : POST
 * /v3/smtp/email, en-tête `api-key`). PAS de SMTP, PAS de SDK : rien à installer,
 * `fetch` global suffit. Ajouter nodemailer ou @getbrevo/brevo serait une
 * dépendance sans raison forte.
 *
 * ⚠️ Module de TRANSPORT PUR : aucune notion d'invitation, d'espace ou de rôle.
 * Le contenu vit dans lib/invitationEmail.ts. Cette frontière rend les libellés
 * testables sans réseau, et le transport mockable d'une seule ligne — le patron
 * `vi.mock("@/lib/...")` est le seul en usage dans tests/api.
 *
 * ⚠️ `sendEmail` NE LÈVE JAMAIS : union non-levante, comme setPageSection ou
 * updateMemberRole. Elle est appelée depuis un handler qui doit rendre 201, pas
 * 500 — l'invitation est déjà écrite en base quand on arrive ici.
 */

const endpoint = "https://api.brevo.com/v3/smtp/email";

/**
 * Court, et volontairement : l'envoi est attendu DANS la requête de l'admin qui
 * vient d'inviter (pas de fire-and-forget — la promesse n'est pas garantie de
 * survivre à la réponse, et on ne saurait plus quoi rapporter). Sans plafond, un
 * Brevo qui pend fait pendre son écran.
 */
const TIMEOUT_MS = 8_000;

const env = (name: string, fallback = "") => (process.env[name] || fallback).trim();

/**
 * Absente = envoi désactivé, et c'est un mode légitime (dev, self-host sans
 * compte Brevo), pas une panne. Même patron que MCP_SHARED_SECRET : vide = la
 * fonctionnalité n'existe pas, aucune surface ajoutée.
 */
export function mailerEnabled(): boolean {
  return env("BREVO_API_KEY") !== "";
}

/**
 * Origine publique de l'app pour les liens des emails. `APP_BASE_URL` d'abord,
 * sinon l'origine dérivée du redirect_uri OIDC — déjà fiable derrière
 * NPM/Cloudflare, là où l'origine de la requête interne ne l'est pas.
 *
 * ⚠️ Ne JAMAIS construire ce lien depuis l'en-tête `Host`/`Origin` d'une requête :
 * il est contrôlé par l'appelant, et un email GotYeah pointant vers le domaine
 * d'un tiers est exactement la forme d'un hameçonnage réussi.
 *
 * Chaîne vide = on ne sait pas construire de lien : l'email part sans bouton,
 * plutôt que de pointer vers `undefined/`.
 */
export function appBaseUrl(): string {
  return env("APP_BASE_URL").replace(/\/$/, "") || appOrigin();
}

export type OutgoingEmail = {
  to: string;
  subject: string;
  html: string;
  text: string;
};

export type MailResult =
  | { ok: true }
  // `throttled` n'est PAS produit par sendEmail : c'est l'appelant qui l'émet
  // quand il décide de ne pas envoyer (plafond par destinataire). Il vit ici
  // pour que le type reste la liste exhaustive de ce qui peut arriver à un envoi.
  | { ok: false; reason: "disabled" | "http" | "network" | "throttled"; status?: number };

/**
 * Envoie un email. Ne lève jamais.
 *
 * ⚠️ Ne journalise AUCUNE adresse : sur le chemin invitation, l'adresse est
 * celle de quelqu'un qui n'a rien accepté et n'est pas encore partie prenante de
 * l'espace. C'est déjà la convention du projet — `[member-invited]` trace
 * l'acteur et l'espace, jamais l'invité. Pour corréler un échec, l'appelant a
 * son actor/workspace et la ligne d'invitation est en base.
 */
export async function sendEmail(mail: OutgoingEmail): Promise<MailResult> {
  const apiKey = env("BREVO_API_KEY");
  if (!apiKey) return { ok: false, reason: "disabled" };

  try {
    const res = await fetch(endpoint, {
      method: "POST",
      headers: {
        "api-key": apiKey,
        "content-type": "application/json",
        accept: "application/json",
      },
      body: JSON.stringify({
        sender: {
          email: env("MAIL_FROM", "notes@localhost"),
          name: env("MAIL_FROM_NAME", "GotYeah Notes"),
        },
        to: [{ email: mail.to }],
        subject: mail.subject,
        htmlContent: mail.html,
        textContent: mail.text,
      }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
      cache: "no-store",
    });
    if (!res.ok) {
      // Le corps d'erreur Brevo répète le destinataire : on ne garde que le code.
      console.error(`[mail-failed] status=${res.status}`);
      return { ok: false, reason: "http", status: res.status };
    }
    return { ok: true };
  } catch (err) {
    console.error(`[mail-failed] err=${err instanceof Error ? err.name : "unknown"}`);
    return { ok: false, reason: "network" };
  }
}
