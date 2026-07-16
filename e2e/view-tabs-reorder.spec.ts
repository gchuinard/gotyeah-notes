import { test, expect, type Page } from "@playwright/test";

// Ticket 7 — réordonnancement des onglets de vues d'une database par glisser-déposer.
// Ordre PARTAGÉ (View.position en base). Un seul PATCH /api/views/[id] { position }
// sur la vue déplacée, optimistic + rollback, clic (<6px) ≠ drag (>6px).

/** Auth + database avec 3 vues : « Vue principale » (table), « Vue B » (kanban), « Vue C » (calendar). */
async function seed(page: Page) {
  const email = `vtabs-${Date.now()}@x.tld`;
  const reg = await page.request.post("/api/auth/register", {
    data: { firstName: "V", lastName: "T", displayName: "VT", email, password: "Test1234!" },
  });
  expect(reg.ok()).toBeTruthy();
  const workspaceId = (await (await page.request.get("/api/workspaces")).json())[0].id;

  const pg = await (
    await page.request.post("/api/pages", { data: { workspaceId, title: "DB onglets" } })
  ).json();
  const db = await (await page.request.post("/api/databases", { data: { pageId: pg.id } })).json();

  const vA = db.views[0]; // « Vue principale », position 1000
  const vB = await (
    await page.request.post(`/api/databases/${db.id}/views`, { data: { name: "Vue B", type: "kanban" } })
  ).json();
  const vC = await (
    await page.request.post(`/api/databases/${db.id}/views`, { data: { name: "Vue C", type: "calendar" } })
  ).json();

  return {
    pageId: pg.id as string,
    dbId: db.id as string,
    vA: { id: vA.id as string, name: vA.name as string },
    vB: { id: vB.id as string, name: "Vue B" },
    vC: { id: vC.id as string, name: "Vue C" },
  };
}

/** Ordre courant des onglets (innerText de chaque wrapper `.group/tab`, en ordre DOM). */
async function tabOrder(page: Page): Promise<string[]> {
  const texts = await page.locator("div.group\\/tab").allInnerTexts();
  return texts.map((t) => t.trim());
}

/** Le bouton-onglet cliquable (natif <button> portant le libellé). */
const tabButton = (page: Page, name: string) =>
  page.locator("button").filter({ hasText: name });

/** Glisse `source` jusqu'au centre de `target` en dépassant l'activationConstraint (6 px). */
async function dragTabOnto(page: Page, source: ReturnType<Page["locator"]>, target: ReturnType<Page["locator"]>) {
  const sb = (await source.boundingBox())!;
  const tb = (await target.boundingBox())!;
  await page.mouse.move(sb.x + sb.width / 2, sb.y + sb.height / 2);
  await page.mouse.down();
  await page.mouse.move(sb.x + sb.width / 2 - 12, sb.y + sb.height / 2, { steps: 5 });
  await page.mouse.move(tb.x + tb.width / 2, tb.y + tb.height / 2, { steps: 12 });
  await page.mouse.up();
}

