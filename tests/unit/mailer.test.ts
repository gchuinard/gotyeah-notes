import { describe, it, expect, vi, afterEach } from "vitest";
import { sendEmail, mailerEnabled, appBaseUrl } from "@/lib/mailer";
import {
  invitationEmail,
  addedToWorkspaceEmail,
  escapeHtml,
  roleLabel,
} from "@/lib/invitationEmail";

/**
 * Transport et contenu des emails d'invitation, SANS réseau.
 *
 * `vitest.config.ts` pose déjà `BREVO_API_KEY: ""` : un test qui oublierait de
 * stubber le fetch ne peut pas appeler Brevo, sendEmail sort sur « disabled »
 * avant. Les cas qui ont besoin d'une clé la posent explicitement.
 */

const okResponse = { ok: true, status: 201 } as Response;

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("sendEmail — transport Brevo", () => {
  const mail = { to: "x@y.tld", subject: "S", html: "<p>H</p>", text: "T" };

  it("sans clé : désactivé, et AUCUN appel réseau n'est tenté", async () => {
    // Le vrai contrat de la dégradation : ce n'est pas « ça échoue proprement »,
    // c'est « ça ne sort pas de la machine ». Un self-host sans compte Brevo ne
    // doit contacter personne.
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);

    expect(mailerEnabled()).toBe(false);
    expect(await sendEmail(mail)).toEqual({ ok: false, reason: "disabled" });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("avec clé : poste le payload Brevo attendu", async () => {
    vi.stubEnv("BREVO_API_KEY", "clef-de-test");
    vi.stubEnv("MAIL_FROM", "notes@exemple.fr");
    vi.stubEnv("MAIL_FROM_NAME", "GotYeah Notes");
    const fetchSpy = vi.fn().mockResolvedValue(okResponse);
    vi.stubGlobal("fetch", fetchSpy);

    expect(await sendEmail(mail)).toEqual({ ok: true });

    const [url, init] = fetchSpy.mock.calls[0];
    expect(url).toBe("https://api.brevo.com/v3/smtp/email");
    expect(init.headers["api-key"]).toBe("clef-de-test");
    const body = JSON.parse(init.body);
    expect(body.sender).toEqual({ email: "notes@exemple.fr", name: "GotYeah Notes" });
    expect(body.to).toEqual([{ email: "x@y.tld" }]);
    expect(body.htmlContent).toBe("<p>H</p>");
    expect(body.textContent).toBe("T");
    // Sans plafond, un Brevo qui pend ferait pendre l'écran de l'admin.
    expect(init.signal).toBeDefined();
  });

  it("un refus HTTP remonte le code, sans lever", async () => {
    vi.stubEnv("BREVO_API_KEY", "clef-de-test");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 400 } as Response));
    expect(await sendEmail(mail)).toEqual({ ok: false, reason: "http", status: 400 });
  });

  it("une panne réseau ne lève pas non plus", async () => {
    // L'invitation est déjà écrite en base quand on arrive ici : une exception
    // ferait rendre 500 à un handler dont le travail a réussi.
    vi.stubEnv("BREVO_API_KEY", "clef-de-test");
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("ECONNRESET")));
    expect(await sendEmail(mail)).toEqual({ ok: false, reason: "network" });
  });
});

describe("appBaseUrl — origine des liens", () => {
  it("APP_BASE_URL prime et perd son slash final", () => {
    vi.stubEnv("APP_BASE_URL", "https://notes.exemple.fr/");
    expect(appBaseUrl()).toBe("https://notes.exemple.fr");
  });

  it("sans configuration, chaîne vide (email sans bouton) plutôt qu'un lien inventé", () => {
    // Le repli est appOrigin(), vide hors OIDC. Surtout : jamais l'en-tête Host
    // d'une requête — un email GotYeah pointant ailleurs serait un hameçonnage.
    expect(appBaseUrl()).toBe("");
  });
});

describe("Contenu des emails", () => {
  const ctx = {
    workspaceName: "Mon espace",
    inviterName: "Gautier",
    role: "editor",
    url: "https://notes.exemple.fr",
  };

  it("l'invitation nomme l'espace, l'inviteur et le rôle en français", () => {
    const mail = invitationEmail(ctx);
    expect(mail.subject).toContain("Mon espace");
    expect(mail.subject).toContain("Gautier");
    expect(mail.html).toContain("éditeur");
    expect(mail.text).toContain("éditeur");
    expect(mail.html).toContain("https://notes.exemple.fr");
  });

  it("l'email d'ajout dit que l'accès est DÉJÀ ouvert", () => {
    const mail = addedToWorkspaceEmail(ctx);
    expect(mail.subject).toContain("rejoint");
    expect(mail.html).toContain("sélecteur d&apos;espaces".replace("&apos;", "'"));
  });

  it("sans URL, aucun lien mort n'est fabriqué", () => {
    const mail = invitationEmail({ ...ctx, url: "" });
    expect(mail.html).not.toContain("href=\"\"");
    expect(mail.html).not.toContain("undefined");
  });

  it("un nom d'espace hostile est échappé, pas rendu", () => {
    // Un nom d'espace est une chaîne libre. Injecté tel quel, il placerait un
    // lien arbitraire dans un email qui a l'air de venir de GotYeah. Le JS ne
    // s'exécute pas dans un client mail — un <a>, si.
    const mail = invitationEmail({
      ...ctx,
      workspaceName: '<a href="https://pirate.tld">clique</a>',
    });
    expect(mail.html).not.toContain('<a href="https://pirate.tld"');
    expect(mail.html).toContain("&lt;a href=&quot;https://pirate.tld&quot;&gt;");
  });

  it("escapeHtml couvre les cinq caractères qui comptent", () => {
    expect(escapeHtml('<>&"')).toBe("&lt;&gt;&amp;&quot;");
  });

  it("un rôle inconnu s'affiche « membre », jamais son identifiant brut", () => {
    expect(roleLabel("admin")).toBe("administrateur");
    expect(roleLabel("owner")).toBe("membre");
  });
});
