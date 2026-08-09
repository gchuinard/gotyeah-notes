import { test, expect, type Page } from "@playwright/test";

// Le panneau d'options d'un élément de la barre latérale.
//
// ⚠️ Ce qu'il débloque : les règles de transition (« qui peut mettre une carte
// ici ») n'avaient qu'UN point de montage — l'en-tête de colonne de la vue
// TABLEAU. Sur un board qui n'a qu'un kanban, elles étaient inatteignables :
// 0 colonne sur 306 en portait une, un mois après la livraison.

async function register(page: Page, tag: string) {
  const email = `${tag}-${Date.now()}@x.tld`;
  const reg = await page.request.post("/api/auth/register", {
    data: { firstName: "P", lastName: "O", displayName: "PO", email, password: "Test1234!" },
  });
  expect(reg.ok()).toBeTruthy();
  const workspaces = await (await page.request.get("/api/workspaces")).json();
  return workspaces[0].id as string;
}

const rowOf = (page: Page, title: string) =>
  page.locator("aside").getByRole("button", { name: title });

test("renommer une page depuis le panneau, et fermer avec Échap", async ({ page }) => {
  const workspaceId = await register(page, "opt-rename");
  const title = `Page à renommer ${Date.now()}`;
  await page.request.post("/api/pages", { data: { workspaceId, title } });

  await page.goto("/");
  const row = rowOf(page, title);
  await expect(row).toBeVisible();

  await row.getByTitle("Options de la page").click();
  const champ = page.getByLabel("Nom");
  await expect(champ).toBeVisible();

  const renomme = `${title} — renommée`;
  await champ.fill(renomme);
  await champ.press("Enter");

  // L'arbre est revalidé : le nouveau nom remplace l'ancien dans la barre latérale.
  await expect(rowOf(page, renomme)).toBeVisible();

  // Échap ferme — le Portal ne le faisait PAS avant ce lot (opt-in closeOnEscape).
  await page.keyboard.press("Escape");
  await expect(page.getByLabel("Nom")).toBeHidden();
});

test("⚠️ sur un board SANS vue Tableau, les règles d'accès sont atteignables", async ({ page }) => {
  // Le cœur du lot. Avant, il fallait créer une vue Tableau, poser la règle
  // depuis l'en-tête de colonne, puis supprimer la vue.
  const workspaceId = await register(page, "opt-rules");
  const title = `Board kanban ${Date.now()}`;
  const pg = await (
    await page.request.post("/api/pages", { data: { workspaceId, title } })
  ).json();
  const db = await (
    await page.request.post("/api/databases", { data: { pageId: pg.id } })
  ).json();
  await page.request.post(`/api/databases/${db.id}/properties`, {
    data: {
      name: "Statut",
      type: "select",
      config: {
        type: "select",
        options: [{ id: "prod", name: "En production", color: "green" }],
      },
    },
  });

  await page.goto("/");
  await rowOf(page, title).getByTitle("Options de la page").click();

  // La colonne est listée, et l'accordéon des règles avec elle.
  await expect(page.getByText("Statut", { exact: true })).toBeVisible();
  const accordeon = page.getByText("Qui peut mettre une carte ici");
  await expect(accordeon).toBeVisible();

  // Déplié, il propose les rôles pour l'option — c'est ce qui permet enfin de
  // dire « seul un admin pose En production » sans passer par une vue Tableau.
  await accordeon.click();
  await expect(page.getByRole("button", { name: "Admins" })).toBeVisible();
  await expect(page.getByText("ouverte à tous")).toBeVisible();
});

test("une page ORDINAIRE n'affiche aucune section Tableau", async ({ page }) => {
  // La section n'apparaît que si la page porte une database — chargée
  // paresseusement, l'arbre ne le dit pas.
  const workspaceId = await register(page, "opt-plain");
  const title = `Page simple ${Date.now()}`;
  await page.request.post("/api/pages", { data: { workspaceId, title } });

  await page.goto("/");
  await rowOf(page, title).getByTitle("Options de la page").click();

  await expect(page.getByLabel("Nom")).toBeVisible();
  await expect(page.getByText("Qui peut mettre une carte ici")).toBeHidden();
});
