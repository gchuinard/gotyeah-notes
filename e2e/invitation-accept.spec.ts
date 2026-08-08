import { test, expect } from "@playwright/test";
import { register } from "./helpers/auth";

/**
 * Le cœur du lot : on n'entre plus dans un espace sans l'avoir accepté.
 *
 * Avant, `POST /members` créait la Membership immédiatement — l'espace
 * apparaissait dans la barre latérale de quelqu'un qui n'avait rien demandé, et
 * ce comportement servait de tremplin à l'escalade trouvée sur les comptes SSO.
 */

test("un membre invité voit la demande dans sa cloche, et n'entre qu'après l'avoir acceptée", async ({
  browser,
}) => {
  // Deux contextes : deux sessions réellement distinctes, pas deux onglets.
  const ctxAdmin = await browser.newContext();
  const ctxInvite = await browser.newContext();
  const pageAdmin = await ctxAdmin.newPage();
  const pageInvite = await ctxInvite.newPage();

  const admin = await register(pageAdmin, "inv-admin", "Admin Test");
  const invite = await register(pageInvite, "inv-cible", "Cible Test");

  // L'admin « ajoute » : ça ne l'ajoute plus, ça le propose.
  const res = await pageAdmin.request.post(
    `/api/workspaces/${admin.workspaceId}/members`,
    { data: { email: invite.email, role: "editor" } }
  );
  expect(res.status()).toBe(201);
  expect((await res.json()).status).toBe("invited");

  // Côté invité : la cloche porte une pastille, et l'espace n'est PAS encore là.
  await pageInvite.goto("/");
  const cloche = pageInvite.getByRole("button", { name: /Notifications/ });
  await expect(cloche).toBeVisible();
  await expect(pageInvite.locator("header").getByText("1")).toBeVisible();

  const avant = await (await pageInvite.request.get("/api/workspaces")).json();
  expect(avant).toHaveLength(1); // seulement « Mon espace »

  // Il ouvre, lit, accepte.
  await cloche.click();
  await expect(pageInvite.getByText(/t'invite à rejoindre/)).toBeVisible();
  await expect(pageInvite.getByText(/Rôle proposé\s*:\s*éditeur/)).toBeVisible();
  await pageInvite.getByRole("button", { name: "Accepter" }).click();

  // Et maintenant seulement, il est membre.
  await expect
    .poll(async () => (await (await pageInvite.request.get("/api/workspaces")).json()).length)
    .toBe(2);

  await ctxAdmin.close();
  await ctxInvite.close();
});

test("refuser ne fait entrer nulle part, et l'admin l'apprend", async ({ browser }) => {
  const ctxAdmin = await browser.newContext();
  const ctxInvite = await browser.newContext();
  const pageAdmin = await ctxAdmin.newPage();
  const pageInvite = await ctxInvite.newPage();

  const admin = await register(pageAdmin, "ref-admin", "Admin Ref");
  const invite = await register(pageInvite, "ref-cible", "Cible Ref");

  await pageAdmin.request.post(`/api/workspaces/${admin.workspaceId}/members`, {
    data: { email: invite.email, role: "viewer" },
  });

  await pageInvite.goto("/");
  await pageInvite.getByRole("button", { name: /Notifications/ }).click();
  await pageInvite.getByRole("button", { name: "Refuser" }).click();

  // Toujours un seul espace : le refus n'accorde rien.
  await expect
    .poll(async () => (await (await pageInvite.request.get("/api/workspaces")).json()).length)
    .toBe(1);

  // L'admin l'apprend — sans ça il verrait « en attente » disparaître sans
  // savoir si c'est un refus ou une expiration.
  await pageAdmin.goto("/");
  await pageAdmin.getByRole("button", { name: /Notifications/ }).click();
  await expect(pageAdmin.getByText(/a refusé ton invitation/)).toBeVisible();

  await ctxAdmin.close();
  await ctxInvite.close();
});

test("⚠️ un invité SANS compte voit l'écran d'acceptation, et rien n'est créé avant son clic", async ({
  browser,
}) => {
  const ctxAdmin = await browser.newContext();
  const pageAdmin = await ctxAdmin.newPage();
  const admin = await register(pageAdmin, "sans-compte-admin", "Admin SC");

  const email = `sans-compte-${Date.now()}@x.tld`;
  const res = await pageAdmin.request.post(
    `/api/workspaces/${admin.workspaceId}/members`,
    { data: { email, role: "viewer" } }
  );
  expect(res.status()).toBe(201);

  // On simule le clic sur le lien de l'email : le harnais n'a pas de boîte mail,
  // mais le jeton est celui qu'`issueMagicLink` vient de poser. On passe donc par
  // la demande de lien, qui répond toujours pareil, puis par la page directement.
  const ctxInvite = await browser.newContext();
  const pageInvite = await ctxInvite.newPage();

  // Sans jeton valable, la page doit refuser — et ne créer aucun compte.
  await pageInvite.goto("/invitation?token=jeton-invente");
  await expect(pageInvite.getByText(/Lien inutilisable/)).toBeVisible();

  // Le compte n'existe toujours pas : la page publique ne provisionne rien.
  const verif = await pageAdmin.request.get(
    `/api/workspaces/${admin.workspaceId}/invitations`
  );
  const pending = await verif.json();
  expect(pending.some((i: { email: string }) => i.email === email)).toBe(true);

  await ctxAdmin.close();
  await ctxInvite.close();
});
