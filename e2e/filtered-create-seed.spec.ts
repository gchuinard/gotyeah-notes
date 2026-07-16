import { test, expect, type Page } from "@playwright/test";

/**
 * Ticket : créer une carte depuis une vue FILTRÉE doit pré-remplir les propriétés
 * portées par les filtres eq (select/text) de la vue, pour que la carte satisfasse
 * le filtre PAR CONSTRUCTION et reste visible au lieu de disparaître silencieusement.
 * Couvre les 3 vues (Kanban, Table, Gallery) + le cas limite isEmpty (aucun semis).
 */

async function register(page: Page, tag: string) {
  const email = `${tag}-${Date.now()}@x.tld`;
  const reg = await page.request.post("/api/auth/register", {
    data: { firstName: "F", lastName: "S", displayName: "FS", email, password: "Test1234!" },
  });
  expect(reg.ok()).toBeTruthy();
  const workspaces = await (await page.request.get("/api/workspaces")).json();
  return workspaces[0].id as string;
}

async function mkDatabase(page: Page, workspaceId: string, title: string) {
  const pg = await (
    await page.request.post("/api/pages", { data: { workspaceId, title } })
  ).json();
  const db = await (await page.request.post("/api/databases", { data: { pageId: pg.id } })).json();
  return { pageId: pg.id as string, dbId: db.id as string };
}

async function mkSelect(page: Page, dbId: string, name: string, options: { id: string; name: string; color: string }[]) {
  return (
    await page.request.post(`/api/databases/${dbId}/properties`, {
      data: { name, type: "select", config: { type: "select", options } },
    })
  ).json();
}

const column = (page: Page, label: string) => page.locator("div.w-64").filter({ hasText: label });
const panelOpen = (page: Page) => page.getByTitle("Modèle de cette carte");

const postRecordResp = (page: Page, dbId: string) =>
  page.waitForResponse(
    (r) => r.url().includes(`/api/databases/${dbId}/records`) && r.request().method() === "POST"
  );

// ─── Kanban (plan 7) ──────────────────────────────────────────────────────────

test("kanban : créer une carte sur une vue filtrée Projet=Notes la garde visible après revalidation", async ({
  page,
}) => {
  const workspaceId = await register(page, "fcs-kanban");
  const { pageId, dbId } = await mkDatabase(page, workspaceId, "DB kanban filtrée");
  const statut = await mkSelect(page, dbId, "Statut", [{ id: "todo", name: "Todo", color: "blue" }]);
  const projet = await mkSelect(page, dbId, "Projet", [{ id: "notes", name: "Notes", color: "green" }]);

  const view = await (
    await page.request.post(`/api/databases/${dbId}/views`, {
      data: {
        name: "Board filtré",
        type: "kanban",
        config: {
          groupByPropertyId: statut.id,
          filters: [{ propertyId: projet.id, operator: "eq", value: "notes" }],
        },
      },
    })
  ).json();

  await page.goto(`/pages/${pageId}?v=${view.id}`);
  await expect(column(page, "Todo")).toBeVisible();

  const resp = postRecordResp(page, dbId);
  await column(page, "Todo").getByRole("button", { name: "Nouveau" }).click();
  const created = await (await resp).json();

  // C1 : le body POST sème Projet (filtre) EN PLUS de Statut (groupBy de la colonne).
  const body = (await resp).request().postDataJSON();
  expect(body.properties[projet.id]).toBe("notes");
  expect(body.properties[statut.id]).toBe("todo");
  expect(created.properties[projet.id]).toBe("notes");
  expect(created.properties[statut.id]).toBe("todo");

  // Titre déterministe (via API) pour identifier la carte, puis fresh load.
  await page.request.patch(`/api/records/${created.id}`, { data: { title: "Carte filtrée" } });
  await page.reload();

  // Reste visible dans la colonne Todo (elle ne disparaît pas : le filtre est satisfait).
  await expect(column(page, "Todo").getByText("Carte filtrée", { exact: true })).toBeVisible();
});

// ─── Table (plan 8) ───────────────────────────────────────────────────────────

