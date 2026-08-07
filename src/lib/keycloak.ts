/**
 * Comptes d'identité côté IdP — lecture d'état, création, suspension.
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
 *   - Le client Keycloak n'a QUE `manage-users` + `view-users` (jamais
 *     `realm-admin`), et aucun flux de connexion — il ne peut ni ouvrir de
 *     session, ni toucher aux clés de signature du realm, ni lire les autres
 *     clients.
 *   - Le compte est créé `emailVerified: FALSE`, et c'est load-bearing : la
 *     preuve de possession vient du clic sur le lien que Keycloak envoie À CETTE
 *     ADRESSE. Le poser à `true` ferait qu'un admin se trompant d'adresse
 *     fabriquerait un compte « vérifié » pour une boîte qu'il ne contrôle pas —
 *     et notes fait justement reposer son claim d'invitation sur email_verified.
 *   - Aucun mot de passe n'est posé : le compte est INUTILISABLE tant que la
 *     personne n'a pas suivi le lien reçu.
 *
 * ⚠️ AUCUNE SUPPRESSION, ET C'EST UNE DÉCISION. `DELETE /users/{id}` existe et
 * le client aurait le droit de l'appeler ; ce module ne l'expose pas. Keycloak
 * n'a pas de corbeille : la suppression détruit d'un coup les credentials, le
 * MFA, les identités fédérées et surtout le `sub` — or c'est sur ce `sub` que
 * les AUTRES sites du realm reconnaissent la personne. Recréer le compte lui en
 * donne un nouveau : notes, qui lie par email, ne verrait rien ; le voisin
 * verrait un inconnu. La base Keycloak n'est par ailleurs sauvegardée nulle part
 * dans ce projet (le snapshot pré-MEP ne couvre que la SQLite de notes). La
 * suspension (`enabled: false`) obtient le même effet — plus aucune connexion,
 * sessions coupées — en restant réversible d'un clic.
 *
 * Désactivé tant que les variables sont vides (même patron que
 * MCP_SHARED_SECRET et BREVO_API_KEY) : sans configuration, aucune surface.
 */

import { normalizeEmail } from "./oidc";

const env = (name: string) => (process.env[name] || "").trim();

/**
 * ⚠️ AUTORITÉ D'INSTANCE — la garde qui compte, et pourquoi un rôle ne suffit pas.
 *
 * Ces actions portent sur un realm PARTAGÉ par tout l'écosystème : leur rayon
 * dépasse notes. Or notes n'a pas d'admin d'instance, et son rôle « admin » est
 * AUTO-ATTRIBUABLE en trois requêtes — `POST /api/workspaces` n'a aucun gate
 * (exemption assumée : on crée SON espace et on en devient admin), puis
 * `POST /members` crée une Membership IMMÉDIATE pour toute adresse ayant déjà un
 * compte notes, sans le consentement de la personne visée. Un lecteur invité sur
 * un seul board pouvait ainsi se fabriquer l'autorité de couper la connexion
 * Keycloak de n'importe quel utilisateur, sur tous les sites.
 *
 * D'où une allowlist explicite, hors du modèle de rôles. Elle ne remplace pas le
 * gate admin de l'espace : elle s'y AJOUTE.
 *
 * ⚠️ Vide = PERSONNE, jamais « tout le monde ». Même patron que
 * MCP_SHARED_SECRET et BREVO_API_KEY — sans configuration, aucune surface. Le
 * défaut inverse (vide = permissif) est celui qui a rendu MCP_ACT_AS_ALLOWLIST
 * inerte pendant trois semaines, diff vert à l'appui.
 */
export function isIdpAdmin(email: string): boolean {
  const raw = env("IDP_ADMIN_EMAILS");
  if (!raw) return false;
  return raw
    .split(",")
    .map((e) => normalizeEmail(e))
    .filter(Boolean)
    .includes(normalizeEmail(email));
}

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

/**
 * Plafond du listing d'annuaire. Le realm est PARTAGÉ : `GET /users` renvoie
 * aussi les comptes des autres sites et les service accounts des autres clients.
 * On lit une page bornée et on croise localement par email — un lookup par
 * membre serait N allers-retours pour afficher un seul écran.
 *
 * ⚠️ Si la page est pleine, l'annuaire est INCOMPLET et doit le dire
 * (`truncated`) : afficher « pas de compte » pour quelqu'un qu'on n'a simplement
 * pas lu serait un mensonge, et l'admin cliquerait « créer » sur un compte
 * existant — donc créerait un doublon d'identité dans l'IdP de l'écosystème.
 */
