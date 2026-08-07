import { describe, it, expect, vi, afterEach } from "vitest";
import {
  provisionIdpAccount,
  listIdpAccounts,
  setIdpAccountEnabled,
  isIdpAdmin,
  keycloakAdminEnabled,
  _resetKeycloakToken,
} from "@/lib/keycloak";

/**
 * Provisioning d'un invité dans l'IdP, SANS réseau.
 *
 * `vitest.config.ts` laisse KEYCLOAK_ADMIN_* vides : un test qui oublierait de
 * les poser sort sur « disabled » avant tout fetch, et ne peut donc pas créer de
 * compte dans le Keycloak de production.
 */

const ISSUER = "https://login.example.tld/realms/gotyeah";

/** Configure le module et renvoie le mock de fetch. */
function configured(...responses: unknown[]) {
  vi.stubEnv("OIDC_ISSUER", ISSUER);
  vi.stubEnv("KEYCLOAK_ADMIN_CLIENT_ID", "notes-provisioning");
  vi.stubEnv("KEYCLOAK_ADMIN_CLIENT_SECRET", "s3cret");
  const fetchMock = vi.fn();
  for (const r of responses) fetchMock.mockResolvedValueOnce(r);
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

const json = (body: unknown, status = 200) =>
  ({ ok: status < 400, status, json: async () => body }) as Response;

const TOKEN_OK = json({ access_token: "jeton", expires_in: 60 });

/**
 * Le POST de CRÉATION d'utilisateur. `method === "POST"` seul ne suffit pas :
 * la demande de jeton en est un aussi, et le test passerait en croyant observer
 * une création.
 */
const createCallOf = (fetchMock: ReturnType<typeof vi.fn>) =>
  fetchMock.mock.calls.find(
    (c) => c[1]?.method === "POST" && String(c[0]).endsWith("/users")
  );

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  _resetKeycloakToken();
});

