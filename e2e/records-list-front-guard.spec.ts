import { test, expect } from "@playwright/test";

// Garde-fou : GET /api/databases/[id]/records SANS query param doit rester la
// réponse intégrale historique — le front (SWR + applyViewConfig) ne doit pas
// être impacté par l'ajout des params optionnels (filtre/pagination/projection).
test("garde-fou front : la vue table rend ses records (réponse par défaut inchangée)", async ({ page }) => {
  const email = `reclist-${Date.now()}@x.tld`;
  const alpha = `Alpha ${Date.now()}`;
  const beta = `Beta ${Date.now()}`;

  const reg = await page.request.post("/api/auth/register", {
    data: { firstName: "R", lastName: "L", displayName: "RL", email, password: "Test1234!" },
  });
  expect(reg.ok()).toBeTruthy();
  const workspaceId = (await (await page.request.get("/api/workspaces")).json())[0].id;

  const pg = await (
    await page.request.post("/api/pages", { data: { workspaceId, title: "DB reclist" } })
  ).json();
  const db = await (await page.request.post("/api/databases", { data: { pageId: pg.id } })).json();
  await page.request.post(`/api/databases/${db.id}/records`, { data: { title: alpha } });
  await page.request.post(`/api/databases/${db.id}/records`, { data: { title: beta } });

  await page.goto(`/pages/${pg.id}`);

  // Les deux records sont rendus dans la table.
  await expect(page.getByText(alpha)).toBeVisible();
  await expect(page.getByText(beta)).toBeVisible();

  // Le corps du record est bien servi par défaut (ouverture du panneau → éditeur).
  await page.getByText(alpha).click();
  await expect(page.locator("[contenteditable='true']").first()).toBeVisible();
});
