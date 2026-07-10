import { test, expect } from "@playwright/test";

test("deep-link ?r : ouverture cold-load, fermeture, reload", async ({ page }) => {
  const email = `deeplink-${Date.now()}@x.tld`;
  const title = `DeepLinkCible ${Date.now()}`;

  // Auth + fixture (page → database → record) via l'API.
  const reg = await page.request.post("/api/auth/register", {
    data: { firstName: "D", lastName: "L", displayName: "DL", email, password: "Test1234!" },
  });
  expect(reg.ok()).toBeTruthy();

  const workspaces = await (await page.request.get("/api/workspaces")).json();
  const workspaceId = workspaces[0].id;

  const pg = await (await page.request.post("/api/pages", { data: { workspaceId, title: "DB deeplink" } })).json();
  const pageId = pg.id;

  const db = await (await page.request.post("/api/databases", { data: { pageId } })).json();
  const databaseId = db.id;
  const viewId = db.views[0].id;

  const rec = await (await page.request.post(`/api/databases/${databaseId}/records`, { data: { title } })).json();
  const recordId = rec.id;

  const heading = page.getByRole("heading", { name: title });

  // Cold load : ?r ouvre le RecordPanel de R.
  await page.goto(`/pages/${pageId}?v=${viewId}&r=${recordId}`);
  await expect(heading).toBeVisible();

  // Fermeture (Échap) : ?r retiré (panneau fermé), ?v conservé.
  await page.keyboard.press("Escape");
  await expect(heading).toBeHidden();
  expect(page.url()).toContain(`v=${viewId}`);
  expect(page.url()).not.toContain(`r=${recordId}`);

  // Reload de l'URL ?r : le panneau se rouvre (persistance / partageabilité).
  await page.goto(`/pages/${pageId}?v=${viewId}&r=${recordId}`);
  await expect(heading).toBeVisible();
});
