/**
 * Provisioning d'identité côté IdP — création du compte Keycloak d'un invité.
 *
 * POURQUOI CE MODULE EXISTE. Le realm `gotyeah` a l'auto-inscription FERMÉE (et
 * doit le rester : il est partagé par tous les sites de l'écosystème, l'ouvrir
 * donnerait une identité valide à n'importe qui). Conséquence : un invité
 * externe recevait un email « connecte-toi » alors qu'il ne POUVAIT pas — porte
 * peinte sur un mur. Ce module crée le compte à sa place, sans ouvrir le realm.
 *
 * ⚠️ SURFACE SENSIBLE, ET DÉLIBÉRÉMENT ÉTROITE. Notes obtient ici le droit de
 * créer des identités dans un IdP partagé : un compromis de notes deviendrait un
 * compromis de l'écosystème. D'où les limites, qui sont le cœur du design et pas
 * des détails :
 *   - Le client Keycloak n'a QUE `manage-users` (jamais `realm-admin`), et aucun
 *     flux de connexion — il ne peut pas ouvrir de session ni lire les autres
 *     clients.
 *   - Ce module n'expose AUCUNE fonction générique : `ensureInvitedUser` est le
 *     seul point d'entrée, appelé depuis la seule route d'invitation, elle-même
 *     gatée admin et plafonnée par INVITE_BUDGET.
 *   - Le compte est créé `emailVerified: FALSE`, et c'est load-bearing : la
 *     preuve de possession vient du clic sur le lien que Keycloak envoie À CETTE
 *     ADRESSE. Le poser à `true` ferait qu'un admin se trompant d'adresse
 *     fabriquerait un compte « vérifié » pour une boîte qu'il ne contrôle pas —
 *     et notes fait justement reposer son claim d'invitation sur email_verified.
 *   - Aucun mot de passe n'est posé : le compte est INUTILISABLE tant que la
 *     personne n'a pas suivi le lien reçu.
 *
 * Désactivé tant que les deux variables sont vides (même patron que
 * MCP_SHARED_SECRET et BREVO_API_KEY) : sans configuration, aucune surface.
 */

const env = (name: string) => (process.env[name] || "").trim();

/** Actions imposées au premier accès. VERIFY_EMAIL est ce qui prouve l'adresse. */
const REQUIRED_ACTIONS = ["UPDATE_PASSWORD", "VERIFY_EMAIL"];

/** Le lien d'activation doit survivre à un week-end, pas à un trimestre. */
const ACTION_TOKEN_LIFESPAN_S = 3 * 24 * 60 * 60;

const TIMEOUT_MS = 8_000;

export function keycloakAdminEnabled(): boolean {
  return (
    env("KEYCLOAK_ADMIN_CLIENT_ID") !== "" &&
    env("KEYCLOAK_ADMIN_CLIENT_SECRET") !== "" &&
    env("OIDC_ISSUER") !== ""
  );
}

/**
 * L'issuer vaut `https://host/realms/<realm>` ; l'API admin vit à côté, sur
 * `https://host/admin/realms/<realm>`.
 *
 * ⚠️ Mais `/admin/*` est très souvent FERMÉ côté public — sur cette instance,
 * Cloudflare Access le protège et répond 302 vers un écran de connexion, ce qui
 * donnerait un provisioning cassé au diagnostic trompeur (ni 401 ni 403 : une
 * redirection). `KEYCLOAK_INTERNAL_URL` permet donc de joindre Keycloak par le
 * réseau interne (`http://login-keycloak:8080`), sans traverser le proxy.
 *
 * ⚠️ Seule la BASE est surchargeable : le realm reste dérivé de `OIDC_ISSUER`.
 * Deux réglages pour un même realm finiraient par diverger, et provisionner dans
 * un realm différent de celui qui authentifie ne se verrait qu'au moment où
 * l'invité, compte créé, ne pourrait pas se connecter.
 */
function endpoints(): { token: string; admin: string } | null {
  const issuer = env("OIDC_ISSUER").replace(/\/$/, "");
  const m = /^(https?:\/\/[^/]+(?:\/[^/]+)*?)\/realms\/([^/]+)$/.exec(issuer);
  if (!m) return null;
  const [, publicBase, realm] = m;
  const base = env("KEYCLOAK_INTERNAL_URL").replace(/\/$/, "") || publicBase;
  return {
    token: `${base}/realms/${realm}/protocol/openid-connect/token`,
    admin: `${base}/admin/realms/${realm}`,
  };
}

export type ProvisionResult =
  | { status: "created" }
  | { status: "existing" }
  | { status: "disabled" }
  | { status: "failed"; reason: string };

/**
 * Jeton d'administration (client_credentials). Mis en cache le temps de sa
 * validité, avec une marge : un aller-retour de plus par invitation serait
 * gratuit en correction mais coûteux en latence sur un Pi.
 */
let cachedToken: { value: string; expiresAt: number } | null = null;

