import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { consumeMagicLink, magicLinkEnabled } from "@/lib/magicLink";
import { createSession, SESSION_COOKIE } from "@/lib/session";
import { appOrigin } from "@/lib/oidc";

/**
 * Consommation du lien reçu par email : c'est CE clic qui connecte.
 *
 * GET, parce qu'un lien dans un email est un GET — et parce qu'intercaler un
 * écran « clique ici pour confirmer » reproduirait le pas de trop qu'on cherche
 * justement à supprimer.
 *
 * ⚠️ Limite connue et assumée : certains filtres anti-hameçonnage (Defender,
 * Barracuda) suivent les liens avant l'utilisateur et consommeraient le jeton à
 * sa place — il verrait alors « lien expiré ». Le repli est déjà en place : il
 * en redemande un depuis l'écran de connexion. Si ça devient un problème réel
 * pour un destinataire donné, la parade est un écran de confirmation, pas un
 * jeton réutilisable.
 */
export async function GET(req: NextRequest) {
  const base = appOrigin() || new URL(req.url).origin;
  const back = (code: string) =>
    NextResponse.redirect(`${base}/login?magic_error=${code}`);

  if (!magicLinkEnabled()) return back("disabled");

  const token = new URL(req.url).searchParams.get("token") ?? "";
  // ⚠️ Filet ULTIME : ce handler est la première page que voit un invité. Une
  // exception non rattrapée y afficherait l'écran d'erreur de Next au lieu d'une
  // redirection — sur le tout premier contact avec l'instance. Aucun détail
  // n'est journalisé : le jeton est encore valable à cet instant.
  const result = await consumeMagicLink(token).catch((err) => {
    console.error(`[magic-consume-failed] err=${err instanceof Error ? err.name : "unknown"}`);
    return { ok: false, reason: "invalid" } as const;
  });
  // ⚠️ Le jeton n'apparaît dans AUCUN journal : il est encore valable au moment
  // où l'on écrirait la ligne.
  //
  // `needs_acceptance` n'est PAS une erreur : l'adresse est invitée mais n'a
  // aucun compte, et rien ne doit être créé avant qu'elle ait cliqué
  // « Accepter ». On l'emmène à l'écran qui le lui demande, avec le même jeton
  // — que `consumeMagicLink` a délibérément laissé vivant pour ce cas.
  if (!result.ok) {
    if (result.reason === "needs_acceptance") {
      return NextResponse.redirect(`${base}/invitation?token=${encodeURIComponent(token)}`);
    }
    return back(result.reason);
  }

  const session = await createSession(result.userId, result.workspaceId);
  const res = NextResponse.redirect(`${base}/`);
  res.cookies.set(SESSION_COOKIE, session, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: 60 * 60 * 24 * 30,
    path: "/",
  });
  return res;
}
