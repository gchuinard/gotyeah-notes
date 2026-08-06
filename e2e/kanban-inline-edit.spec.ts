import { test, expect, type Page } from "@playwright/test";

// Ticket : édition inline sur la carte du board — titre au simple clic + valeurs
// de propriétés (« Main à », « Projet ») via le composant Cell, sans ouvrir le
// RecordPanel. Pendant l'édition d'un select, drag & ouverture du panneau sont
// neutralisés (comme isEditingTitle). Un clic neutre ouvre toujours le panneau.

async function register(page: Page, tag: string) {
  const email = `${tag}-${Date.now()}@x.tld`;
  const reg = await page.request.post("/api/auth/register", {
    data: { firstName: "C", lastName: "A", displayName: "CA", email, password: "Test1234!" },
  });
  expect(reg.ok()).toBeTruthy();
  const workspaces = await (await page.request.get("/api/workspaces")).json();
  return workspaces[0].id as string;
}

async function seed(page: Page) {
  const workspaceId = await register(page, "kb-inline");
  const pg = await (
    await page.request.post("/api/pages", { data: { workspaceId, title: "DB inline" } })
  ).json();
  const db = await (await page.request.post("/api/databases", { data: { pageId: pg.id } })).json();

  // Axe de regroupement (2 colonnes pour tester le drag).
  const statut = await (
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

  // « Main à » = select éditable en inline sur la carte.
  const mainA = await (
    await page.request.post(`/api/databases/${db.id}/properties`, {
      data: {
        name: "Main à",
        type: "select",
        config: {
          type: "select",
          options: [
            { id: "m1", name: "Alice", color: "purple" },
            { id: "m2", name: "Bob", color: "orange" },
          ],
        },
      },
    })
  ).json();

  const view = await (
    await page.request.post(`/api/databases/${db.id}/views`, {
      data: { name: "Board", type: "kanban", config: { groupByPropertyId: statut.id } },
    })
  ).json();

  return {
    pageId: pg.id as string,
    dbId: db.id as string,
    statutId: statut.id as string,
    mainAId: mainA.id as string,
    viewId: view.id as string,
  };
}

const column = (page: Page, label: string) => page.locator("[data-kanban-column]").filter({ hasText: label });
/** Marqueur « le RecordPanel est ouvert » (présent tant que le panneau est monté). */
const panelOpen = (page: Page) => page.getByTitle("Modèle de cette carte");

async function recordOf(page: Page, dbId: string, id: string) {
  const records = await (await page.request.get(`/api/databases/${dbId}/records`)).json();
  return records.find((r: { id: string }) => r.id === id);
}

// ─── AC1 / AC2 : titre au simple clic ────────────────────────────────────────

test("AC1 : simple clic sur le titre → édition inline focus, le panneau ne s'ouvre pas", async ({ page }) => {
  const { pageId, dbId, statutId, viewId } = await seed(page);
  const title = `Carte ${Date.now()}`;
  await page.request.post(`/api/databases/${dbId}/records`, {
    data: { title, properties: { [statutId]: "a" } },
  });

  await page.goto(`/pages/${pageId}?v=${viewId}`);
  const col = column(page, "Alpha");
  await expect(col.getByText(title, { exact: true })).toBeVisible();

  await col.getByText(title, { exact: true }).click();

  // Un champ d'édition apparaît, focus ; le RecordPanel n'est pas monté.
  await expect(col.getByRole("textbox")).toBeFocused();
  await expect(panelOpen(page)).toHaveCount(0);
});

test("AC2 : éditer le titre + Entrée → optimistic + persistance ; PATCH 500 → rollback", async ({ page }) => {
  const { pageId, dbId, statutId, viewId } = await seed(page);
  const title = `Carte ${Date.now()}`;
  const rec = await (
    await page.request.post(`/api/databases/${dbId}/records`, {
      data: { title, properties: { [statutId]: "a" } },
    })
  ).json();

  await page.goto(`/pages/${pageId}?v=${viewId}`);
  const col = column(page, "Alpha");
  await expect(col.getByText(title, { exact: true })).toBeVisible();

  const newTitle = `${title} édité`;
  const patched = page.waitForResponse(
    (r) => r.url().includes(`/api/records/${rec.id}`) && r.request().method() === "PATCH"
  );
  await col.getByText(title, { exact: true }).click();
  await col.getByRole("textbox").fill(newTitle);
  await col.getByRole("textbox").press("Enter");
  await patched;

  await expect(col.getByText(newTitle, { exact: true })).toBeVisible();
  expect((await recordOf(page, dbId, rec.id)).title).toBe(newTitle);

  // Rollback : le prochain PATCH échoue en 500 → l'affichage revient à l'ancien titre.
  await page.route(`**/api/records/${rec.id}`, (route) => {
    if (route.request().method() === "PATCH") return route.fulfill({ status: 500, body: "{}" });
    return route.continue();
  });
  const rolledBack = `${newTitle} ko`;
  await col.getByText(newTitle, { exact: true }).click();
  await col.getByRole("textbox").fill(rolledBack);
  await col.getByRole("textbox").press("Enter");

  await expect(col.getByText(newTitle, { exact: true })).toBeVisible();
  await expect(col.getByText(rolledBack, { exact: true })).toHaveCount(0);
});

// ─── AC3 : édition inline d'un select (« Main à ») ────────────────────────────

test("AC3 : simple clic sur « Main à » → dropdown ; choisir une option PATCH sans ouvrir le panneau", async ({ page }) => {
  const { pageId, dbId, statutId, mainAId, viewId } = await seed(page);
  const title = `Carte ${Date.now()}`;
  const rec = await (
    await page.request.post(`/api/databases/${dbId}/records`, {
      data: { title, properties: { [statutId]: "a", [mainAId]: "m1" } },
    })
  ).json();

  await page.goto(`/pages/${pageId}?v=${viewId}`);
  const col = column(page, "Alpha");
  const card = col.locator("div.group").filter({ hasText: title });
  await expect(card.getByText("Alice", { exact: true })).toBeVisible();

  // Clic sur la valeur → dropdown (option de remplacement visible).
  await card.getByText("Alice", { exact: true }).click();
  const patched = page.waitForResponse(
    (r) => r.url().includes(`/api/records/${rec.id}`) && r.request().method() === "PATCH"
  );
  await page.getByRole("button", { name: "Bob" }).click();
  await patched;

  await expect(card.getByText("Bob", { exact: true })).toBeVisible();
  await expect(panelOpen(page)).toHaveCount(0);
  expect((await recordOf(page, dbId, rec.id)).properties[mainAId]).toBe("m2");
});

// ─── AC5 : édition d'un select bloque drag & ouverture du panneau ─────────────

test("AC5 : dropdown ouvert → un drag de la carte ne change pas sa colonne, le panneau ne s'ouvre pas", async ({ page }) => {
  const { pageId, dbId, statutId, mainAId, viewId } = await seed(page);
  const title = `Carte ${Date.now()}`;
  const rec = await (
    await page.request.post(`/api/databases/${dbId}/records`, {
      data: { title, properties: { [statutId]: "a", [mainAId]: "m1" } },
    })
  ).json();

  await page.goto(`/pages/${pageId}?v=${viewId}`);
  const alpha = column(page, "Alpha");
  const beta = column(page, "Beta");
  const card = alpha.locator("div.group").filter({ hasText: title });

  // Ouvre l'édition inline du select.
  await card.getByText("Alice", { exact: true }).click();
  await expect(page.getByRole("button", { name: "Bob" })).toBeVisible();

  // Tenter un drag de la carte vers Beta : listeners neutralisés → pas de déplacement.
  const cb = (await card.boundingBox())!;
  const tb = (await beta.boundingBox())!;
  await page.mouse.move(cb.x + cb.width / 2, cb.y + 8);
  await page.mouse.down();
  await page.mouse.move(cb.x + cb.width / 2 + 20, cb.y + 20, { steps: 5 });
  await page.mouse.move(tb.x + tb.width / 2, tb.y + 60, { steps: 10 });
  await page.mouse.up();

  // La carte reste dans Alpha ; le sprint/colonne n'a pas changé côté serveur.
  await expect(alpha.getByText(title, { exact: true })).toBeVisible();
  await expect(beta.getByText(title, { exact: true })).toHaveCount(0);
  expect((await recordOf(page, dbId, rec.id)).properties[statutId]).toBe("a");
  await expect(panelOpen(page)).toHaveCount(0);
});

// ─── AC6 : clic sur une zone neutre → ouverture du RecordPanel ────────────────

test("AC6 : clic sur une zone neutre de la carte (hors titre/valeur) → le RecordPanel s'ouvre", async ({ page }) => {
  const { pageId, dbId, statutId, mainAId, viewId } = await seed(page);
  const title = `Carte ${Date.now()}`;
  await page.request.post(`/api/databases/${dbId}/records`, {
    data: { title, properties: { [statutId]: "a", [mainAId]: "m1" } },
  });

  await page.goto(`/pages/${pageId}?v=${viewId}`);
  const col = column(page, "Alpha");
  const card = col.locator("div.group").filter({ hasText: title });
  await expect(card).toBeVisible();

  // Zone neutre = padding bas de la carte (ni titre, ni valeur, ni action).
  const box = (await card.boundingBox())!;
  await page.mouse.click(box.x + box.width / 2, box.y + box.height - 3);

  await expect(panelOpen(page)).toBeVisible();
});
