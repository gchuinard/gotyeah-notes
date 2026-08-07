import { describe, it, expect, vi, afterEach } from "vitest";

/**
 * URL de la console de compte de l'IdP — l'écran où chacun gère SES moyens de
 * connexion (mot de passe, clés d'accès).
 *
 * ⚠️ `ISSUER` est une const de MODULE, lue à l'import : `vi.stubEnv` seul
 * n'aurait aucun effet. D'où le `resetModules` + import dynamique, même patron
 * que les tests qui manipulent la configuration OIDC.
 */
async function load(env: Record<string, string>) {
  vi.resetModules();
  for (const [k, v] of Object.entries(env)) vi.stubEnv(k, v);
  return import("@/lib/oidc");
}

const COMPLET = {
  OIDC_ISSUER: "https://login.gautierchuinard.com/realms/gotyeah",
  OIDC_CLIENT_ID: "notes",
  OIDC_CLIENT_SECRET: "s3cret",
  OIDC_REDIRECT_URI: "https://notes.example.tld/api/auth/oidc/callback",
};

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe("accountConsoleUrl", () => {
  it("dérive l'URL de l'issuer, et tolère un slash final", async () => {
    const a = await load(COMPLET);
    expect(a.accountConsoleUrl()).toBe(
      "https://login.gautierchuinard.com/realms/gotyeah/account"
    );

    const b = await load({ ...COMPLET, OIDC_ISSUER: `${COMPLET.OIDC_ISSUER}/` });
    expect(b.accountConsoleUrl()).toBe(
      "https://login.gautierchuinard.com/realms/gotyeah/account"
    );
  });

  it("chaîne vide quand l'OIDC n'est pas configuré — on n'affiche pas un lien mort", async () => {
    const m = await load({ ...COMPLET, OIDC_CLIENT_SECRET: "" });
    expect(m.accountConsoleUrl()).toBe("");

    const n = await load({ ...COMPLET, OIDC_ISSUER: "" });
    expect(n.accountConsoleUrl()).toBe("");
  });

  it("⚠️ reste sur l'origine PUBLIQUE même quand KEYCLOAK_INTERNAL_URL est posée", async () => {
    // C'est LE piège du lot. `lib/keycloak.ts > endpoints()` substitue cette
    // variable à l'origine publique pour parler à l'API admin depuis le réseau
    // des conteneurs. Un lien AFFICHÉ construit là-dessus mènerait à
    // http://login-keycloak:8080, injoignable depuis un navigateur — et le
    // diagnostic serait trompeur : pas une erreur d'auth, un timeout DNS.
    const m = await load({
      ...COMPLET,
      KEYCLOAK_INTERNAL_URL: "http://login-keycloak:8080",
    });
    expect(m.accountConsoleUrl()).toBe(
      "https://login.gautierchuinard.com/realms/gotyeah/account"
    );
    expect(m.accountConsoleUrl()).not.toContain("login-keycloak");
  });
});
