import { test, expect, type Page } from "@playwright/test";

// Ticket : la case de multi-sélection des cartes (kanban) / lignes (table) est
// RONDE avec une coche au lieu du carré natif — composant partagé SelectCheckbox.

async function register(page: Page, tag: string) {
  const email = `${tag}-${Date.now()}@x.tld`;
  const reg = await page.request.post("/api/auth/register", {
    data: { firstName: "S", lastName: "C", displayName: "SC", email, password: "Test1234!" },
  });
  expect(reg.ok()).toBeTruthy();
  const workspaces = await (await page.request.get("/api/workspaces")).json();
  return workspaces[0].id as string;
}

async function seedKanban(page: Page) {
  const workspaceId = await register(page, "selcb");
  const pg = await (
    await page.request.post("/api/pages", { data: { workspaceId, title: "DB sélection" } })
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

test("multi-sélection kanban : case RONDE cochable + barre d'action groupée", async ({ page }) => {
  const { pageId, dbId, propId, viewId } = await seedKanban(page);
  const t1 = `Un ${Date.now()}`;
  const t2 = `Deux ${Date.now()}`;
  for (const t of [t1, t2]) {
    await page.request.post(`/api/databases/${dbId}/records`, {
      data: { title: t, properties: { [propId]: "a" } },
    });
  }
  await page.goto(`/pages/${pageId}?v=${viewId}`);

  const card1 = page.locator(".group.cursor-pointer").filter({ hasText: t1 });
  const card2 = page.locator(".group.cursor-pointer").filter({ hasText: t2 });
  await expect(card1).toBeVisible();

  const cb1 = card1.getByRole("checkbox", { name: "Sélectionner la carte" });
  // La case est RONDE (rounded-full) — plus la checkbox carrée native d'avant.
  await expect(cb1).toHaveClass(/rounded-full/);

  await card1.hover();
  await cb1.click();
  await expect(cb1).toHaveAttribute("aria-checked", "true");

  await card2.hover();
  await card2.getByRole("checkbox", { name: "Sélectionner la carte" }).click();

  // La barre d'action groupée (BulkActionBar) apparaît avec le compte de sélection.
  await expect(page.getByText("2 sélectionnés")).toBeVisible();
});
