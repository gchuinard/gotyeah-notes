import { test, expect, type Page } from "@playwright/test";

// Ticket : le menu ⋯ des cartes (kanban) et des lignes (backlog) est remplacé par
// 2 icônes directes — Dupliquer (immédiat, sans confirmation) et Supprimer (popup
// maison useDialog().confirm) — via le composant partagé CardActions.

async function register(page: Page, tag: string) {
  const email = `${tag}-${Date.now()}@x.tld`;
  const reg = await page.request.post("/api/auth/register", {
    data: { firstName: "C", lastName: "A", displayName: "CA", email, password: "Test1234!" },
  });
  expect(reg.ok()).toBeTruthy();
  const workspaces = await (await page.request.get("/api/workspaces")).json();
  return workspaces[0].id as string;
}

async function seedKanban(page: Page) {
  const workspaceId = await register(page, "ca-kanban");
  const pg = await (
    await page.request.post("/api/pages", { data: { workspaceId, title: "DB kanban" } })
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
  return { pageId: pg.id as string, dbId: db.id as string, propId: prop.id as string, viewId: view.id as string };
}

async function seedBacklog(page: Page) {
  const workspaceId = await register(page, "ca-backlog");
  const pg = await (
    await page.request.post("/api/pages", { data: { workspaceId, title: "DB backlog" } })
  ).json();
  const db = await (await page.request.post("/api/databases", { data: { pageId: pg.id } })).json();
  const view = await (
    await page.request.post(`/api/databases/${db.id}/views`, {
      data: { name: "Backlog", type: "backlog", config: {} },
    })
  ).json();
  return { pageId: pg.id as string, dbId: db.id as string, viewId: view.id as string };
}

const dialog = (page: Page) => page.getByRole("dialog");
/** Marqueur « le RecordPanel est ouvert » (présent tant que le panneau est monté). */
const panelOpen = (page: Page) => page.getByTitle("Modèle de cette carte");

// ─── Kanban ────────────────────────────────────────────────────────────────────

test("kanban : au survol, 2 icônes directes ; Dupliquer clone sans dialog ni RecordPanel", async ({ page }) => {
  const { pageId, dbId, propId, viewId } = await seedKanban(page);
  const title = `Carte ${Date.now()}`;
  await page.request.post(`/api/databases/${dbId}/records`, {
    data: { title, properties: { [propId]: "a" } },
  });

  await page.goto(`/pages/${pageId}?v=${viewId}`);
  const column = page.locator("[data-kanban-column]").filter({ hasText: "Alpha" });
  const card = column.getByText(title, { exact: true });
  await expect(card).toBeVisible();

  // AC1/AC5 : 2 icônes directes, plus aucun bouton de menu ⋯ (Options).
  await card.hover();
  await expect(column.getByLabel("Dupliquer")).toBeVisible();
  await expect(column.getByLabel("Supprimer")).toBeVisible();
  await expect(column.getByTitle("Options")).toHaveCount(0);

  // AC2 : Dupliquer → clone immédiat « (copie) », SANS dialog, sans ouvrir le panneau.
  const dup = page.waitForResponse(
    (r) => r.url().includes("/duplicate") && r.request().method() === "POST"
  );
  await column.getByLabel("Dupliquer").click();
  await dup;
  await expect(dialog(page)).toHaveCount(0);
  await expect(panelOpen(page)).toHaveCount(0);
  await expect(column.getByText(`${title} (copie)`, { exact: true })).toBeVisible();
});

test("kanban : Supprimer ouvre la popup maison — Annuler conserve, Confirmer retire", async ({ page }) => {
  const { pageId, dbId, propId, viewId } = await seedKanban(page);
  const title = `Carte ${Date.now()}`;
  await page.request.post(`/api/databases/${dbId}/records`, {
    data: { title, properties: { [propId]: "a" } },
  });

  await page.goto(`/pages/${pageId}?v=${viewId}`);
  const column = page.locator("[data-kanban-column]").filter({ hasText: "Alpha" });
  const card = column.getByText(title, { exact: true });
  await expect(card).toBeVisible();

  // Annuler → la carte reste, et l'icône n'a pas ouvert le RecordPanel.
  await card.hover();
  await column.getByLabel("Supprimer").click();
  await expect(dialog(page)).toBeVisible();
  await dialog(page).getByRole("button", { name: "Annuler" }).click();
  await expect(dialog(page)).toBeHidden();
  await expect(card).toBeVisible();
  await expect(panelOpen(page)).toHaveCount(0);

  // Confirmer → la carte disparaît.
  await card.hover();
  await column.getByLabel("Supprimer").click();
  await dialog(page).getByRole("button", { name: "Supprimer" }).click();
  await expect(dialog(page)).toBeHidden();
  await expect(card).toHaveCount(0);
});

// ─── Backlog ─────────────────────────────────────────────────────────────────

test("backlog : au survol d'une ligne, 2 icônes directes ; Dupliquer clone sans dialog", async ({ page }) => {
  const { pageId, dbId, viewId } = await seedBacklog(page);
  const title = `Issue ${Date.now()}`;
  await page.request.post(`/api/databases/${dbId}/records`, { data: { title } });

  await page.goto(`/pages/${pageId}?v=${viewId}`);
  const row = page.locator("div.group").filter({ hasText: title });
  await expect(row).toBeVisible();

  // AC4/AC5 : mêmes icônes que le kanban, plus aucun menu ⋯.
  await row.hover();
  await expect(row.getByRole("button", { name: "Dupliquer" })).toBeVisible();
  await expect(row.getByRole("button", { name: "Supprimer" })).toBeVisible();
  await expect(row.getByTitle("Options")).toHaveCount(0);

  // AC4 : Dupliquer → clone immédiat, SANS dialog, sans ouvrir le panneau.
  const dup = page.waitForResponse(
    (r) => r.url().includes("/duplicate") && r.request().method() === "POST"
  );
  await row.getByRole("button", { name: "Dupliquer" }).click();
  await dup;
  await expect(dialog(page)).toHaveCount(0);
  await expect(panelOpen(page)).toHaveCount(0);
  await expect(page.getByText(`${title} (copie)`, { exact: true })).toBeVisible();
});

test("backlog : Supprimer ouvre la popup maison — Confirmer retire la ligne", async ({ page }) => {
  const { pageId, dbId, viewId } = await seedBacklog(page);
  const title = `Issue ${Date.now()}`;
  await page.request.post(`/api/databases/${dbId}/records`, { data: { title } });

  await page.goto(`/pages/${pageId}?v=${viewId}`);
  const row = page.locator("div.group").filter({ hasText: title });
  await expect(row).toBeVisible();

  // Annuler → la ligne reste.
  await row.hover();
  await row.getByRole("button", { name: "Supprimer" }).click();
  await expect(dialog(page)).toBeVisible();
  await dialog(page).getByRole("button", { name: "Annuler" }).click();
  await expect(dialog(page)).toBeHidden();
  await expect(row).toBeVisible();

  // Confirmer → la ligne disparaît.
  await row.hover();
  await row.getByRole("button", { name: "Supprimer" }).click();
  await dialog(page).getByRole("button", { name: "Supprimer" }).click();
  await expect(dialog(page)).toBeHidden();
  await expect(page.getByText(title, { exact: true })).toHaveCount(0);
});
