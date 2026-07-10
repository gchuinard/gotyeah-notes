import { test, expect } from "@playwright/test";

test("Cmd+K : un record remonte (marqueur « fiche ») et Entrée ouvre /pages/<pageId>?r=<recordId>", async ({ page }) => {
  const email = `cmdk-${Date.now()}@x.tld`;
  const recordTitle = `TicketCmdK ${Date.now()}`;

  const reg = await page.request.post("/api/auth/register", {
    data: { firstName: "C", lastName: "K", displayName: "CK", email, password: "Test1234!" },
  });
  expect(reg.ok()).toBeTruthy();
  const workspaceId = (await (await page.request.get("/api/workspaces")).json())[0].id;

  const pg = await (
    await page.request.post("/api/pages", { data: { workspaceId, title: "DB cmdk" } })
  ).json();
  const db = await (await page.request.post("/api/databases", { data: { pageId: pg.id } })).json();
  const rec = await (
    await page.request.post(`/api/databases/${db.id}/records`, { data: { title: recordTitle } })
  ).json();

  await page.goto(`/pages/${pg.id}`);
  // Attendre l'hydratation (listener Cmd+K attaché) via un élément client de la sidebar.
  await expect(page.getByRole("link", { name: "Accueil" })).toBeVisible();

  // Ouvrir la palette (Cmd/Ctrl+K).
  await page.keyboard.press("Control+k");
  const input = page.getByPlaceholder("Rechercher une page ou une fiche…");
  await expect(input).toBeVisible();
  await input.fill(recordTitle);

  // Le record apparaît avec le marqueur « fiche ».
  const item = page.getByRole("listitem").filter({ hasText: recordTitle });
  await expect(item).toBeVisible();
  await expect(item.getByText("fiche")).toBeVisible();

  // Entrée → deep-link vers la page hôte + ouverture du RecordPanel.
  await input.press("Enter");
  await page.waitForURL((url) => url.pathname === `/pages/${pg.id}` && url.searchParams.get("r") === rec.id);
  await expect(page.getByRole("heading", { name: recordTitle })).toBeVisible();
});
