import { test, expect, type Page } from "@playwright/test";

// Ticket : sur une carte kanban, le renommage inline passe du clic SIMPLE au
// DOUBLE-clic (demande du 09/08/2026). Viser le titre pour ouvrir une carte
// faisait entrer en édition sans l'avoir demandé.
//
// Le point délicat n'est pas le double-clic, c'est le clic simple : un
// double-clic émet DEUX `click` avant le `dblclick`, donc l'ouverture du
// panneau est différée le temps de voir venir un second clic. Ces deux tests
// verrouillent les deux branches — sans le premier, on pourrait « corriger »
// en supprimant purement le clic simple, et le titre deviendrait une zone morte.

async function seedBoard(page: Page, tag: string) {
  const email = `${tag}-${Date.now()}@x.tld`;
  const reg = await page.request.post("/api/auth/register", {
    data: { firstName: "K", lastName: "T", displayName: "Kanban", email, password: "Test1234!" },
  });
  expect(reg.ok()).toBeTruthy();
  const workspaceId = (await (await page.request.get("/api/workspaces")).json())[0].id;

  const pg = await (
    await page.request.post("/api/pages", { data: { workspaceId, title: "DB kanban titre" } })
  ).json();
  const db = await (await page.request.post("/api/databases", { data: { pageId: pg.id } })).json();
  const prop = await (
    await page.request.post(`/api/databases/${db.id}/properties`, {
      data: {
        name: "Statut",
        type: "select",
        config: { type: "select", options: [{ id: "a", name: "Alpha", color: "blue" }] },
      },
    })
  ).json();
  const view = await (
    await page.request.post(`/api/databases/${db.id}/views`, {
      data: { name: "Board", type: "kanban", config: { groupByPropertyId: prop.id } },
    })
  ).json();
  const rec = await (
    await page.request.post(`/api/databases/${db.id}/records`, {
      data: { title: "Carte à renommer", properties: { [prop.id]: "a" } },
    })
  ).json();

  return { pageId: pg.id as string, dbId: db.id as string, viewId: view.id as string, recId: rec.id as string };
}

/** Marqueur « le RecordPanel est ouvert » — même repère que record-history.spec.ts. */
const panelOpen = (page: Page) => page.getByTitle("Modèle de cette carte");

/** Le titre sur la CARTE (pas celui du panneau, qui porte le même texte). */
const cardTitle = (page: Page) => page.getByTitle("Double-cliquer pour renommer");

test("kanban : un clic SIMPLE sur le titre ouvre la carte et ne renomme pas", async ({ page }) => {
  const { pageId, viewId } = await seedBoard(page, "kb-title-single");

  await page.goto(`/pages/${pageId}?v=${viewId}`);
  // L'hydratation doit être finie : un clic parti trop tôt n'atteint aucun handler.
  await page.waitForLoadState("networkidle");
  await expect(cardTitle(page)).toBeVisible();

  await cardTitle(page).click();

  // Le panneau s'ouvre — après le report de 300 ms, d'où l'attente explicite.
  await expect(panelOpen(page)).toBeVisible();
  // Et AUCUN champ de renommage inline n'est apparu sur la carte.
  await expect(page.locator("[data-card-title-input]")).toHaveCount(0);
});

test("kanban : un DOUBLE-clic sur le titre renomme sans ouvrir la carte", async ({ page }) => {
  const { pageId, dbId, viewId, recId } = await seedBoard(page, "kb-title-double");

  await page.goto(`/pages/${pageId}?v=${viewId}`);
  await page.waitForLoadState("networkidle");
  await expect(cardTitle(page)).toBeVisible();

  await cardTitle(page).dblclick();

  // L'éditeur inline prend la place du titre, avec la valeur courante sélectionnée.
  // ⚠️ Repère STABLE, pas `input[value='…']` : ce sélecteur cesse de
  // correspondre dès que la valeur change, et la suite du test ne trouve plus
  // rien après le `fill()`.
  const input = page.locator("[data-card-title-input]");
  await expect(input).toBeVisible();
  await expect(input).toHaveValue("Carte à renommer");

  // ⚠️ Le panneau ne doit PAS s'être ouvert : c'est tout l'objet du report.
  // Sans lui, le premier des deux clics l'aurait déjà ouvert.
  await expect(panelOpen(page)).toHaveCount(0);

  // Le renommage aboutit côté serveur.
  const saved = page.waitForResponse(
    (r) => r.url().includes(`/api/records/${recId}`) && r.request().method() === "PATCH"
  );
  await input.fill("Titre renommé");
  await input.press("Enter");
  await saved;

  const records = await (await page.request.get(`/api/databases/${dbId}/records`)).json();
  expect(records.find((r: { id: string }) => r.id === recId).title).toBe("Titre renommé");

  // Le panneau ne s'est pas ouvert non plus APRÈS coup : le timer différé doit
  // avoir été annulé, pas simplement devancé.
  await expect(panelOpen(page)).toHaveCount(0);
});
