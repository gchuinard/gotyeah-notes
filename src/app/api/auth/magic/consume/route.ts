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
  const result = await consumeMagicLink(token);
  // ⚠️ Le jeton n'apparaît dans AUCUN journal : il est encore valable au moment
  // où l'on écrirait la ligne.
  if (!result.ok) return back(result.reason);

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