test("table : créer une ligne sur une vue filtrée par un eq → ligne présente + panneau ouvert", async ({
  page,
}) => {
  const workspaceId = await register(page, "fcs-table");
  const { pageId, dbId } = await mkDatabase(page, workspaceId, "DB table filtrée");
  const projet = await mkSelect(page, dbId, "Projet", [{ id: "notes", name: "Notes", color: "green" }]);

  const view = await (
    await page.request.post(`/api/databases/${dbId}/views`, {
      data: {
        name: "Table filtrée",
        type: "table",
        config: { filters: [{ propertyId: projet.id, operator: "eq", value: "notes" }] },
      },
    })
  ).json();

  await page.goto(`/pages/${pageId}?v=${view.id}`);

  const resp = postRecordResp(page, dbId);
  await page.getByRole("button", { name: "Nouveau" }).click();
  const created = await (await resp).json();

  // Le body POST sème la valeur du filtre, et le panneau s'ouvre sur la nouvelle ligne.
  expect((await resp).request().postDataJSON().properties[projet.id]).toBe("notes");
  expect(created.properties[projet.id]).toBe("notes");
  await expect(panelOpen(page)).toBeVisible();

  await page.request.patch(`/api/records/${created.id}`, { data: { title: "Ligne filtrée" } });
  await page.reload();
  // Le titre apparaît DEUX fois (cellule de la table + titre du RecordPanel rouvert
  // via ?r=) : on scope à la table pour asserter la présence de la LIGNE.
  await expect(page.getByRole("table").getByText("Ligne filtrée", { exact: true })).toBeVisible();
});

// ─── Gallery (plan 8) ─────────────────────────────────────────────────────────

test("gallery : créer une carte sur une vue filtrée par un eq → carte présente dans la grille", async ({
  page,
}) => {
  const workspaceId = await register(page, "fcs-gallery");
  const { pageId, dbId } = await mkDatabase(page, workspaceId, "DB gallery filtrée");
  const projet = await mkSelect(page, dbId, "Projet", [{ id: "notes", name: "Notes", color: "green" }]);

  const view = await (
    await page.request.post(`/api/databases/${dbId}/views`, {
      data: {
        name: "Gallery filtrée",
        type: "gallery",
        config: { filters: [{ propertyId: projet.id, operator: "eq", value: "notes" }] },
      },
    })
  ).json();

  await page.goto(`/pages/${pageId}?v=${view.id}`);

  const resp = postRecordResp(page, dbId);
  await page.getByRole("button", { name: "Nouveau" }).click();
  const created = await (await resp).json();

  expect((await resp).request().postDataJSON().properties[projet.id]).toBe("notes");
  expect(created.properties[projet.id]).toBe("notes");

  await page.request.patch(`/api/records/${created.id}`, { data: { title: "Carte gallery" } });
  await page.reload();
  await expect(page.getByText("Carte gallery", { exact: true })).toBeVisible();
});

// ─── Cas limite isEmpty (plan 9) ──────────────────────────────────────────────

test("table filtrée « Projet vide » (isEmpty) : la création ne sème pas Projet, la carte reste visible", async ({
  page,
}) => {
  const workspaceId = await register(page, "fcs-empty");
  const { pageId, dbId } = await mkDatabase(page, workspaceId, "DB isEmpty");
  const projet = await mkSelect(page, dbId, "Projet", [{ id: "notes", name: "Notes", color: "green" }]);

  const view = await (
    await page.request.post(`/api/databases/${dbId}/views`, {
      data: {
        name: "Sans projet",
        type: "table",
        config: { filters: [{ propertyId: projet.id, operator: "isEmpty" }] },
      },
    })
  ).json();

  await page.goto(`/pages/${pageId}?v=${view.id}`);

  const resp = postRecordResp(page, dbId);
  await page.getByRole("button", { name: "Nouveau" }).click();
  const created = await (await resp).json();

  // Aucun pré-remplissage indu : ni dans le body POST, ni dans le record créé.
  const body = (await resp).request().postDataJSON();
  expect(body.properties?.[projet.id]).toBeUndefined();
  expect(created.properties[projet.id]).toBeUndefined();

  await page.request.patch(`/api/records/${created.id}`, { data: { title: "Sans projet" } });
  await page.reload();
  await expect(page.getByText("Sans projet", { exact: true })).toBeVisible();
});
