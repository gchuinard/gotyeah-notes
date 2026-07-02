import { randomBytes, createHash } from "crypto";
import { NextResponse } from "next/server";
import {
  oidcEnabled,
  getDiscovery,
  oidcConfig,
  appOrigin,
  OIDC_TX_COOKIE,
  OIDC_TX_PATH,
  OIDC_SCOPES,
} from "@/lib/oidc";

const b64url = (buf: Buffer) => buf.toString("base64url");

export async function GET() {
  if (!oidcEnabled()) {
    return NextResponse.redirect(`${appOrigin()}/login?sso_error=disabled`);
  }

  const disc = await getDiscovery();
  const state = b64url(randomBytes(24));
  const nonce = b64url(randomBytes(24));
  const verifier = b64url(randomBytes(32));
  const challenge = b64url(createHash("sha256").update(verifier).digest());

  const authUrl = new URL(disc.authorization_endpoint);
  authUrl.searchParams.set("response_type", "code");
  authUrl.searchParams.set("client_id", oidcConfig.CLIENT_ID);
  authUrl.searchParams.set("redirect_uri", oidcConfig.REDIRECT_URI);
  authUrl.searchParams.set("scope", OIDC_SCOPES);
  authUrl.searchParams.set("state", state);
  authUrl.searchParams.set("nonce", nonce);
  authUrl.searchParams.set("code_challenge", challenge);
  authUrl.searchParams.set("code_challenge_method", "S256");

  const res = NextResponse.redirect(authUrl.toString());
  // état (state/nonce/verifier) dans un cookie httpOnly court, à portée du callback.
  res.cookies.set(
    OIDC_TX_COOKIE,
    Buffer.from(JSON.stringify({ state, nonce, verifier })).toString("base64url"),
    {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      maxAge: 600,
      path: OIDC_TX_PATH,
    },
  );
  return res;
}
