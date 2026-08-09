import { test, expect, type Page } from "@playwright/test";

// Fil de discussion d'une carte — append-only.

async function seed(page: Page, tag: string) {
  const email = `${tag}-${Date.now()}@x.tld`;
  const reg = await page.request.post("/api/auth/register", {
    data: { firstName: "C", lastName: "M", displayName: "Camille", email, password: "Test1234!" },
  });
  expect(reg.ok()).toBeTruthy();
  const workspaces = await (await page.request.get("/api/workspaces")).json();
  const workspaceId = workspaces[0].id as string;

  const pg = await (
    await page.request.post("/api/pages", { data: { workspaceId, title: `Board ${tag}` } })
  ).json();
  const db = await (await page.request.post("/api/databases", { data: { pageId: pg.id } })).json();
  const rec = await (
    await page.request.post(`/api/databases/${db.id}/records`, { data: { title: "Carte fil" } })
  ).json();
  return { pageId: pg.id as string, recordId: rec.id as string };
}

/**
 * ⚠️ `fill` puis `press` immédiat court contre React : la touche part avant que
 * l'état ait été commité, et le handler lit alors un brouillon VIDE — il ne
 * publie rien. On attend donc la valeur avant d'envoyer.
 */
async function publier(page: Page, texte: string) {
  const champ = page.getByPlaceholder(/Écrire un commentaire/);
  await champ.fill(texte);
  await expect(champ).toHaveValue(texte);
  // On attend que le POST ait ATTERRI avant de rendre la main : sans ça, le test
  // enchaîne sur l'assertion suivante pendant que la requête est encore en vol.
  const envoi = page.waitForResponse(
    (r) => r.url().includes("/comments") && r.request().method() === "POST"
  );
  await champ.press("Enter");
  expect((await envoi).status()).toBe(201);
}

test("publier un commentaire, le voir signé et daté", async ({ page }) => {
  const { pageId, recordId } = await seed(page, "com");
  await page.goto(`/pages/${pageId}?r=${recordId}`);

  // ⚠️ Attendre l'hydratation AVANT la première frappe : React réécrit la valeur
  // d'un champ rempli trop tôt après le SSR, et la touche part alors avec un
  // brouillon vide. Piège déjà documenté dans CLAUDE.md.
  await page.waitForLoadState("networkidle");
  await page.getByRole("button", { name: "Commentaires" }).click();
  await expect(page.getByText("Aucun commentaire.")).toBeVisible();

  // Entrée publie, Maj+Entrée passerait à la ligne.
  await publier(page, "Le plafond du proxy est à 25 Mo.");

  await expect(page.getByText("Le plafond du proxy est à 25 Mo.")).toBeVisible();
  // Scopé à la liste : le nom apparaît aussi dans la barre latérale.
  await expect(page.locator("[data-comment-list]").getByText("Camille")).toBeVisible();
  await expect(page.getByText("Aucun commentaire.")).toBeHidden();
});

test("⚠️ le plus récent est en haut, et rien ne permet de modifier ou supprimer", async ({
  page,
}) => {
  const { pageId, recordId } = await seed(page, "com-ordre");
  await page.goto(`/pages/${pageId}?r=${recordId}`);
  await page.waitForLoadState("networkidle");
  await page.getByRole("button", { name: "Commentaires" }).click();

  await publier(page, "premier");
  await expect(page.getByText("premier")).toBeVisible();
  await publier(page, "second");

  // ⚠️ toHaveText et pas allInnerTexts : ce dernier est un tir UNIQUE, sans
  // attente, et rend [] si React n'a pas encore commité le rendu.
  await expect(page.locator("[data-comment-list] li p")).toHaveText(["second", "premier"]);

  // Append-only : aucun bouton de retrait, contrairement aux pièces jointes.
  await expect(page.getByTitle("Retirer")).toHaveCount(0);
});
