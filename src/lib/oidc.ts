import { createRemoteJWKSet, jwtVerify, type JWTPayload } from "jose";

// Connexion OIDC (bouton « Se connecter avec GotYeah ») à CÔTÉ du login email/mot de
// passe. Flux Authorization Code + PKCE piloté par le backend ; le callback crée la
// session applicative habituelle (cookie httpOnly), aucun token côté client.
const ISSUER = (process.env.OIDC_ISSUER || "").replace(/\/$/, "");
const CLIENT_ID = process.env.OIDC_CLIENT_ID || "";
const CLIENT_SECRET = process.env.OIDC_CLIENT_SECRET || "";
const REDIRECT_URI = process.env.OIDC_REDIRECT_URI || "";

export const OIDC_ALLOW_SIGNUP =
  (process.env.OIDC_ALLOW_SIGNUP || "true").toLowerCase() === "true";
export const OIDC_BUTTON_LABEL =
  process.env.OIDC_BUTTON_LABEL || "Se connecter avec GotYeah";
export const OIDC_TX_COOKIE = "oidc_tx";
export const OIDC_TX_PATH = "/api/auth/oidc";
export const OIDC_SCOPES = "openid email profile";

export const oidcConfig = { CLIENT_ID, CLIENT_SECRET, REDIRECT_URI };

export function oidcEnabled(): boolean {
  return !!(ISSUER && CLIENT_ID && CLIENT_SECRET && REDIRECT_URI);
}

/** Origine publique de l'app, dérivée du redirect_uri → base fiable pour les redirections
 *  (derrière NPM/Cloudflare, l'origine de la requête interne n'est pas publique). */
export function appOrigin(): string {
  try {
    return new URL(REDIRECT_URI).origin;
  } catch {
    return "";
  }
}

type Discovery = {
  authorization_endpoint: string;
  token_endpoint: string;
  jwks_uri: string;
  issuer: string;
};

let discoveryCache: Discovery | null = null;
export async function getDiscovery(): Promise<Discovery> {
  if (!discoveryCache) {
    const res = await fetch(`${ISSUER}/.well-known/openid-configuration`, {
      cache: "no-store",
    });
    if (!res.ok) throw new Error(`OIDC discovery failed: ${res.status}`);
    discoveryCache = (await res.json()) as Discovery;
  }
  return discoveryCache;
}

let jwks: ReturnType<typeof createRemoteJWKSet> | null = null;
async function getJwks() {
  if (!jwks) {
    const disc = await getDiscovery();
    jwks = createRemoteJWKSet(new URL(disc.jwks_uri));
  }
  return jwks;
}

/** Valide l'id_token (signature via JWKS, iss/aud/exp) puis le nonce. */
export async function verifyIdToken(
  idToken: string,
  expectedNonce: string,
): Promise<JWTPayload> {
  const disc = await getDiscovery();
  const keys = await getJwks();
  const { payload } = await jwtVerify(idToken, keys, {
    issuer: disc.issuer,
    audience: CLIENT_ID,
  });
  if (payload.nonce !== expectedNonce) throw new Error("nonce mismatch");
  return payload;
}