async function adminToken(): Promise<string | null> {
  const now = Date.now();
  if (cachedToken && cachedToken.expiresAt > now) return cachedToken.value;

  const eps = endpoints();
  if (!eps) return null;
  try {
    const res = await fetch(eps.token, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "client_credentials",
        client_id: env("KEYCLOAK_ADMIN_CLIENT_ID"),
        client_secret: env("KEYCLOAK_ADMIN_CLIENT_SECRET"),
      }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
      cache: "no-store",
    });
    if (!res.ok) {
      console.error(`[idp-token-failed] status=${res.status}`);
      return null;
    }
    const body = (await res.json()) as { access_token?: string; expires_in?: number };
    if (!body.access_token) return null;
    // 30 s de marge : un jeton qui expire pendant l'appel suivant coûterait un
    // 401 opaque au lieu d'un simple renouvellement.
    cachedToken = {
      value: body.access_token,
      expiresAt: now + Math.max(0, (body.expires_in ?? 60) - 30) * 1000,
    };
    return cachedToken.value;
  } catch (err) {
    console.error(`[idp-token-failed] err=${err instanceof Error ? err.name : "unknown"}`);
    return null;
  }
}

/** Réinitialise le cache de jeton — réservé aux tests. */
export function _resetKeycloakToken(): void {
  cachedToken = null;
}

/**
 * S'assure qu'un compte existe dans l'IdP pour cette adresse, et lui envoie le
 * lien qui lui permettra de définir son mot de passe.
 *
 * NE LÈVE JAMAIS : l'invitation est déjà écrite en base quand on arrive ici, et
 * un IdP injoignable ne doit pas faire échouer un ajout de membre. L'appelant
 * remonte le résultat pour que l'admin sache s'il doit créer le compte à la main.
 *
 * `existing` n'est PAS un échec : c'est le cas le plus fréquent (quelqu'un qui a
 * déjà un compte sur un autre site de l'écosystème). On ne lui renvoie alors
 * AUCUN email d'activation — son mot de passe existe déjà, et lui en proposer un
 * nouveau ressemblerait à une tentative de prise de contrôle.
 */
export async function ensureInvitedUser(
  email: string,
  displayName: string
): Promise<ProvisionResult> {
  if (!keycloakAdminEnabled()) return { status: "disabled" };
  const eps = endpoints();
  if (!eps) return { status: "failed", reason: "issuer_malformed" };

  const token = await adminToken();
  if (!token) return { status: "failed", reason: "token" };
  const auth = { authorization: `Bearer ${token}`, "content-type": "application/json" };

  try {
    // 1. Déjà connu de l'IdP ? `exact=true` sinon Keycloak fait une recherche
    //    par préfixe et « a@b.tld » matcherait « a@b.tld.evil ».
    const lookup = await fetch(
      `${eps.admin}/users?email=${encodeURIComponent(email)}&exact=true`,
      { headers: auth, signal: AbortSignal.timeout(TIMEOUT_MS), cache: "no-store" }
    );
    if (!lookup.ok) return { status: "failed", reason: `lookup_${lookup.status}` };
    const found = (await lookup.json()) as unknown[];
    if (Array.isArray(found) && found.length > 0) return { status: "existing" };

    // 2. Création. Pas de mot de passe, email NON vérifié : le compte ne sert à
    //    rien tant que la personne n'a pas suivi le lien envoyé à son adresse.
    const create = await fetch(`${eps.admin}/users`, {
      method: "POST",
      headers: auth,
      body: JSON.stringify({
        username: email,
        email,
        firstName: displayName,
        enabled: true,
        emailVerified: false,
        requiredActions: REQUIRED_ACTIONS,
      }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
      cache: "no-store",
    });
    // 409 = créé entre-temps (deux invitations concurrentes). Ce n'est pas une
    // erreur : l'état visé est atteint.
    if (create.status === 409) return { status: "existing" };
    if (!create.ok) return { status: "failed", reason: `create_${create.status}` };

    // 3. Retrouver l'id pour déclencher l'email : Keycloak le renvoie dans
    //    Location, mais l'en-tête peut être filtré par un proxy — on relit.
    const again = await fetch(
      `${eps.admin}/users?email=${encodeURIComponent(email)}&exact=true`,
      { headers: auth, signal: AbortSignal.timeout(TIMEOUT_MS), cache: "no-store" }
    );
    if (!again.ok) return { status: "failed", reason: `relookup_${again.status}` };
    const rows = (await again.json()) as { id?: string }[];
    const id = Array.isArray(rows) && rows[0]?.id;
    if (!id) return { status: "failed", reason: "no_id" };

    // 4. Email d'activation, émis par KEYCLOAK (pas par nous) : le jeton du lien
    //    est le sien, à durée limitée, et n'a jamais transité par notre code.
    const mail = await fetch(
      `${eps.admin}/users/${encodeURIComponent(id)}/execute-actions-email?lifespan=${ACTION_TOKEN_LIFESPAN_S}`,
      {
        method: "PUT",
        headers: auth,
        body: JSON.stringify(REQUIRED_ACTIONS),
        signal: AbortSignal.timeout(TIMEOUT_MS),
        cache: "no-store",
      }
    );
    // Le compte EXISTE même si l'email n'est pas parti : on le dit, plutôt que
    // de laisser croire à un échec total (l'admin n'aurait plus qu'à renvoyer le
    // lien depuis Keycloak).
    if (!mail.ok) return { status: "failed", reason: `activation_${mail.status}` };

    return { status: "created" };
  } catch (err) {
    return { status: "failed", reason: err instanceof Error ? err.name : "unknown" };
  }
}
