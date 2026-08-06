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
/**
 * Libelle du bouton OIDC. Defaut generique et NON une marque : « GotYeah » ne
 * dit rien a un invite exterieur, alors que « authentification unique » est le
 * terme d'usage. Surchargeable par OIDC_BUTTON_LABEL pour une instance qui a,
 * elle, un IdP reconnaissable de ses utilisateurs.
 */
export const OIDC_BUTTON_LABEL =
  process.env.OIDC_BUTTON_LABEL || "Authentification unique (SSO)";
export const OIDC_TX_COOKIE = "oidc_tx";
export const OIDC_TX_PATH = "/api/auth/oidc";
export const OIDC_SCOPES = "openid email profile";

export const oidcConfig = { CLIENT_ID, CLIENT_SECRET, REDIRECT_URI };

export function oidcEnabled(): boolean {
  return !!(ISSUER && CLIENT_ID && CLIENT_SECRET && REDIRECT_URI);
}

/** Login par mot de passe (formulaire email). Désactivable via LEGACY_LOGIN=off quand
 *  l'app passe en « comptes GotYeah uniquement ». Réactivable (break-glass). */
export function legacyLoginEnabled(): boolean {
  return (process.env.LEGACY_LOGIN || "on").trim().toLowerCase() !== "off";
}

/** Inscription par formulaire (POST /api/auth/register). DÉFAUT OFF, découplé du login
 *  legacy et du provisioning OIDC (OIDC_ALLOW_SIGNUP) : une instance exposée ne rouvre
 *  pas l'inscription juste parce que le break-glass mot de passe est actif. */
export function registrationEnabled(): boolean {
  return (process.env.REGISTRATION || "off").trim().toLowerCase() === "on";
}

/** Normalisation canonique d'un email : trim + minuscules. Appliquée à l'écriture ET à
 *  la lecture (register/login/OIDC/pont MCP) pour éviter des comptes doublons de casse. */
export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

/**
 * Plan de la migration one-shot de normalisation des emails existants. Pur → testable.
 * Signale les COLLISIONS de casse (2 comptes → même email normalisé) SANS les fusionner :
 * elles doivent être tranchées à la main avant d'appliquer (sinon violation du @unique).
 */
export function planEmailNormalization(
  users: { id: string; email: string }[]
): { updates: { id: string; email: string }[]; collisions: string[] } {
  const byNorm = new Map<string, { id: string; email: string }[]>();
  for (const u of users) {
    const n = normalizeEmail(u.email);
    const bucket = byNorm.get(n);
    if (bucket) bucket.push(u);
    else byNorm.set(n, [u]);
  }
  const updates: { id: string; email: string }[] = [];
  const collisions: string[] = [];
  for (const [n, us] of byNorm) {
    if (us.length > 1) collisions.push(n);
    else if (us[0].email !== n) updates.push({ id: us[0].id, email: n });
  }
  return { updates, collisions };
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