test("AC1 : glisser la 3e vue avant la 1re → nouvel ordre, un seul PATCH sur la vue déplacée, ?v inchangé", async ({ page }) => {
  const { pageId, vA, vB, vC } = await seed(page);

  await page.goto(`/pages/${pageId}?v=${vA.id}`);
  await expect(tabButton(page, vA.name)).toBeVisible();
  expect(await tabOrder(page)).toEqual([vA.name, "Vue B", "Vue C"]);

  const patches: string[] = [];
  page.on("request", (req) => {
    if (req.method() === "PATCH" && /\/api\/views\//.test(req.url())) patches.push(req.url());
  });

  const patched = page.waitForResponse(
    (r) => r.url().includes(`/api/views/${vC.id}`) && r.request().method() === "PATCH"
  );
  await dragTabOnto(page, tabButton(page, "Vue C"), tabButton(page, vA.name));
  await patched;

  // Nouvel ordre : Vue C, Vue principale, Vue B.
  await expect.poll(() => tabOrder(page)).toEqual(["Vue C", vA.name, "Vue B"]);

  // Un unique PATCH, sur la seule vue déplacée.
  expect(patches).toHaveLength(1);
  expect(patches[0]).toContain(`/api/views/${vC.id}`);

  // La vue active (?v) reste inchangée.
  expect(page.url()).toContain(`v=${vA.id}`);
});

test("AC4 : l'ordre est persisté et conservé après rechargement (ordre partagé)", async ({ page }) => {
  const { pageId, vA, vC } = await seed(page);

  await page.goto(`/pages/${pageId}?v=${vA.id}`);
  await expect(tabButton(page, vA.name)).toBeVisible();

  const patched = page.waitForResponse(
    (r) => r.url().includes(`/api/views/${vC.id}`) && r.request().method() === "PATCH"
  );
  await dragTabOnto(page, tabButton(page, "Vue C"), tabButton(page, vA.name));
  await patched;
  await expect.poll(() => tabOrder(page)).toEqual(["Vue C", vA.name, "Vue B"]);

  // Rechargement : l'ordre vient de la base → conservé.
  await page.goto(`/pages/${pageId}?v=${vA.id}`);
  await expect(tabButton(page, vA.name)).toBeVisible();
  await expect.poll(() => tabOrder(page)).toEqual(["Vue C", vA.name, "Vue B"]);
});

test("AC5 : clic (<6px) switche la vue sans réordonner ; ⋯ menu et rename inline restent fonctionnels", async ({ page }) => {
  const { pageId, vA, vB } = await seed(page);

  await page.goto(`/pages/${pageId}?v=${vA.id}`);
  await expect(tabButton(page, vA.name)).toBeVisible();

  // Clic simple sur « Vue B » → devient active (?v), ordre inchangé.
  await tabButton(page, "Vue B").click();
  await expect.poll(() => page.url()).toContain(`v=${vB.id}`);
  expect(await tabOrder(page)).toEqual([vA.name, "Vue B", "Vue C"]);

  // Le bouton ⋯ ouvre le menu Renommer / Supprimer.
  const wrapperB = page.locator("div.group\\/tab").filter({ hasText: "Vue B" });
  await wrapperB.hover();
  await wrapperB.getByRole("button", { name: "Options" }).click();
  await expect(page.getByRole("button", { name: "Renommer" })).toBeVisible();
  // « Supprimer » du menu déroulant (texte visible) ≠ corbeille de la sidebar
  // (bouton icône, libellé porté par title) : on cible l'item texte du menu.
  await expect(page.getByText("Supprimer", { exact: true })).toBeVisible();

  // Rename inline : Renommer → saisie → Entrée → nom persisté.
  await page.getByRole("button", { name: "Renommer" }).click();
  const input = page.locator("div.group\\/tab input");
  await expect(input).toBeVisible();
  await expect(input).toHaveValue("Vue B");
  await input.fill("Vue B renommée");
  await input.press("Enter");
  await expect(tabButton(page, "Vue B renommée")).toBeVisible();
});

test("AC6 : rollback — si le PATCH échoue, l'ordre des onglets revient à l'état initial", async ({ page }) => {
  const { pageId, vA } = await seed(page);

  await page.goto(`/pages/${pageId}?v=${vA.id}`);
  await expect(tabButton(page, vA.name)).toBeVisible();
  const initial = await tabOrder(page);
  expect(initial).toEqual([vA.name, "Vue B", "Vue C"]);

  // Faire échouer le PATCH de réordonnancement (route.abort).
  await page.route("**/api/views/*", (route) => {
    if (route.request().method() === "PATCH") route.abort();
    else route.continue();
  });

  await dragTabOnto(page, tabButton(page, "Vue C"), tabButton(page, vA.name));

  // Après l'échec, le cache SWR est restauré → ordre initial.
  await expect.poll(() => tabOrder(page)).toEqual(initial);
});

test("cas limite : database à une seule vue → rendu OK, aucun PATCH de réordonnancement", async ({ page }) => {
  const email = `vtabs-solo-${Date.now()}@x.tld`;
  const reg = await page.request.post("/api/auth/register", {
    data: { firstName: "S", lastName: "O", displayName: "SO", email, password: "Test1234!" },
  });
  expect(reg.ok()).toBeTruthy();
  const workspaceId = (await (await page.request.get("/api/workspaces")).json())[0].id;
  const pg = await (await page.request.post("/api/pages", { data: { workspaceId, title: "DB solo" } })).json();
  const db = await (await page.request.post("/api/databases", { data: { pageId: pg.id } })).json();
  const only = db.views[0];

  const patches: string[] = [];
  page.on("request", (req) => {
    if (req.method() === "PATCH" && /\/api\/views\//.test(req.url())) patches.push(req.url());
  });

  await page.goto(`/pages/${pg.id}?v=${only.id}`);
  const tab = tabButton(page, only.name);
  await expect(tab).toBeVisible();

  // Tenter de « glisser » l'unique onglet sur lui-même : aucun voisin → aucun PATCH.
  await dragTabOnto(page, tab, tab);

  // Le rendu tient et la vue reste utilisable (le clic switch fonctionne toujours).
  await expect(tab).toBeVisible();
  expect(patches).toHaveLength(0);
});
