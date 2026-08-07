import { randomBytes } from "crypto";
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/prisma";
import { createSession, SESSION_COOKIE } from "@/lib/session";
import { createWorkspaceWithDefaults } from "@/lib/workspace";
import { claimInvitationsSafely, hasPendingInvitation } from "@/lib/invitations";
import {
  oidcEnabled,
  oidcConfig,
  getDiscovery,
  verifyIdToken,
  appOrigin,
  OIDC_ALLOW_SIGNUP,
  OIDC_TX_COOKIE,
  OIDC_TX_PATH,
} from "@/lib/oidc";

const str = (v: unknown): string => (typeof v === "string" ? v : "");

export async function GET(req: NextRequest) {
  const base = appOrigin();

  const fail = (code: string) => {
    const res = NextResponse.redirect(`${base}/login?sso_error=${code}`);
    res.cookies.delete({ name: OIDC_TX_COOKIE, path: OIDC_TX_PATH });
    return res;
  };
  const finish = async (userId: string, workspaceId: string | null) => {
    const token = await createSession(userId, workspaceId);
    const res = NextResponse.redirect(`${base}/`);
    res.cookies.set(SESSION_COOKIE, token, {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      maxAge: 60 * 60 * 24 * 30,
      path: "/",
    });
    res.cookies.delete({ name: OIDC_TX_COOKIE, path: OIDC_TX_PATH });
    return res;
  };

  if (!oidcEnabled()) return fail("disabled");

  const url = new URL(req.url);
  if (url.searchParams.get("error")) return fail("provider");
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const tx = req.cookies.get(OIDC_TX_COOKIE)?.value;
  if (!code || !state || !tx) return fail("state");

  let parsed: { state: string; nonce: string; verifier: string };
  try {
    parsed = JSON.parse(Buffer.from(tx, "base64url").toString());
  } catch {
    return fail("state");
  }
  if (parsed.state !== state) return fail("state");

  // Échange du code (avec le code_verifier PKCE) contre les tokens.
  let idToken: string;
  try {
    const disc = await getDiscovery();
    const tokenRes = await fetch(disc.token_endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Accept: "application/json",
      },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code,
        redirect_uri: oidcConfig.REDIRECT_URI,
        client_id: oidcConfig.CLIENT_ID,
        client_secret: oidcConfig.CLIENT_SECRET,
        code_verifier: parsed.verifier,
      }),
      cache: "no-store",
    });
    if (!tokenRes.ok) return fail("token");
    const tokens = (await tokenRes.json()) as { id_token?: string };
    if (!tokens.id_token) return fail("token");
    idToken = tokens.id_token;
  } catch {
    return fail("token");
  }

  // Validation de l'id_token (signature/iss/aud/exp + nonce).
  let claims;
  try {
    claims = await verifyIdToken(idToken, parsed.nonce);
  } catch {
    return fail("idtoken");
  }

  const email = str(claims.email).trim().toLowerCase();
  if (!email) return fail("noemail");
  if (claims.email_verified === false) return fail("unverified");

  // Liaison par email (exact, comme le pont MCP) ou provisioning.
  const existing = await prisma.user.findUnique({
    where: { email },
    select: { id: true },
  });
  if (existing) {
    // ⚠️ AVANT le findFirst : une personne qui a quitté tous ses espaces et qu'on
    // vient de réinviter atterrirait sinon sur `null`, alors qu'une membership
    // vient d'être créée. L'email vient de l'IdP et est vérifié (cf. plus haut).
    // grant:false — compte préexistant : on propose, on n'accorde pas.
    await claimInvitationsSafely(existing.id, email, { grant: false });
    const ws = await prisma.membership.findFirst({
      where: { userId: existing.id },
      orderBy: { createdAt: "asc" },
      select: { workspaceId: true },
    });
    return finish(existing.id, ws?.workspaceId ?? null);
  }

  // ─── Pas de compte : le provisioning est-il ouvert à cette adresse ? ─────────
  // Avec OIDC_ALLOW_SIGNUP=false, une invitation vivante fait office de
  // laissez-passer. C'est ce qui cloisonne notes du reste de l'écosystème
  // Keycloak : le realm `gotyeah` est partagé par tous les sites, donc sans ce
  // filtre l'utilisateur de n'importe lequel d'entre eux se créait un compte
  // notes en cliquant « Se connecter ». L'IdP dit QUI tu es ; l'invitation dit
  // si tu es attendu ICI.
  if (!OIDC_ALLOW_SIGNUP && !(await hasPendingInvitation(email))) {
    return fail("nosignup");
  }

  const name = str(claims.name);
  const firstName = str(claims.given_name) || name.split(" ")[0] || email.split("@")[0];
  const lastName = str(claims.family_name) || name.split(" ").slice(1).join(" ") || "";
  const displayName = name || str(claims.preferred_username) || email.split("@")[0];
  // Compte issu d'un IdP de confiance : mot de passe local aléatoire inutilisable.
  const passwordHash = await bcrypt.hash(randomBytes(32).toString("base64url"), 12);

  const created = await prisma.user.create({
    data: { email, firstName, lastName, displayName, passwordHash },
    select: { id: true },
  });
  // Chacun garde son propre espace, invité ou non. En revanche on ATTERRIT sur
  // l'espace qui vient d'être réclamé : quelqu'un qui suit une invitation
  // arriverait sinon dans un « Mon espace » vide, sans rien qui lui dise que
  // l'espace où on l'attend existe — le sélecteur ne se remarque pas quand on
  // découvre l'application.
  // grant:TRUE — ce compte n'existe QUE parce qu'une invitation vivante
  // l'autorisait (OIDC_ALLOW_SIGNUP=false le refuserait sinon), et l'IdP a
  // vérifié l'adresse. Le consentement est acquis : demander en plus « acceptes-
  // tu ? » juste après serait une question dont la réponse est déjà donnée.
  const claimed = await claimInvitationsSafely(created.id, email, { grant: true });
  const workspace = await createWorkspaceWithDefaults("Mon espace", created.id);
  return finish(created.id, claimed.workspaceIds[0] ?? workspace.id);
}
