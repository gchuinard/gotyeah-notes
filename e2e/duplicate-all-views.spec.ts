import { test, expect, type Page } from "@playwright/test";
import { register, joinWorkspace } from "./helpers/auth";

// Dupliquer — phase B : l'action existait côté serveur (POST /records/[id]/duplicate)
// et n'était câblée que dans Kanban et Backlog. Ce spec couvre les trois vues
// restantes. La copie est SERVEUR : on vérifie donc la carte créée en base, pas
// seulement l'affichage.

async function seed(page: Page, tag: string) {
  const { workspaceId } = await register(page, tag);

  const pg = await (
    await page.request.post("/api/pages", { data: { workspaceId, title: `DB ${tag}` } })
  ).json();
  const db = await (await page.request.post("/api/databases", { data: { pageId: pg.id } })).json();
  const date = await (
    await page.request.post(`/api/databases/${db.id}/properties`, {
      data: { name: "Échéance", type: "date", config: { type: "date", includeTime: false } },
    })
  ).json();

  const today = new Date();
  const iso = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-15`;
  await page.request.post(`/api/databases/${db.id}/records`, {
    data: { title: "Ticket source", properties: { [date.id]: iso } },
  });

  return { pageId: pg.id as string, dbId: db.id as string, datePropId: date.id as string };
}

const titles = async (page: Page, dbId: string) => {
  const records = await (await page.request.get(`/api/databases/${dbId}/records`)).json();
  return records.map((r: { title: string }) => r.title);
};

test("table : le bouton dupliquer d'une ligne crée une copie serveur", async ({ page }) => {
  const { pageId, dbId } = await seed(page, "dup-table");

  await page.goto(`/pages/${pageId}`);
  await expect(page.getByText("Ticket source")).toBeVisible();

  const created = page.waitForResponse(
    (r) => r.url().includes("/duplicate") && r.request().method() === "POST"
  );
  await page.getByRole("row").filter({ hasText: "Ticket source" }).hover();
  await page.getByRole("button", { name: "Dupliquer" }).first().click();
  expect((await created).status()).toBe(201);

  expect(await titles(page, dbId)).toEqual(["Ticket source", "Ticket source (copie)"]);
  // Le bouton Supprimer de la LIGNE survit à l'arrivée du bouton Dupliquer.
  // ⚠️ Scopé à la ligne : la sidebar rend elle aussi un bouton « Supprimer »
  // par page, et un locator global passerait au vert même sans ce bouton-ci.
  await expect(
    page
      .getByRole("row")
      .filter({ hasText: "Ticket source (copie)" })
      .getByRole("button", { name: "Supprimer" })
  ).toBeAttached();
});

test("galerie : dupliquer depuis la carte", async ({ page }) => {
  const { pageId, dbId } = await seed(page, "dup-gallery");

  const views = (await (await page.request.get(`/api/databases/${dbId}`)).json()).views;
  const gallery = await (
    await page.request.post(`/api/databases/${dbId}/views`, {
      data: { name: "Galerie", type: "gallery", config: {} },
    })
  ).json();
  expect(views.length).toBeGreaterThan(0);

  await page.goto(`/pages/${pageId}?v=${gallery.id}`);
  await expect(page.getByText("Ticket source")).toBeVisible();

  const created = page.waitForResponse(
    (r) => r.url().includes("/duplicate") && r.request().method() === "POST"
  );
  await page.getByRole("button", { name: "Dupliquer" }).first().click();
  expect((await created).status()).toBe(201);

  expect(await titles(page, dbId)).toEqual(["Ticket source", "Ticket source (copie)"]);
  await expect(page.getByText("Ticket source (copie)")).toBeVisible();
});

test("calendrier : dupliquer depuis la pilule d'un jour", async ({ page }) => {
  const { pageId, dbId, datePropId } = await seed(page, "dup-calendar");

  const calendar = await (
    await page.request.post(`/api/databases/${dbId}/views`, {
      data: { name: "Calendrier", type: "calendar", config: { calendarPropertyId: datePropId } },
    })
  ).json();

  await page.goto(`/pages/${pageId}?v=${calendar.id}`);
  await expect(page.getByText("Ticket source")).toBeVisible();

  const created = page.waitForResponse(
    (r) => r.url().includes("/duplicate") && r.request().method() === "POST"
  );
  await page.getByRole("button", { name: "Dupliquer" }).first().click();
  expect((await created).status()).toBe(201);

  // La copie hérite de la date : elle atterrit dans la même case du calendrier.
  expect(await titles(page, dbId)).toEqual(["Ticket source", "Ticket source (copie)"]);
  await expect(page.getByText("Ticket source (copie)")).toBeVisible();
});

test("lecture seule : aucune action de duplication n'est proposée", async ({ page, browser }) => {
  const a = await register(page, "dup-ro-a", "Alice Admin");
  const ctxB = await browser.newContext();
  const pageB = await ctxB.newPage();
  const b = await register(pageB, "dup-ro-b", "Bob Lecteur");

  await joinWorkspace(page, pageB, a.workspaceId, b.email, "viewer");
  await pageB.request.post(`/api/workspaces/${a.workspaceId}/switch`);

  const sections = await (
    await page.request.get(`/api/sections?workspaceId=${a.workspaceId}`)
  ).json();
  const team = sections.find((s: { type: string }) => s.type === "team");
  const pg = await (
    await page.request.post("/api/pages", {
      data: { workspaceId: a.workspaceId, title: "DB RO", sectionId: team.id },
    })
  ).json();
  const db = await (await page.request.post("/api/databases", { data: { pageId: pg.id } })).json();
  await page.request.post(`/api/databases/${db.id}/records`, { data: { title: "Ticket source" } });

  const gallery = await (
    await page.request.post(`/api/databases/${db.id}/views`, {
      data: { name: "Galerie", type: "gallery", config: {} },
    })
  ).json();

  await pageB.goto(`/pages/${pg.id}?v=${gallery.id}`);
  await expect(pageB.getByText("Ticket source")).toBeVisible();
  await expect(pageB.getByRole("button", { name: "Dupliquer" })).toHaveCount(0);

  await ctxB.close();
});
