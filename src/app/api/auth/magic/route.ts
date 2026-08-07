import { NextResponse } from "next/server";
import { z } from "zod";
import { issueMagicLink, magicLinkEnabled, purgeExpiredLoginTokens } from "@/lib/magicLink";
import { sendMagicLink } from "@/lib/invitationEmail";
import { normalizeEmail } from "@/lib/oidc";
import { tooManyFailures, recordFailure, retryAfterSeconds } from "@/lib/rateLimit";

/**
 * Demande d'un lien de connexion par email.
 *
 * ⚠️ RÉPONSE UNIFORME, toujours. Adresse inconnue, invitation expirée, envoi
 * raté : la réponse est identique au succès. Distinguer les cas ferait de cette
 * route publique un oracle disant qui possède un compte ici — exactement ce que
 * le login évite déjà par son message unique et son bcrypt factice.
 *
 * Le rate-limit porte donc sur TOUTES les demandes, pas sur les échecs : ici il
 * n'y a pas d'échec observable, et c'est le volume qui est l'abus (un canal
 * d'envoi vers des adresses arbitraires depuis l'expéditeur de l'instance).
 */

const schema = z.object({ email: z.string().trim().email() });

const REPONSE = {
  ok: true,
  message:
    "Si un accès existe pour cette adresse, un lien de connexion vient d'y être envoyé.",
};

function clientIp(req: Request): string {
  const xff = req.headers.get("x-forwarded-for");
  return (xff ? xff.split(",")[0] : req.headers.get("x-real-ip") || "unknown").trim();
}

export async function POST(req: Request) {
  if (!magicLinkEnabled()) {
    return NextResponse.json({ error: "Connexion par lien désactivée." }, { status: 403 });
  }

  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  // Même une adresse malformée reçoit la réponse neutre : répondre 400 ici
  // distinguerait « mal écrite » de « inconnue », et c'est déjà trop.
  if (!parsed.success) return NextResponse.json(REPONSE);

  const email = normalizeEmail(parsed.data.email);
  const key = `magic:${clientIp(req)}|${email}`;
  if (tooManyFailures(key)) {
    return NextResponse.json(
      { error: "Trop de demandes. Réessaie plus tard." },
      { status: 429, headers: { "Retry-After": String(retryAfterSeconds(key)) } }
    );
  }
  recordFailure(key);

  // Ménage opportuniste, comme la corbeille : pas de cron en self-host.
  await purgeExpiredLoginTokens();

  const token = await issueMagicLink(email);
  if (token) await sendMagicLink(email, token);

  return NextResponse.json(REPONSE);
}
