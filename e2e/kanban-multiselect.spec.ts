import { test, expect, type Page } from "@playwright/test";

const OPTIONS = [
  { id: "a", name: "Alpha", color: "blue" },
  { id: "b", name: "Beta", color: "green" },
  { id: "c", name: "Gamma", color: "red" },
];

async function seed(page: Page, propType: "multiselect" | "select") {
  const email = `kbms-${propType}-${Date.now()}@x.tld`;
  const reg = await page.request.post("/api/auth/register", {
    data: { firstName: "K", lastName: "B", displayName: "KB", email, password: "Test1234!" },
  });
  expect(reg.ok()).toBeTruthy();
  const workspaceId = (await (await page.request.get("/api/workspaces")).json())[0].id;

  const pg = await (
    await page.request.post("/api/pages", { data: { workspaceId, title: "DB kanban" } })
  ).json();
  const db = await (await page.request.post("/api/databases", { data: { pageId: pg.id } })).json();

  const prop = await (
    await page.request.post(`/api/databases/${db.id}/properties`, {
      data: { name: "Tags", type: propType, config: { type: propType, options: OPTIONS } },
    })
  ).json();

  const view = await (
    await page.request.post(`/api/databases/${db.id}/views`, {
      data: { name: "Board", type: "kanban", config: { groupByPropertyId: prop.id } },
    })
  ).json();

  return { pageId: pg.id as string, dbId: db.id as string, propId: prop.id as string, viewId: view.id as string };
}

/** La colonne entière (en-tête + zone droppable), repérée par son libellé. */
const column = (page: Page, label: string) => page.locator("[data-kanban-column]").filter({ hasText: label });

async function propValueOf(page: Page, dbId: string, propId: string, recordId: string) {
  const records = await (await page.request.get(`/api/databases/${dbId}/records`)).json();
  return records.find((r: { id: string }) => r.id === recordId).properties[propId];
}

/** Drag dnd-kit : dépasser l'activationConstraint (6 px) puis viser la colonne cible. */
async function dragTo(page: Page, card: ReturnType<Page["locator"]>, targetLabel: string) {
  const cb = (await card.boundingBox())!;
  const tb = (await column(page, targetLabel).boundingBox())!;
  await page.mouse.move(cb.x + cb.width / 2, cb.y + cb.height / 2);
  await page.mouse.down();
  await page.mouse.move(cb.x + cb.width / 2 + 12, cb.y + cb.height / 2 + 12, { steps: 5 });
  await page.mouse.move(tb.x + tb.width / 2, tb.y + tb.height / 2 + 40, { steps: 12 });
  await page.mouse.up();
}

test("multiselect : créer une carte dans une colonne écrit un TABLEAU [X]", async ({ page }) => {
  const { pageId, dbId, propId, viewId } = await seed(page, "multiselect");

  await page.goto(`/pages/${pageId}?v=${viewId}`);
  await expect(column(page, "Alpha")).toBeVisible();

  const created = page.waitForResponse(
    (r) => r.url().includes(`/api/databases/${dbId}/records`) && r.request().method() === "POST"
  );
  await column(page, "Alpha").getByRole("button", { name: "Nouveau" }).click();
  const res = await created;
  const rec = await res.json();

  // AC3 : la valeur d'axe est un TABLEAU, pas une string.
  expect(rec.properties[propId]).toEqual(["a"]);
});

test("multiselect : drag Alpha → Beta conserve les autres tags ([A,C] → [C,B])", async ({ page }) => {
  const { pageId, dbId, propId, viewId } = await seed(page, "multiselect");
  const title = `Carte ${Date.now()}`;
  const rec = await (
    await page.request.post(`/api/databases/${dbId}/records`, {
      data: { title, properties: { [propId]: ["a", "c"] } },
    })
  ).json();

  await page.goto(`/pages/${pageId}?v=${viewId}`);
  // La carte apparaît dans Alpha ET Gamma (deux tags) → on scope à la colonne source.
  await expect(column(page, "Alpha").getByText(title)).toBeVisible();
  await expect(column(page, "Gamma").getByText(title)).toBeVisible();

  const patched = page.waitForResponse(
    (r) => r.url().includes(`/api/records/${rec.id}`) && r.request().method() === "PATCH"
  );
  await dragTo(page, column(page, "Alpha").getByText(title), "Beta");
  await patched;

  // AC2 : A retiré, B ajouté, C conservé — et toujours un tableau.
  expect(await propValueOf(page, dbId, propId, rec.id)).toEqual(["c", "b"]);

  // La carte est bien rendue dans Beta et Gamma après rechargement.
  await page.goto(`/pages/${pageId}?v=${viewId}`);
  await expect(column(page, "Beta").getByText(title)).toBeVisible();
  await expect(column(page, "Gamma").getByText(title)).toBeVisible();
  await expect(column(page, "Alpha").getByText(title)).toHaveCount(0);
});

test("multiselect : drag vers « Sans valeur » retire la clé", async ({ page }) => {
  const { pageId, dbId, propId, viewId } = await seed(page, "multiselect");
  const title = `Carte ${Date.now()}`;
  const rec = await (
    await page.request.post(`/api/databases/${dbId}/records`, {
      data: { title, properties: { [propId]: ["a"] } },
    })
  ).json();

  await page.goto(`/pages/${pageId}?v=${viewId}`);
  const patched = page.waitForResponse(
    (r) => r.url().includes(`/api/records/${rec.id}`) && r.request().method() === "PATCH"
  );
  await dragTo(page, column(page, "Alpha").getByText(title), "Sans valeur");
  await patched;

  // AC4 : clé retirée (aucune valeur résiduelle).
  expect(await propValueOf(page, dbId, propId, rec.id)).toBeUndefined();
  await page.goto(`/pages/${pageId}?v=${viewId}`);
  await expect(column(page, "Sans valeur").getByText(title)).toBeVisible();
});

test("select : non-régression, le drag écrit toujours une string", async ({ page }) => {
  const { pageId, dbId, propId, viewId } = await seed(page, "select");
  const title = `Carte ${Date.now()}`;
  const rec = await (
    await page.request.post(`/api/databases/${dbId}/records`, {
      data: { title, properties: { [propId]: "a" } },
    })
  ).json();

  await page.goto(`/pages/${pageId}?v=${viewId}`);
  const patched = page.waitForResponse(
    (r) => r.url().includes(`/api/records/${rec.id}`) && r.request().method() === "PATCH"
  );
  await dragTo(page, column(page, "Alpha").getByText(title), "Beta");
  await patched;

  expect(await propValueOf(page, dbId, propId, rec.id)).toBe("b");
});