describe("Désactivation — aucune configuration, aucune surface", () => {
  it("sans les variables, la fonctionnalité n'existe pas et ne touche pas le réseau", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    expect(keycloakAdminEnabled()).toBe(false);
    expect(await provisionIdpAccount({ email:"a@b.tld", firstName: "a", lastName: "" })).toEqual({ status: "disabled" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("un issuer qui n'a pas la forme .../realms/<realm> échoue au lieu d'inventer une URL", async () => {
    // L'URL d'admin est DÉRIVÉE de l'issuer. Mal dérivée, elle pourrait viser un
    // autre realm — ou un autre hôte. Mieux vaut refuser.
    vi.stubEnv("OIDC_ISSUER", "https://login.example.tld/auth");
    vi.stubEnv("KEYCLOAK_ADMIN_CLIENT_ID", "x");
    vi.stubEnv("KEYCLOAK_ADMIN_CLIENT_SECRET", "y");
    vi.stubGlobal("fetch", vi.fn());
    expect(await provisionIdpAccount({ email:"a@b.tld", firstName: "a", lastName: "" })).toEqual({
      status: "failed",
      reason: "issuer_malformed",
    });
  });
});

describe("Compte déjà présent dans l'IdP", () => {
  it("rend « existing » et n'envoie AUCUN email d'activation", async () => {
    // Renvoyer un lien « choisis ton mot de passe » à quelqu'un qui en a déjà un
    // ressemblerait à une prise de contrôle de compte.
    const fetchMock = configured(TOKEN_OK, json([{ id: "u1" }]));
    expect(await provisionIdpAccount({ email:"connu@b.tld", firstName: "connu", lastName: "" })).toEqual({ status: "existing" });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    const urls = fetchMock.mock.calls.map((c) => String(c[0]));
    expect(urls.some((u) => u.includes("execute-actions-email"))).toBe(false);
  });

  it("la recherche est EXACTE : « a@b.tld » ne doit pas matcher « a@b.tld.evil »", async () => {
    const fetchMock = configured(TOKEN_OK, json([{ id: "u1" }]));
    await provisionIdpAccount({ email:"a@b.tld", firstName: "a", lastName: "" });
    const lookup = String(fetchMock.mock.calls[1][0]);
    expect(lookup).toContain("exact=true");
    expect(lookup).toContain(encodeURIComponent("a@b.tld"));
  });
});

describe("Création d'un compte", () => {
  const nominal = () =>
    configured(
      TOKEN_OK,
      json([]), // lookup : inconnu
      json({}, 201), // create
      json([{ id: "u42" }]), // relookup
      json({}, 204) // execute-actions-email
    );

  it("crée le compte puis déclenche l'email d'activation", async () => {
    const fetchMock = nominal();
    expect(await provisionIdpAccount({ email:"neuf@b.tld", firstName: "neuf", lastName: "" })).toEqual({ status: "created" });
    const urls = fetchMock.mock.calls.map((c) => String(c[0]));
    expect(urls.some((u) => u.includes("execute-actions-email"))).toBe(true);
  });

  it("⚠️ le compte est créé emailVerified=FALSE et SANS mot de passe", async () => {
    // Ces deux points sont la sécurité du lot. `emailVerified: true` ferait
    // qu'un admin se trompant d'adresse fabriquerait un compte « vérifié » pour
    // une boîte qu'il ne contrôle pas — or notes fait reposer le claim
    // d'invitation sur email_verified. Et un mot de passe posé ici rendrait le
    // compte utilisable sans que personne n'ait prouvé posséder l'adresse.
    const fetchMock = nominal();
    await provisionIdpAccount({ email:"neuf@b.tld", firstName: "neuf", lastName: "" });

    const createCall = fetchMock.mock.calls.find(
      (c) => c[1]?.method === "POST" && String(c[0]).endsWith("/users")
    );
    expect(createCall, "aucun POST /users trouvé").toBeDefined();
    const payload = JSON.parse(createCall![1].body);
    expect(payload.emailVerified).toBe(false);
    expect(payload.credentials).toBeUndefined();
    expect(payload.password).toBeUndefined();
    expect(payload.requiredActions).toContain("UPDATE_PASSWORD");
    expect(payload.requiredActions).toContain("VERIFY_EMAIL");
  });

  it("l'URL d'admin est dérivée de l'issuer, même hôte et même realm", async () => {
    const fetchMock = nominal();
    await provisionIdpAccount({ email:"neuf@b.tld", firstName: "neuf", lastName: "" });
    const createUrl = String(
      fetchMock.mock.calls.find((c) => c[1]?.method === "POST" && String(c[0]).endsWith("/users"))![0]
    );
    expect(createUrl).toBe("https://login.example.tld/admin/realms/gotyeah/users");
  });

  it("KEYCLOAK_INTERNAL_URL détourne les appels du proxy — mais JAMAIS le realm", async () => {
    // Sur cette instance, /admin/* est protégé par Cloudflare Access et répond
    // 302 : le provisioning échouerait avec un diagnostic trompeur. On joint
    // donc Keycloak en interne. Le realm, lui, reste celui de l'issuer —
    // provisionner ailleurs que là où l'on authentifie ne se verrait qu'au
    // moment où l'invité, compte créé, ne pourrait pas se connecter.
    vi.stubEnv("KEYCLOAK_INTERNAL_URL", "http://login-keycloak:8080/");
    const fetchMock = nominal();
    await provisionIdpAccount({ email:"neuf@b.tld", firstName: "neuf", lastName: "" });

    const urls = fetchMock.mock.calls.map((c) => String(c[0]));
    expect(urls.every((u) => u.startsWith("http://login-keycloak:8080/"))).toBe(true);
    // Le slash final de la variable ne doit pas produire un « //realms ».
    expect(urls[0]).toBe(
      "http://login-keycloak:8080/realms/gotyeah/protocol/openid-connect/token"
    );
    expect(urls.every((u) => u.includes("/gotyeah/") || u.includes("realms/gotyeah"))).toBe(true);
  });

  it("une création concurrente (409) n'est pas une erreur : l'état visé est atteint", async () => {
    configured(TOKEN_OK, json([]), json({}, 409));
    expect(await provisionIdpAccount({ email:"course@b.tld", firstName: "course", lastName: "" })).toEqual({ status: "existing" });
  });

  it("si l'email d'activation échoue, on le DIT — le compte existe pourtant", async () => {
    // L'admin doit savoir qu'il lui reste à renvoyer le lien depuis Keycloak.
    configured(TOKEN_OK, json([]), json({}, 201), json([{ id: "u42" }]), json({}, 500));
    expect(await provisionIdpAccount({ email:"neuf@b.tld", firstName: "neuf", lastName: "" })).toEqual({
      status: "failed",
      reason: "activation_500",
    });
  });
});

describe("Compte présent mais JAMAIS activé — sortie de cul-de-sac", () => {
  it("⚠️ relance l'activation quand UPDATE_PASSWORD est pendant ET qu'aucun mot de passe n'existe", async () => {
    // Le scénario : la création a réussi, l'email d'activation a échoué. Le
    // compte existe SANS mot de passe. Avec l'ancienne logique, tout appel
    // suivant le trouvait « existing » et sortait avant l'envoi — plus jamais
    // aucun lien ne partait, précisément quand l'admin essayait de réparer.
    const fetchMock = configured(
      TOKEN_OK,
      json([{ id: "u1", requiredActions: ["UPDATE_PASSWORD"], emailVerified: false }]),
      json([]), // /credentials : aucun mot de passe
      json({}, 204)
    );
    expect(await provisionIdpAccount({ email: "bloque@b.tld", firstName: "A", lastName: "B" })).toEqual({
      status: "resent",
    });
    const urls = fetchMock.mock.calls.map((c) => String(c[0]));
    expect(urls.some((u) => u.includes("execute-actions-email"))).toBe(true);
    // Aucun second compte : on ne recrée pas ce qui existe.
    expect(createCallOf(fetchMock)).toBeUndefined();
  });

  it("un compte SANS requiredActions reste « existing » et ne reçoit rien", async () => {
    // La distinction tient à requiredActions, pas à emailVerified : un compte
    // utilisable avec une adresse non vérifiée ne doit pas se voir proposer un
    // nouveau mot de passe — ça ressemblerait à une prise de contrôle.
    const fetchMock = configured(TOKEN_OK, json([{ id: "u1", emailVerified: false }]));
    expect(await provisionIdpAccount({ email: "actif@b.tld", firstName: "A", lastName: "B" })).toEqual({
      status: "existing",
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("⚠️ UPDATE_PASSWORD pendant mais mot de passe EXISTANT ⇒ aucun envoi", async () => {
    // Keycloak pose aussi UPDATE_PASSWORD sur un compte VIVANT : mot de passe
    // temporaire, « Required user actions » posée à la main, politique
    // d'expiration. Sans cette lecture des credentials, on expédiait un
    // « choisis ton mot de passe » à quelqu'un qui en a un — exactement ce que
    // la branche `existing` refuse, et dans un realm partagé.
    const fetchMock = configured(
      TOKEN_OK,
      json([{ id: "u1", requiredActions: ["UPDATE_PASSWORD"] }]),
      json([{ type: "password", createdDate: 1 }])
    );
    expect(await provisionIdpAccount({ email: "vivant@b.tld", firstName: "A", lastName: "B" })).toEqual({
      status: "existing",
    });
    const urls = fetchMock.mock.calls.map((c) => String(c[0]));
    expect(urls.some((u) => u.includes("execute-actions-email"))).toBe(false);
  });

  it("credentials illisibles ⇒ on n'envoie PAS : on ne devine pas sur ce sujet", async () => {
    const fetchMock = configured(
      TOKEN_OK,
      json([{ id: "u1", requiredActions: ["UPDATE_PASSWORD"] }]),
      json({}, 403)
    );
    expect(await provisionIdpAccount({ email: "flou@b.tld", firstName: "A", lastName: "B" })).toEqual({
      status: "existing",
    });
    expect(
      fetchMock.mock.calls.map((c) => String(c[0])).some((u) => u.includes("execute-actions-email"))
    ).toBe(false);
  });

  it("le prénom et le nom sont envoyés SÉPARÉMENT", async () => {
    // firstName: displayName mettait « Gautier Chuinard » entier dans le prénom,
    // et le nom était faux sur tous les sites du realm.
    const fetchMock = configured(TOKEN_OK, json([]), json({}, 201), json([{ id: "u1" }]), json({}, 204));
    await provisionIdpAccount({ email: "n@b.tld", firstName: "Ada", lastName: "Lovelace" });
    const payload = JSON.parse(createCallOf(fetchMock)![1].body);
    expect(payload.firstName).toBe("Ada");
    expect(payload.lastName).toBe("Lovelace");
  });
});

describe("Autorité d'instance — isIdpAdmin", () => {
  it("⚠️ vide = PERSONNE (jamais « tout le monde »)", async () => {
    // Le défaut permissif est celui qui a rendu MCP_ACT_AS_ALLOWLIST inerte
    // trois semaines : la variable était là, seule la VALEUR manquait.
    vi.stubEnv("IDP_ADMIN_EMAILS", "");
    expect(isIdpAdmin("gautier@x.tld")).toBe(false);
  });

  it("compare normalisé, tolère les espaces, et n'accepte pas un préfixe", async () => {
    vi.stubEnv("IDP_ADMIN_EMAILS", " Gautier@X.TLD , autre@x.tld ");
    expect(isIdpAdmin("gautier@x.tld")).toBe(true);
    expect(isIdpAdmin("  GAUTIER@x.tld ")).toBe(true);
    expect(isIdpAdmin("autre@x.tld")).toBe(true);
    expect(isIdpAdmin("gautier@x.tld.evil")).toBe(false);
    expect(isIdpAdmin("gautier@x.tl")).toBe(false);
    expect(isIdpAdmin("")).toBe(false);
  });
});

describe("Annuaire — une requête, croisement local", () => {
  it("indexe par email NORMALISÉ (l'IdP peut stocker une autre casse)", async () => {
    configured(TOKEN_OK, json([{ id: "u1", email: "Ada@B.TLD", enabled: true, emailVerified: true }]));
    const dir = await listIdpAccounts();
    expect(dir.ok).toBe(true);
    if (!dir.ok) return;
    expect(dir.accounts.get("ada@b.tld")).toEqual({
      enabled: true,
      emailVerified: true,
      pending: false,
    });
    expect(dir.truncated).toBe(false);
  });

  it("⚠️ une page pleine est signalée TRONQUÉE, jamais rendue comme complète", async () => {
    // Sinon une adresse simplement non lue passerait pour « aucun compte », et
    // l'admin créerait un doublon d'identité dans un realm partagé.
    const rows = Array.from({ length: 500 }, (_, i) => ({ id: `u${i}`, email: `u${i}@b.tld` }));
    configured(TOKEN_OK, json(rows));
    const dir = await listIdpAccounts();
    expect(dir.ok && dir.truncated).toBe(true);
  });

  it("une seule requête, quel que soit le nombre de membres à afficher", async () => {
    const fetchMock = configured(TOKEN_OK, json([]));
    await listIdpAccounts();
    // jeton + listing, et rien d'autre : pas de lookup par membre.
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("un IdP en erreur rend un échec explicite, pas un annuaire vide", async () => {
    configured(TOKEN_OK, json({}, 503));
    expect(await listIdpAccounts()).toEqual({ ok: false, reason: "list_503" });
  });
});

describe("Suspension — réversible, et jamais une suppression", () => {
  it("suspendre pose enabled:false PUIS coupe les sessions ouvertes", async () => {
    // `enabled: false` bloque les NOUVELLES connexions ; sans le logout, une
    // session déjà ouverte survivrait jusqu'à son expiration.
    const fetchMock = configured(TOKEN_OK, json([{ id: "u1" }]), json({}, 204), json({}, 204));
    expect(await setIdpAccountEnabled("a@b.tld", false)).toEqual({
      status: "suspended",
      sessionsCut: true,
    });

    const put = fetchMock.mock.calls.find((c) => c[1]?.method === "PUT")!;
    expect(JSON.parse(put[1].body)).toEqual({ enabled: false });
    expect(fetchMock.mock.calls.some((c) => String(c[0]).endsWith("/logout"))).toBe(true);
    // ⚠️ Aucune suppression : le sub, le MFA et les liens fédérés survivent.
    expect(fetchMock.mock.calls.some((c) => c[1]?.method === "DELETE")).toBe(false);
  });

  it("réactiver ne coupe aucune session", async () => {
    const fetchMock = configured(TOKEN_OK, json([{ id: "u1" }]), json({}, 204));
    expect(await setIdpAccountEnabled("a@b.tld", true)).toEqual({ status: "resumed" });
    expect(fetchMock.mock.calls.some((c) => String(c[0]).endsWith("/logout"))).toBe(false);
  });

  it("⚠️ un logout raté est RAPPORTÉ, pas avalé : la suspension est partielle", async () => {
    // Le compte est bien désactivé (le PUT a réussi), mais les sessions
    // ouvertes survivent. Annoncer « sessions coupées » ferait croire à un
    // offboarding terminé alors que la personne travaille encore.
    configured(TOKEN_OK, json([{ id: "u1" }]), json({}, 204), json({}, 502));
    expect(await setIdpAccountEnabled("a@b.tld", false)).toEqual({
      status: "suspended",
      sessionsCut: false,
    });
  });

  it("suspendre une adresse sans compte rend « absent » — et ne crée rien", async () => {
    const fetchMock = configured(TOKEN_OK, json([]));
    expect(await setIdpAccountEnabled("inconnu@b.tld", false)).toEqual({ status: "absent" });
    expect(createCallOf(fetchMock)).toBeUndefined();
  });

  it("sans configuration, aucune surface", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    expect(await setIdpAccountEnabled("a@b.tld", false)).toEqual({ status: "disabled" });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("Pannes — jamais d'exception, l'invitation est déjà en base", () => {
  it("jeton refusé", async () => {
    configured(json({ error: "invalid_client" }, 401));
    expect(await provisionIdpAccount({ email:"a@b.tld", firstName: "a", lastName: "" })).toEqual({ status: "failed", reason: "token" });
  });

  it("réseau coupé", async () => {
    vi.stubEnv("OIDC_ISSUER", ISSUER);
    vi.stubEnv("KEYCLOAK_ADMIN_CLIENT_ID", "x");
    vi.stubEnv("KEYCLOAK_ADMIN_CLIENT_SECRET", "y");
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("ECONNREFUSED")));
    const r = await provisionIdpAccount({ email:"a@b.tld", firstName: "a", lastName: "" });
    expect(r.status).toBe("failed");
  });

  it("lookup en erreur", async () => {
    configured(TOKEN_OK, json({}, 403));
    expect(await provisionIdpAccount({ email:"a@b.tld", firstName: "a", lastName: "" })).toEqual({
      status: "failed",
      reason: "lookup_403",
    });
  });
});