const LIST_LIMIT = 500;

export type ProvisionResult =
  | { status: "created" }
  // Compte présent mais JAMAIS activé : le lien d'activation est reparti.
  | { status: "resent" }
  | { status: "existing" }
  | { status: "disabled" }
  | { status: "failed"; reason: string };

/** État d'un compte tel que l'IdP le connaît. */
export type IdpAccount = {
  enabled: boolean;
  emailVerified: boolean;
  /** Aucun mot de passe défini à ce jour — le compte ne peut pas encore servir. */
  pending: boolean;
};

export type IdpDirectory =
  | { ok: true; accounts: Map<string, IdpAccount>; truncated: boolean }
  | { ok: false; reason: string };

export type EnableResult =
  | { status: "suspended" }
  | { status: "resumed" }
  /** Aucun compte IdP pour cette adresse : il n'y a rien à suspendre. */
  | { status: "absent" }
  | { status: "disabled" }
  | { status: "failed"; reason: string };

/** Ce que l'API admin renvoie d'un utilisateur — champs qu'on lit, rien de plus. */
type KcUser = {
  id?: string;
  email?: string;
  enabled?: boolean;
  emailVerified?: boolean;
  requiredActions?: string[];
};

/**
 * « Jamais activé » se lit sur `requiredActions`, pas sur `emailVerified`.
 * Keycloak retire UPDATE_PASSWORD de la liste dès que la personne a défini son
 * mot de passe : sa présence prouve qu'elle ne l'a jamais fait. `emailVerified`
 * seul ne suffirait pas — un compte peut être utilisable avec une adresse non
 * vérifiée, et on relancerait alors une activation à quelqu'un qui n'en a pas
 * besoin, ce qui ressemble à une prise de contrôle.
 */
const isPending = (u: KcUser): boolean =>
  Array.isArray(u.requiredActions) && u.requiredActions.includes("UPDATE_PASSWORD");

const toAccount = (u: KcUser): IdpAccount => ({
  enabled: u.enabled !== false,
  emailVerified: u.emailVerified === true,
  pending: isPending(u),
});

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

type AdminContext = {
  admin: string;
  auth: { authorization: string; "content-type": string };
};

/** Configuration + jeton, ou la raison de ne rien pouvoir faire. Ne lève pas. */
async function adminContext(): Promise<
  { ok: true; ctx: AdminContext } | { ok: false; reason: "disabled" | "issuer_malformed" | "token" }
> {
  if (!keycloakAdminEnabled()) return { ok: false, reason: "disabled" };
  const eps = endpoints();
  if (!eps) return { ok: false, reason: "issuer_malformed" };
  const token = await adminToken();
  if (!token) return { ok: false, reason: "token" };
  return {
    ok: true,
    ctx: {
      admin: eps.admin,
      auth: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    },
  };
}

async function call(url: string, ctx: AdminContext, init: RequestInit = {}) {
  const res = await fetch(url, {
    ...init,
    headers: ctx.auth,
    signal: AbortSignal.timeout(TIMEOUT_MS),
    cache: "no-store",
  });
  // ⚠️ Un 401 signifie que le jeton en cache ne vaut plus rien (révocation du
  // client, redémarrage du realm, horloges désynchronisées). Sans cette purge,
  // `adminToken()` continuerait de le servir jusqu'à son expiration nominale et
  // TOUTE la fonctionnalité resterait cassée jusque-là, sans raison lisible.
  if (res.status === 401) cachedToken = null;
  return res;
}

/**
 * Recherche par adresse. `exact=true` est load-bearing : sans lui Keycloak
 * cherche par PRÉFIXE et « a@b.tld » matcherait « a@b.tld.evil ».
 * `briefRepresentation=false` pour obtenir `requiredActions`, sur quoi repose
 * la distinction « compte activé » / « compte en attente ».
 */
