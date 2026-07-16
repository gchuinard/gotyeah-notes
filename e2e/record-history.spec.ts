import { test, expect, type Page } from "@playwright/test";

// Ticket : onglet « Historique » dans le RecordPanel. Une piste d'audit qui/quoi/quand
// des révisions s'affiche sans fermer le panneau ; l'onglet « Contenu » reste le défaut
// à l'ouverture. Les révisions sont écrites côté serveur au PATCH /api/records/[id].

async function register(page: Page, tag: string) {
  const email = `${tag}-${Date.now()}@x.tld`;
  const reg = await page.request.post("/api/auth/register", {
    data: { firstName: "H", lastName: "I", displayName: "Historien", email, password: "Test1234!" },
  });
  expect(reg.ok()).toBeTruthy();
  const workspaces = await (await page.request.get("/api/workspaces")).json();
  return workspaces[0].id as string;
}

/** Marqueur « le RecordPanel est monté » (bouton présent tant que le panneau est ouvert). */
const panelOpen = (page: Page) => page.getByTitle("Modèle de cette carte");

test("RecordPanel : onglet Historique affiche qui/quoi/quand ; l'onglet Contenu reste le défaut", async ({ page }) => {
  const workspaceId = await register(page, "rec-hist");
  const pg = await (
    await page.request.post("/api/pages", { data: { workspaceId, title: "DB historique" } })
  ).json();
  const db = await (await page.request.post("/api/databases", { data: { pageId: pg.id } })).json();
  const rec = await (
    await page.request.post(`/api/databases/${db.id}/records`, { data: { title: "V1" } })
  ).json();

  // Génère une révision côté serveur (field=title, acteur = utilisateur enregistré).
  const patched = await page.request.patch(`/api/records/${rec.id}`, { data: { title: "V2" } });
  expect(patched.ok()).toBeTruthy();

  await page.goto(`/pages/${pg.id}`);
  await page.getByText("V2", { exact: true }).click();

  // À l'ouverture : onglet « Contenu » actif → le corps (éditeur) est visible,
  // et aucune entrée d'historique n'est encore montée.
  await expect(panelOpen(page)).toBeVisible();
  const body = page.locator("[contenteditable='true']").first();
  await expect(body).toBeVisible();
  const historyEntry = page.locator("li").filter({ hasText: "a modifié" });
  await expect(historyEntry).toHaveCount(0);

  // Bascule sur « Historique » → l'entrée qui/quoi s'affiche, panneau toujours ouvert.
  await page.getByRole("button", { name: "Historique" }).click();
  await expect(historyEntry).toHaveCount(1);
  await expect(historyEntry).toContainText("Historien"); // qui
  await expect(historyEntry).toContainText("Titre"); // quoi
  await expect(panelOpen(page)).toBeVisible(); // le panneau ne s'est pas fermé

  // Retour sur « Contenu » → l'éditeur est de nouveau visible (instance préservée).
  await page.getByRole("button", { name: "Contenu" }).click();
  await expect(body).toBeVisible();
});
