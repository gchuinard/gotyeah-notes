import { test, expect, type Page } from "@playwright/test";

/**
 * Ticket : le bouton d'ajout d'une carte/issue est ANCRÉ en tête de lane
 * (kanban + backlog) au lieu du pied, pour rester visible quand la lane déborde.
 * Le scroll reste GLOBAL au board (aucun scroll par-lane). Le flag
 * createInUnassignedOnly ne change que l'affichage du bouton, pas sa position.
 */

async function register(page: Page, tag: string) {
  const email = `${tag}-${Date.now()}@x.tld`;
  const reg = await page.request.post("/api/auth/register", {
    data: { firstName: "L", lastName: "A", displayName: "LA", email, password: "Test1234!" },
  });
  expect(reg.ok()).toBeTruthy();
  const workspaces = await (await page.request.get("/api/workspaces")).json();
  return workspaces[0].id as string;
}

async function seedKanban(page: Page) {
  const workspaceId = await register(page, "lab-kanban");
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
  return {
    pageId: pg.id as string,
    dbId: db.id as string,
    propId: prop.id as string,
    viewId: view.id as string,
  };
}

async function seedBacklog(page: Page) {
  const workspaceId = await register(page, "lab-backlog");
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

/** Remplit une colonne/lane d'assez de records pour dépasser la hauteur du viewport. */
async function fillRecords(
  page: Page,
  dbId: string,
  count: number,
  data: Record<string, unknown>
) {
  for (let i = 0; i < count; i++) {
    await page.request.post(`/api/databases/${dbId}/records`, {
      data: { title: `Item ${i} ${Date.now()}`, ...data },
    });
  }
}

/** La colonne kanban entière (en-tête + zone droppable), repérée par son libellé. */
const column = (page: Page, label: string) => page.locator("[data-kanban-column]").filter({ hasText: label });

// ─── Kanban ─────────────────────────────────────────────────────────────────

test("kanban : bouton « Nouveau » ancré en tête reste dans le viewport quand la lane déborde (AC1)", async ({
  page,
}) => {
  const { pageId, dbId, propId, viewId } = await seedKanban(page);
  await fillRecords(page, dbId, 25, { properties: { [propId]: "a" } });

  await page.goto(`/pages/${pageId}?v=${viewId}`);
  await expect(column(page, "Alpha")).toBeVisible();

  // Ancré en tête → visible sans scroller la lane (échouerait si rendu en pied).
  const addBtn = column(page, "Alpha").getByRole("button", { name: "Nouveau" });
  await expect(addBtn).toBeVisible();
  await expect(addBtn).toBeInViewport();
});

test("kanban : clic sur « Nouveau » ancré crée une carte avec l'éditeur de titre focus (AC2)", async ({
  page,
}) => {
  const { pageId, dbId, propId, viewId } = await seedKanban(page);
  await page.request.post(`/api/databases/${dbId}/records`, {
    data: { title: "Carte existante", properties: { [propId]: "a" } },
  });

  await page.goto(`/pages/${pageId}?v=${viewId}`);
  await expect(column(page, "Alpha")).toBeVisible();

  const created = page.waitForResponse(
    (r) => r.url().includes(`/api/databases/${dbId}/records`) && r.request().method() === "POST"
  );
  await column(page, "Alpha").getByRole("button", { name: "Nouveau" }).click();
  const rec = await (await created).json();

  // Carte créée dans la bonne colonne (valeur d'axe = option Alpha).
  expect(rec.properties[propId]).toBe("a");
  // Flux autoEdit préservé : l'input de titre inline prend le focus.
  await expect(page.locator("input:focus")).toBeVisible();
});

test("kanban : flag createInUnassignedOnly ne change QUE l'affichage du bouton, pas sa position (AC3)", async ({
  page,
}) => {
  const { pageId, dbId, propId } = await seedKanban(page);
  await page.request.post(`/api/databases/${dbId}/records`, {
    data: { title: "Carte", properties: { [propId]: "a" } },
  });

  const viewOn = await (
    await page.request.post(`/api/databases/${dbId}/views`, {
      data: {
        name: "Board strict",
        type: "kanban",
        config: { groupByPropertyId: propId, createInUnassignedOnly: true },
      },
    })
  ).json();
  const viewOff = await (
    await page.request.post(`/api/databases/${dbId}/views`, {
      data: {
        name: "Board libre",
        type: "kanban",
        config: { groupByPropertyId: propId, createInUnassignedOnly: false },
      },
    })
  ).json();

  // Flag ON : bouton présent en tête de « Sans valeur », absent des colonnes à option.
  await page.goto(`/pages/${pageId}?v=${viewOn.id}`);
  await expect(column(page, "Sans valeur").getByRole("button", { name: "Nouveau" })).toBeVisible();
  await expect(column(page, "Alpha").getByRole("button", { name: "Nouveau" })).toHaveCount(0);

  // Flag OFF : bouton présent en tête de toutes les colonnes.
  await page.goto(`/pages/${pageId}?v=${viewOff.id}`);
  await expect(column(page, "Alpha").getByRole("button", { name: "Nouveau" })).toBeVisible();
  await expect(column(page, "Sans valeur").getByRole("button", { name: "Nouveau" })).toBeVisible();
});

// ─── Backlog ─────────────────────────────────────────────────────────────────

test("backlog : bouton « Créer une issue » ancré en tête de lane reste dans le viewport (AC4)", async ({
  page,
}) => {
  const { pageId, dbId, viewId } = await seedBacklog(page);
  await fillRecords(page, dbId, 25, {});

  await page.goto(`/pages/${pageId}?v=${viewId}`);
  const addBtn = page.getByRole("button", { name: "Créer une issue" });
  await expect(addBtn).toBeVisible();
  await expect(addBtn).toBeInViewport();

  // Le clic crée bien une issue dans la lane (flux onAddRecord préservé).
  const created = page.waitForResponse(
    (r) => r.url().includes(`/api/databases/${dbId}/records`) && r.request().method() === "POST"
  );
  await addBtn.click();
  await created;
  await expect(page.locator("input:focus")).toBeVisible();
});

test("backlog : lane repliée masque « Créer une issue », le dépliage le rétablit en tête (AC5)", async ({
  page,
}) => {
  const { pageId, dbId, viewId } = await seedBacklog(page);
  await page.request.post(`/api/databases/${dbId}/records`, { data: { title: "Issue A" } });

  await page.goto(`/pages/${pageId}?v=${viewId}`);
  await expect(page.getByRole("button", { name: "Créer une issue" })).toBeVisible();

  // Replier la lane backlog → le bouton disparaît.
  await page.getByTitle("Replier").first().click();
  await expect(page.getByRole("button", { name: "Créer une issue" })).toHaveCount(0);

  // Déplier → le bouton réapparaît en tête.
  await page.getByTitle("Déplier").first().click();
  await expect(page.getByRole("button", { name: "Créer une issue" })).toBeVisible();
});
