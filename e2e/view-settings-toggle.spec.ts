import { test, expect, type Page } from "@playwright/test";
import { register } from "./helpers/auth";

// Le flag View.config.createInUnassignedOnly était respecté par le kanban mais
// AUCUN écran ne l'écrivait : il fallait éditer le config à la main. Ce spec
// couvre l'interrupteur ajouté au menu ⋯ de l'onglet de vue.

async function seedKanban(page: Page, tag: string) {
  const { workspaceId } = await register(page, tag);
  const pg = await (
    await page.request.post("/api/pages", { data: { workspaceId, title: "DB réglages" } })
  ).json();
  const db = await (await page.request.post("/api/databases", { data: { pageId: pg.id } })).json();
  const prop = await (
    await page.request.post(`/api/databases/${db.id}/properties`, {
      data: {
        name: "Statut",
        type: "select",
        config: {
          type: "select",
          options: [
            { id: "a", name: "Alpha", color: "blue" },
            { id: "b", name: "Beta", color: "green" },
          ],
        },
      },
    })
  ).json();
  const view = await (
    await page.request.post(`/api/databases/${db.id}/views`, {
      data: { name: "Board", type: "kanban", config: { groupByPropertyId: prop.id } },
    })
  ).json();
  return { pageId: pg.id as string, dbId: db.id as string, viewId: view.id as string };
}

const configOf = async (page: Page, dbId: string, viewId: string) => {
  const db = await (await page.request.get(`/api/databases/${dbId}`)).json();
  return db.views.find((v: { id: string }) => v.id === viewId).config;
};

// Les onglets suivent l'ordre des positions : [Vue principale (table), Board].
// Le bouton ⋯ n'apparaît qu'au survol de SON onglet.
const openTabMenu = async (page: Page, index: number) => {
  const tab = page.locator('button[title="Options"]').nth(index);
  await page.getByRole("button", { name: index === 0 ? "Vue principale" : "Board" }).first().hover();
  await tab.click();
};

test("kanban : la bascule « Créer seulement dans Sans valeur » écrit le config et change le board", async ({
  page,
}) => {
  const { pageId, dbId, viewId } = await seedKanban(page, "viewset");

  await page.goto(`/pages/${pageId}?v=${viewId}`);
  // Départ : le bouton est sur chaque colonne (Sans valeur, Alpha, Beta).
  await expect(page.getByRole("button", { name: "Nouveau" })).toHaveCount(3);
  expect((await configOf(page, dbId, viewId)).createInUnassignedOnly).toBeUndefined();

  const patched = page.waitForResponse(
    (r) => r.url().includes(`/api/views/${viewId}`) && r.request().method() === "PATCH"
  );
  await openTabMenu(page, 1);
  await page.getByText("Créer seulement dans « Sans valeur »").click();
  expect((await patched).status()).toBe(200);

  // Le flag est persisté ET le groupBy n'a pas été perdu (le PATCH d'un config
  // est un remplacement TOTAL : réémettre le config partiel effacerait l'axe).
  const config = await configOf(page, dbId, viewId);
  expect(config.createInUnassignedOnly).toBe(true);
  expect(config.groupByPropertyId).toBeTruthy();

  await expect(page.getByRole("button", { name: "Nouveau" })).toHaveCount(1);

  // Re-cliquer rétablit l'état initial (c'est une bascule, pas un aller simple).
  const reverted = page.waitForResponse(
    (r) => r.url().includes(`/api/views/${viewId}`) && r.request().method() === "PATCH"
  );
  await openTabMenu(page, 1);
  await page.getByText("Créer seulement dans « Sans valeur »").click();
  expect((await reverted).status()).toBe(200);
  expect((await configOf(page, dbId, viewId)).createInUnassignedOnly).toBe(false);
  await expect(page.getByRole("button", { name: "Nouveau" })).toHaveCount(3);
});

test("le réglage n'est proposé que sur une vue kanban", async ({ page }) => {
  const { pageId, dbId } = await seedKanban(page, "viewset-table");

  const views = (await (await page.request.get(`/api/databases/${dbId}`)).json()).views;
  const table = views.find((v: { type: string }) => v.type === "table");

  await page.goto(`/pages/${pageId}?v=${table.id}`);
  await openTabMenu(page, 0);
  await expect(page.getByText("Renommer")).toBeVisible();
  await expect(page.getByText("Créer seulement dans « Sans valeur »")).toHaveCount(0);
});
