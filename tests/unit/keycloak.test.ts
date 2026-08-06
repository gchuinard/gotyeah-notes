import { describe, it, expect, vi, afterEach } from "vitest";
import {
  ensureInvitedUser,
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
    expect(await ensureInvitedUser("a@b.tld", "a")).toEqual({ status: "disabled" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("un issuer qui n'a pas la forme .../realms/<realm> échoue au lieu d'inventer une URL", async () => {
    // L'URL d'admin est DÉRIVÉE de l'issuer. Mal dérivée, elle pourrait viser un
    // autre realm — ou un autre hôte. Mieux vaut refuser.
    vi.stubEnv("OIDC_ISSUER", "https://login.example.tld/auth");
    vi.stubEnv("KEYCLOAK_ADMIN_CLIENT_ID", "x");
    vi.stubEnv("KEYCLOAK_ADMIN_CLIENT_SECRET", "y");
    vi.stubGlobal("fetch", vi.fn());
    expect(await ensureInvitedUser("a@b.tld", "a")).toEqual({
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
    expect(await ensureInvitedUser("connu@b.tld", "connu")).toEqual({ status: "existing" });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    const urls = fetchMock.mock.calls.map((c) => String(c[0]));
    expect(urls.some((u) => u.includes("execute-actions-email"))).toBe(false);
  });

  it("la recherche est EXACTE : « a@b.tld » ne doit pas matcher « a@b.tld.evil »", async () => {
    const fetchMock = configured(TOKEN_OK, json([{ id: "u1" }]));
    await ensureInvitedUser("a@b.tld", "a");
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
    expect(await ensureInvitedUser("neuf@b.tld", "neuf")).toEqual({ status: "created" });
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
    await ensureInvitedUser("neuf@b.tld", "neuf");

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
    await ensureInvitedUser("neuf@b.tld", "neuf");
    const createUrl = String(
      fetchMock.mock.calls.find((c) => c[1]?.method === "POST" && String(c[0]).endsWith("/users"))![0]
    );
    expect(createUrl).toBe("https://login.example.tld/admin/realms/gotyeah/users");
  });

  it("une création concurrente (409) n'est pas une erreur : l'état visé est atteint", async () => {
    configured(TOKEN_OK, json([]), json({}, 409));
    expect(await ensureInvitedUser("course@b.tld", "course")).toEqual({ status: "existing" });
  });

  it("si l'email d'activation échoue, on le DIT — le compte existe pourtant", async () => {
    // L'admin doit savoir qu'il lui reste à renvoyer le lien depuis Keycloak.
    configured(TOKEN_OK, json([]), json({}, 201), json([{ id: "u42" }]), json({}, 500));
    expect(await ensureInvitedUser("neuf@b.tld", "neuf")).toEqual({
      status: "failed",
      reason: "activation_500",
    });
  });
});

describe("Pannes — jamais d'exception, l'invitation est déjà en base", () => {
  it("jeton refusé", async () => {
    configured(json({ error: "invalid_client" }, 401));
    expect(await ensureInvitedUser("a@b.tld", "a")).toEqual({ status: "failed", reason: "token" });
  });

  it("réseau coupé", async () => {
    vi.stubEnv("OIDC_ISSUER", ISSUER);
    vi.stubEnv("KEYCLOAK_ADMIN_CLIENT_ID", "x");
    vi.stubEnv("KEYCLOAK_ADMIN_CLIENT_SECRET", "y");
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("ECONNREFUSED")));
    const r = await ensureInvitedUser("a@b.tld", "a");
    expect(r.status).toBe("failed");
  });

  it("lookup en erreur", async () => {
    configured(TOKEN_OK, json({}, 403));
    expect(await ensureInvitedUser("a@b.tld", "a")).toEqual({
      status: "failed",
      reason: "lookup_403",
    });
  });
});
