import { test, expect, type Page } from "@playwright/test";

// Ces flux « supprimer via l'UI » n'étaient PAS testables avant : Playwright rejette
// automatiquement les window.confirm() natifs, donc l'action ne partait jamais.

async function register(page: Page, tag: string) {
  const email = `${tag}-${Date.now()}@x.tld`;
  const reg = await page.request.post("/api/auth/register", {
    data: { firstName: "D", lastName: "L", displayName: "DL", email, password: "Test1234!" },
  });
  expect(reg.ok()).toBeTruthy();
  const workspaces = await (await page.request.get("/api/workspaces")).json();
  return workspaces[0].id as string;
}

const dialog = (page: Page) => page.getByRole("dialog");

test("confirmation destructive : annuler, Échap, puis confirmer", async ({ page }) => {
  const workspaceId = await register(page, "dlg-del");
  const title = `Page à supprimer ${Date.now()}`;
  await page.request.post("/api/pages", { data: { workspaceId, title } });

  await page.goto("/");
  const sidebar = page.locator("aside");
  const node = sidebar.getByRole("button", { name: title });
  await expect(node).toBeVisible();

  const trash = node.getByTitle("Supprimer");

  // 1) Annuler → la page reste.
  await trash.click();
  await expect(dialog(page)).toBeVisible();
  await expect(dialog(page)).toContainText(title);
  await dialog(page).getByRole("button", { name: "Annuler" }).click();
  await expect(dialog(page)).toBeHidden();
  await expect(node).toBeVisible();

  // 2) Échap → annule le dialogue SEUL : la page reste et la palette ne s'ouvre pas.
  await trash.click();
  await expect(dialog(page)).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(dialog(page)).toBeHidden();
  await expect(node).toBeVisible();
  await expect(page.getByPlaceholder("Rechercher une page ou une fiche…")).toHaveCount(0);

  // 3) Confirmer → la page disparaît.
  await trash.click();
  await dialog(page).getByRole("button", { name: "Supprimer" }).click();
  await expect(dialog(page)).toBeHidden();
  await expect(node).toHaveCount(0);
});

// Régression : le garde de montage du portail faisait tourner l'effet de focus
// avant que les boutons n'existent → aucun focus, et « Entrée ne détruit pas » ne
// s'appliquait jamais.
test("focus initial : sur « Annuler » si destructif, sur l'action sinon", async ({ page }) => {
  const workspaceId = await register(page, "dlg-focus");
  const title = `Page focus ${Date.now()}`;
  const pg = await (
    await page.request.post("/api/pages", { data: { workspaceId, title } })
  ).json();

  // Destructif → le focus se pose sur Annuler (une Entrée réflexe ne détruit pas).
  await page.goto("/");
  await page.locator("aside").getByRole("button", { name: title }).getByTitle("Supprimer").click();
  await expect(dialog(page).getByRole("button", { name: "Annuler" })).toBeFocused();

  // Entrée active donc « Annuler » : la page survit.
  await page.keyboard.press("Enter");
  await expect(dialog(page)).toBeHidden();
  await expect(page.locator("aside").getByRole("button", { name: title })).toBeVisible();

  // Non destructif → le focus se pose sur l'action.
  await page.goto(`/pages/${pg.id}`);
  await page.getByRole("button", { name: "Convertir en database" }).click();
  await expect(dialog(page).getByRole("button", { name: "Convertir" })).toBeFocused();
});

// Régression : le dialogue ne confisquait pas les raccourcis globaux.
test("Ctrl+K n'ouvre pas la palette derrière le dialogue", async ({ page }) => {
  const workspaceId = await register(page, "dlg-cmdk");
  const title = `Page cmdk ${Date.now()}`;
  await page.request.post("/api/pages", { data: { workspaceId, title } });

  await page.goto("/");
  await page.locator("aside").getByRole("button", { name: title }).getByTitle("Supprimer").click();
  await expect(dialog(page)).toBeVisible();

  await page.keyboard.press("Control+k");
  await expect(page.getByPlaceholder("Rechercher une page ou une fiche…")).toHaveCount(0);
  await expect(dialog(page)).toBeVisible();
});

test("confirmation non destructive : le bouton s'appelle « Convertir », pas « Supprimer »", async ({ page }) => {
  const workspaceId = await register(page, "dlg-conv");
  const pg = await (
    await page.request.post("/api/pages", { data: { workspaceId, title: "Page à convertir" } })
  ).json();

  await page.goto(`/pages/${pg.id}`);
  await page.getByRole("button", { name: "Convertir en database" }).click();

  const d = dialog(page);
  await expect(d).toBeVisible();
  await expect(d.getByRole("button", { name: "Convertir" })).toBeVisible();
  await expect(d.getByRole("button", { name: "Supprimer" })).toHaveCount(0);

  // Annuler laisse l'éditeur en place (la page n'est pas devenue une database).
  await d.getByRole("button", { name: "Annuler" }).click();
  await expect(page.locator("[contenteditable='true']").first()).toBeVisible();
});

test("alerte : un refus serveur s'affiche dans le dialogue, bouton unique « OK »", async ({ page }) => {
  const workspaceId = await register(page, "dlg-alert");
  const pg = await (
    await page.request.post("/api/pages", { data: { workspaceId, title: "Page erreur" } })
  ).json();

  // Le serveur refuse la conversion.
  await page.route("**/api/databases", (route) =>
    route.request().method() === "POST"
      ? route.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ error: "Base indisponible" }) })
      : route.continue()
  );

  await page.goto(`/pages/${pg.id}`);
  await page.getByRole("button", { name: "Convertir en database" }).click();
  await dialog(page).getByRole("button", { name: "Convertir" }).click();

  const d = dialog(page);
  await expect(d).toContainText("Conversion impossible");
  await expect(d).toContainText("Base indisponible");
  await expect(d.getByRole("button", { name: "Annuler" })).toHaveCount(0);
  await d.getByRole("button", { name: "OK" }).click();
  await expect(d).toBeHidden();
});

test("le dialogue est utilisable depuis l'icône Supprimer d'une carte kanban (sous-arbre triable)", async ({ page }) => {
  const workspaceId = await register(page, "dlg-kanban");
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
  const cardTitle = `Carte ${Date.now()}`;
  await page.request.post(`/api/databases/${db.id}/records`, {
    data: { title: cardTitle, properties: { [prop.id]: "a" } },
  });

  await page.goto(`/pages/${pg.id}?v=${view.id}`);
  const card = page.getByText(cardTitle);
  await expect(card).toBeVisible();

  // Icône Supprimer DIRECTE de la carte (le menu ⋯ a été remplacé par 2 icônes).
  // Scopé à la colonne : la corbeille sidebar et l'onglet de vue portent des
  // libellés proches.
  const column = page.locator("div.w-64").filter({ hasText: "Alpha" });
  await card.hover();
  await column.getByLabel("Supprimer").click();

  // Le dialogue est visible ET cliquable malgré le portail et le sous-arbre dnd-kit.
  await expect(dialog(page)).toBeVisible();
  await dialog(page).getByRole("button", { name: "Supprimer" }).click();
  await expect(card).toHaveCount(0);
});
