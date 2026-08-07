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

/**
 * Console de compte de l'IdP — l'écran où une personne gère SES moyens de
 * connexion : mot de passe, clés d'accès (passkeys), MFA.
 *
 * ⚠️ POURQUOI UN LIEN, ET PAS UN ÉCRAN DANS NOTES. Une clé d'accès naît d'une
 * cérémonie `navigator.credentials.create()` exécutée par le NAVIGATEUR, et le
 * credential produit est lié au domaine appelant. Une cérémonie lancée depuis
 * notes fabriquerait une clé pour le domaine de NOTES — que Keycloak ne verrait
 * jamais, et que notes ne saurait pas vérifier (il n'a ni challenge, ni stockage
 * de credential, ni vérification d'assertion : son auth s'arrête à un id_token).
 * L'API admin de Keycloak ne sait pas davantage injecter un credential WebAuthn.
 * Le lien externe n'est donc pas un pis-aller, c'est le seul chemin possible.
 *
 * ⚠️ NE JAMAIS construire cette URL depuis `lib/keycloak.ts > endpoints()` : cette
 * fonction substitue `KEYCLOAK_INTERNAL_URL` (`http://login-keycloak:8080`) à
 * l'origine publique. Le lien mènerait à une page qui ne charge pas, avec un
 * diagnostic trompeur — pas une erreur d'authentification, un timeout DNS.
 *
 * Chaîne vide = OIDC non configuré : on n'affiche rien plutôt qu'un lien mort.
 */
export function accountConsoleUrl(): string {
  return oidcEnabled() ? `${ISSUER}/account` : "";
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