async function findByEmail(
  ctx: AdminContext,
  email: string
): Promise<{ ok: true; user: KcUser | null } | { ok: false; status: number }> {
  const res = await call(
    `${ctx.admin}/users?email=${encodeURIComponent(email)}&exact=true&briefRepresentation=false`,
    ctx
  );
  if (!res.ok) return { ok: false, status: res.status };
  const rows = (await res.json()) as KcUser[];
  return { ok: true, user: Array.isArray(rows) && rows.length > 0 ? rows[0] : null };
}

/** Déclenche l'email d'activation. Le jeton du lien est celui de KEYCLOAK. */
async function sendActivation(ctx: AdminContext, id: string): Promise<number | null> {
  const res = await call(
    `${ctx.admin}/users/${encodeURIComponent(id)}/execute-actions-email?lifespan=${ACTION_TOKEN_LIFESPAN_S}`,
    ctx,
    { method: "PUT", body: JSON.stringify(REQUIRED_ACTIONS) }
  );
  return res.ok ? null : res.status;
}

/**
 * S'assure qu'un compte existe dans l'IdP pour cette adresse, et lui envoie le
 * lien qui lui permettra de définir son mot de passe.
 *
 * NE LÈVE JAMAIS : un IdP injoignable ne doit pas faire échouer l'action côté
 * notes. L'appelant remonte le résultat pour que l'admin sache où il en est.
 *
 * `existing` n'est PAS un échec : c'est le cas le plus fréquent (quelqu'un qui a
 * déjà un compte sur un autre site de l'écosystème). On ne lui renvoie alors
 * AUCUN email d'activation — son mot de passe existe déjà, et lui en proposer un
 * nouveau ressemblerait à une tentative de prise de contrôle.
 *
 * ⚠️ `resent` existe pour sortir d'un CUL-DE-SAC. Si la création réussit mais que
 * l'email d'activation échoue, le compte reste — sans mot de passe. Un second
 * appel le retrouvait alors comme « existing » et sortait avant l'envoi : plus
 * jamais aucun lien ne partait par ce chemin, précisément au moment où l'admin
 * essayait de réparer. Un compte qui porte encore UPDATE_PASSWORD n'a jamais
 * servi : lui relancer son activation ne prend rien à personne.
 */
export async function provisionIdpAccount(input: {
  email: string;
  firstName: string;
  lastName: string;
}): Promise<ProvisionResult> {
  const c = await adminContext();
  if (!c.ok) {
    return c.reason === "disabled" ? { status: "disabled" } : { status: "failed", reason: c.reason };
  }
  const { ctx } = c;
  const { email } = input;

  try {
    const found = await findByEmail(ctx, email);
    if (!found.ok) return { status: "failed", reason: `lookup_${found.status}` };

    if (found.user) {
      if (!isPending(found.user) || !found.user.id) return { status: "existing" };
      const failed = await sendActivation(ctx, found.user.id);
      return failed
        ? { status: "failed", reason: `activation_${failed}` }
        : { status: "resent" };
    }

    // Création. Pas de mot de passe, email NON vérifié : le compte ne sert à
    // rien tant que la personne n'a pas suivi le lien envoyé à son adresse.
    const create = await call(`${ctx.admin}/users`, ctx, {
      method: "POST",
      body: JSON.stringify({
        username: email,
        email,
        firstName: input.firstName,
        lastName: input.lastName,
        enabled: true,
        emailVerified: false,
        requiredActions: REQUIRED_ACTIONS,
      }),
    });
    // 409 = créé entre-temps (deux appels concurrents). Ce n'est pas une erreur :
    // l'état visé est atteint.
    if (create.status === 409) return { status: "existing" };
    if (!create.ok) return { status: "failed", reason: `create_${create.status}` };

    // Retrouver l'id pour déclencher l'email : Keycloak le renvoie dans
    // Location, mais l'en-tête peut être filtré par un proxy — on relit.
    const again = await findByEmail(ctx, email);
    if (!again.ok) return { status: "failed", reason: `relookup_${again.status}` };
    if (!again.user?.id) return { status: "failed", reason: "no_id" };

    const failed = await sendActivation(ctx, again.user.id);
    // Le compte EXISTE même si l'email n'est pas parti : on le dit, plutôt que
    // de laisser croire à un échec total. Un nouvel appel repartira sur la
    // branche `resent`.
    if (failed) return { status: "failed", reason: `activation_${failed}` };

    return { status: "created" };
  } catch (err) {
    return { status: "failed", reason: err instanceof Error ? err.name : "unknown" };
  }
}

