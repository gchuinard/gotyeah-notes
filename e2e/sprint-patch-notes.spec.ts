import { test, expect } from "@playwright/test";

async function register(page: import("@playwright/test").Page, tag: string) {
  const email = `${tag}-${Date.now()}@x.tld`;
  const reg = await page.request.post("/api/auth/register", {
    data: { firstName: "A", lastName: "S", displayName: "AS", email, password: "Test1234!" },
  });
  expect(reg.ok()).toBeTruthy();
  const workspaces = await (await page.request.get("/api/workspaces")).json();
  return workspaces[0].id as string;
}

// Ticket 8 : à la clôture d'un sprint, les notes de version sont auto-appendées à
// la page « Patch notes » mappée. E2E de bout en bout : câblage + clôture par API,
// puis lecture visuelle du bloc daté rendu dans l'éditeur BlockNote de la page.
test("Patch notes : clôture de sprint → bloc daté auto-appendé à la page mappée", async ({ page }) => {
  const workspaceId = await register(page, "patchnotes");

  // Page hôte convertie en database.
  const dbPage = await (
    await page.request.post("/api/pages", { data: { workspaceId, title: "Backlog E2E" } })
  ).json();
  const db = await (
    await page.request.post("/api/databases", { data: { pageId: dbPage.id } })
  ).json();

  // Page « Patch notes » + mapping database → page.
  const patchPage = await (
    await page.request.post("/api/pages", { data: { workspaceId, title: "📓 Patch notes" } })
  ).json();
  const mapped = await page.request.patch(`/api/databases/${db.id}`, {
    data: { patchNotesPageId: patchPage.id },
  });
  expect(mapped.ok()).toBeTruthy();

  // Sprint actif + une issue livrée.
  const sprint = await (
    await page.request.post(`/api/databases/${db.id}/sprints`, {
      data: { name: "Sprint E2E", state: "active" },
    })
  ).json();
  await page.request.post(`/api/databases/${db.id}/records`, {
    data: { title: "Feature E2E", sprintId: sprint.id },
  });

  // Clôture → append transactionnel dans la page.
  const closed = await page.request.patch(`/api/sprints/${sprint.id}`, {
    data: { state: "completed" },
  });
  expect(closed.ok()).toBeTruthy();
  expect((await closed.json()).patchNotesAppend).toBe("appended");

  // Lecture visuelle : le bloc daté est rendu dans l'éditeur de la page.
  await page.goto(`/pages/${patchPage.id}`);
  await expect(page.getByText("Sprint E2E", { exact: false })).toBeVisible();
  await expect(page.getByText("Feature E2E", { exact: false })).toBeVisible();
});
