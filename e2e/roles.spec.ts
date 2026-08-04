import { test, expect } from "@playwright/test";
import { register } from "./helpers/auth";

// Ticket rôles + membres : un admin ajoute un compte existant par email depuis
// l'écran Réglages → Membres ; l'invité lecteur voit l'espace en LECTURE SEULE
// (badge, affordances masquées, 403 serveur) ; élevé éditeur, il peut écrire.
// Deux contextes navigateur = deux sessions (cookies isolés, workers: 1).

test("invitation d'un lecteur : écran Membres, lecture seule, élévation en éditeur", async ({
  page,
  browser,
}) => {
  // A : admin de son espace. B : compte existant, sans accès à l'espace de A.
  const a = await register(page, "roles-a", "Alice Admin");
  const ctxB = await browser.newContext();
  const pageB = await ctxB.newPage();
  const b = await register(pageB, "roles-b", "Bob Lecteur");

  // ── A ajoute B (lecteur par défaut) via l'écran Membres ────────────────────
  await page.goto("/settings");
  // Le clic peut partir avant l'hydratation React (next dev) → clic auto-réessayé
  // jusqu'à ce que la section Membres soit réellement montée.
  await expect(async () => {
    await page.getByRole("button", { name: "Membres" }).click();
    await expect(page.getByPlaceholder("email@exemple.fr")).toBeVisible({ timeout: 2000 });
  }).toPass();
  await page.getByPlaceholder("email@exemple.fr").fill(b.email);
  await page.getByRole("button", { name: "Ajouter" }).click();
  await expect(page.getByText("Bob Lecteur")).toBeVisible();

  // Garde-fou « dernier admin » remonté jusqu'à l'UI : A ne peut pas se rétrograder.
  // Selects de l'écran : [rôle du formulaire d'ajout, ligne Alice, ligne Bob].
  await page.locator("select").nth(1).selectOption("viewer");
  await expect(
    page.getByText("Impossible de retirer le dernier admin de l'espace")
  ).toBeVisible();

  // ── B bascule sur l'espace de A : lecture seule totale ─────────────────────
  const sw = await pageB.request.post(`/api/workspaces/${a.workspaceId}/switch`);
  expect(sw.ok()).toBeTruthy();
  await pageB.goto("/");

  await expect(pageB.getByText("Lecture seule")).toBeVisible();
  await expect(pageB.getByText("Nouvelle database")).toHaveCount(0);

  // L'UI n'est que du confort : le serveur refuse en 403.
  const forbidden = await pageB.request.post("/api/pages", {
    data: { workspaceId: a.workspaceId, title: "x" },
  });
  expect(forbidden.status()).toBe(403);

  // ── A élève B en éditeur : l'espace s'ouvre ────────────────────────────────
  await page.locator("select").last().selectOption("editor");
  await expect(
    page.getByText("Impossible de retirer le dernier admin de l'espace")
  ).toHaveCount(0);

  await pageB.goto("/");
  await expect(pageB.getByText("Lecture seule")).toHaveCount(0);
  const allowed = await pageB.request.post("/api/pages", {
    data: { workspaceId: a.workspaceId, title: "Page de Bob" },
  });
  expect(allowed.status()).toBe(200);

  await ctxB.close();
});
