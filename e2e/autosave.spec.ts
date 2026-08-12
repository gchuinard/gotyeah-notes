import { test, expect } from "@playwright/test";

async function register(page: import("@playwright/test").Page, tag: string) {
  const email = `${tag}-${Date.now()}@x.tld`;
  const reg = await page.request.post("/api/auth/register", {
    data: { firstName: "A", lastName: "S", displayName: "AS", email, password: "Test1234!" },
  });
  expect(reg.ok()).toBeTruthy();
  const workspaces = await (await page.request.get("/api/workspaces")).json();
  return workspaces[0].id as string;
}

test("Editor (page) : la saisie est flushée à la navigation (démontage)", async ({ page }) => {
  const workspaceId = await register(page, "autosave-ed");
  const pg = await (
    await page.request.post("/api/pages", { data: { workspaceId, title: "Page autosave" } })
  ).json();

  await page.goto(`/pages/${pg.id}`);
  const body = page.locator("[contenteditable='true']").first();
  await body.click();
  const typed = `flush-editor-${Date.now()}`;
  await page.keyboard.type(typed);

  // Navigation client (Accueil) AVANT l'expiration du debounce 600 ms → démontage
  // de l'Editor (keyé par pageId) → flush du PATCH en attente.
  const saved = page.waitForResponse(
    (r) => r.url().includes(`/api/pages/${pg.id}`) && r.request().method() === "PATCH"
  );
  await page.getByRole("link", { name: "Accueil" }).click();
  await saved;

  // Rechargement dur → lecture DB → la saisie est persistée.
  await page.goto(`/pages/${pg.id}`);
  await expect(page.getByText(typed)).toBeVisible();
});

test("RecordPanel : le corps libre est flushé à la fermeture (overlay)", async ({ page }) => {
  const workspaceId = await register(page, "autosave-rp");
  const pg = await (
    await page.request.post("/api/pages", { data: { workspaceId, title: "DB autosave" } })
  ).json();
  const db = await (await page.request.post("/api/databases", { data: { pageId: pg.id } })).json();
  const recordTitle = `AutosaveRec ${Date.now()}`;
  const rec = await (
    await page.request.post(`/api/databases/${db.id}/records`, { data: { title: recordTitle } })
  ).json();

  await page.goto(`/pages/${pg.id}`);
  await page.getByText(recordTitle).click();
  const body = page.locator("[contenteditable='true']").first();
  await expect(body).toBeVisible();

  await body.click();
  const typed = `flush-rp-${Date.now()}`;
  await page.keyboard.type(typed);

  // Fermer via l'overlay (coin haut-gauche, hors du panneau de 600 px à droite)
  // AVANT le debounce 500 ms → handleClose flushe le PATCH { content }.
  const saved = page.waitForResponse(
    (r) => r.url().includes(`/api/records/${rec.id}`) && r.request().method() === "PATCH"
  );
  await page.mouse.click(10, 10);
  await saved;

  // Recharger (DB) et rouvrir → le texte est présent (non-régression du bug).
  await page.goto(`/pages/${pg.id}`);
  await page.getByText(recordTitle).click();
  await expect(page.getByText(typed)).toBeVisible();
});

// ⚠️ LE test qui manquait, et c'est pour ça que le défaut a vécu : celui du
// dessus rouvre la carte APRÈS un `page.goto()`, un rechargement dur qui vide le
// cache SWR. Il ne pouvait donc structurellement pas voir le bug — un test vert
// pour une raison sans rapport avec ce qu'il croit garder.
// Ici on rouvre SANS recharger : le geste réel de l'utilisateur.
test("RecordPanel : rouvrir une carte SANS recharger affiche le texte enregistré", async ({ page }) => {
  const workspaceId = await register(page, "autosave-cache");
  const pg = await (
    await page.request.post("/api/pages", { data: { workspaceId, title: "DB cache" } })
  ).json();
  const db = await (await page.request.post("/api/databases", { data: { pageId: pg.id } })).json();
  const recordTitle = `CacheRec ${Date.now()}`;
  const rec = await (
    await page.request.post(`/api/databases/${db.id}/records`, { data: { title: recordTitle } })
  ).json();

  await page.goto(`/pages/${pg.id}`);
  await page.getByText(recordTitle).click();
  const body = page.locator("[contenteditable='true']").first();
  await expect(body).toBeVisible();

  await body.click();
  const typed = `cache-swr-${Date.now()}`;
  const saved = page.waitForResponse(
    (r) => r.url().includes(`/api/records/${rec.id}`) && r.request().method() === "PATCH"
  );
  await page.keyboard.type(typed);
  expect((await saved).ok()).toBeTruthy();

  // Le panneau le DIT : l'absence de ce signal est ce qui a laissé le défaut vivre.
  await expect(page.locator("[data-save-state]")).toHaveText("Enregistré ✓");

  // Fermer puis rouvrir SANS `page.goto()`. Avant le correctif, l'éditeur se
  // resemait sur le cache SWR jamais réconcilié et réaffichait le corps d'AVANT.
  // ⚠️ Le bouton, pas un clic sur l'overlay en (10,10) : même chemin
  // (`handleClose`), mais sans dépendre d'une géométrie que la hauteur du texte
  // saisi suffit à décaler.
  await page.getByRole("button", { name: "Fermer" }).click();
  await expect(body).toBeHidden();
  await page.getByText(recordTitle).click();
  await expect(page.getByText(typed)).toBeVisible();
});

test("RecordPanel : Échap dans le titre ne ferme pas ; Échap hors champ ferme", async ({ page }) => {
  const workspaceId = await register(page, "autosave-esc");
  const pg = await (
    await page.request.post("/api/pages", { data: { workspaceId, title: "DB esc" } })
  ).json();
  const db = await (await page.request.post("/api/databases", { data: { pageId: pg.id } })).json();
  const recordTitle = `EscRec ${Date.now()}`;
  await page.request.post(`/api/databases/${db.id}/records`, { data: { title: recordTitle } });

  await page.goto(`/pages/${pg.id}`);
  await page.getByText(recordTitle).click();
  const body = page.locator("[contenteditable='true']").first();
  await expect(body).toBeVisible();

  // AC3 : éditer le titre puis Échap → panneau OUVERT + titre réinitialisé (stopPropagation).
  await page.getByRole("heading", { name: recordTitle }).click();
  const titleInput = page.getByPlaceholder("Sans titre");
  await titleInput.fill("Titre modifié à annuler");
  await titleInput.press("Escape");
  await expect(body).toBeVisible();
  await expect(page.getByRole("heading", { name: recordTitle })).toBeVisible();

  // AC4 : Échap hors champ (focus retombé sur body) → le panneau se ferme.
  await page.keyboard.press("Escape");
  await expect(body).toBeHidden();
});