/**
 * Compatibilité : le parcours d'invitation historique ne connaît qu'un
 * `displayName`. Conservé pour ne pas figer l'appelant sur la forme éclatée.
 */
export async function ensureInvitedUser(
  email: string,
  displayName: string
): Promise<ProvisionResult> {
  return provisionIdpAccount({ email, firstName: displayName, lastName: "" });
}

/**
 * Annuaire des comptes du realm, indexé par email normalisé.
 *
 * ⚠️ UNE seule requête, et un croisement local : le besoin est d'afficher l'état
 * de N membres, et Keycloak n'a pas de lookup par lot. N allers-retours de 8 s de
 * timeout chacun, sur un Pi, feraient dépendre l'écran de la santé de l'IdP.
 *
 * ⚠️ Ce listing renvoie TOUT le realm — les comptes des autres sites, et les
 * service accounts des autres clients. Il ne sert qu'à répondre « cette adresse
 * a-t-elle un compte ? », jamais à énumérer quoi que ce soit vers le client.
 */
export async function listIdpAccounts(): Promise<IdpDirectory> {
  const c = await adminContext();
  if (!c.ok) return { ok: false, reason: c.reason };

  try {
    const res = await call(
      `${c.ctx.admin}/users?max=${LIST_LIMIT}&briefRepresentation=false`,
      c.ctx
    );
    if (!res.ok) return { ok: false, reason: `list_${res.status}` };
    const rows = (await res.json()) as KcUser[];
    if (!Array.isArray(rows)) return { ok: false, reason: "malformed" };

    // `normalizeEmail` et pas un trim/lowercase à la main : les deux côtés du
    // croisement doivent normaliser IDENTIQUEMENT, sinon un compte existant
    // passe pour absent et l'écran propose d'en créer un second.
    const accounts = new Map<string, IdpAccount>();
    for (const u of rows) {
      if (u.email) accounts.set(normalizeEmail(u.email), toAccount(u));
    }
    return { ok: true, accounts, truncated: rows.length >= LIST_LIMIT };
  } catch (err) {
    return { ok: false, reason: err instanceof Error ? err.name : "unknown" };
  }
}

/**
 * Suspend ou réactive un compte. `enabled: false` empêche toute connexion et
 * invalide les sessions en cours — sans détruire le `sub`, le MFA ni les liens
 * fédérés dont dépendent les autres sites du realm. C'est la raison pour
 * laquelle ce module n'expose pas de suppression : même effet, réversible.
 *
 * ⚠️ `absent` n'est pas une erreur : suspendre un accès SSO qui n'existe pas est
 * un non-événement, et le dire vaut mieux qu'un échec qui ferait chercher une
 * panne. Aucun compte n'est créé au passage — suspendre ne provisionne pas.
 */
export async function setIdpAccountEnabled(
  email: string,
  enabled: boolean
): Promise<EnableResult> {
  const c = await adminContext();
  if (!c.ok) {
    return c.reason === "disabled" ? { status: "disabled" } : { status: "failed", reason: c.reason };
  }
  const { ctx } = c;

  try {
    const found = await findByEmail(ctx, email);
    if (!found.ok) return { status: "failed", reason: `lookup_${found.status}` };
    if (!found.user?.id) return { status: "absent" };

    const res = await call(`${ctx.admin}/users/${encodeURIComponent(found.user.id)}`, ctx, {
      method: "PUT",
      body: JSON.stringify({ enabled }),
    });
    if (!res.ok) return { status: "failed", reason: `update_${res.status}` };

    // Keycloak refuse les NOUVELLES connexions dès `enabled: false`, mais les
    // sessions déjà ouvertes survivraient jusqu'à leur expiration : suspendre
    // sans couper laisserait la personne travailler encore des heures.
    if (!enabled) {
      await call(`${ctx.admin}/users/${encodeURIComponent(found.user.id)}/logout`, ctx, {
        method: "POST",
      }).catch(() => undefined);
    }

    return { status: enabled ? "resumed" : "suspended" };
  } catch (err) {
    return { status: "failed", reason: err instanceof Error ? err.name : "unknown" };
  }
}
