import { test, expect, type Page } from "@playwright/test";

// Repli/dépli récursif d'une branche de la sidebar au Maj+clic sur le chevron.
// L'état d'expansion est un Set d'ids repliés détenu par SectionBlock (pas de
// persistance, pas de store global, pas de bouton « Tout replier »).

const CHEVRON_TITLE = "Maj+clic";

async function apiPage(
  page: Page,
  workspaceId: string,
  title: string,
  opts: { sectionId?: string; parentId?: string }
) {
  const res = await page.request.post("/api/pages", {
    data: { workspaceId, title, ...opts },
  });
  expect(res.ok()).toBeTruthy();
  return res.json();
}

// Deux branches à 3 niveaux (root → childFolder → grandLeaf), une par section
// (Privé + Équipe), pour prouver l'indépendance des sections.
async function seed(page: Page) {
  const email = `collapse-${Date.now()}-${Math.random().toString(16).slice(2)}@x.tld`;
  const reg = await page.request.post("/api/auth/register", {
    data: { firstName: "C", lastName: "L", displayName: "CL", email, password: "Test1234!" },
  });
  expect(reg.ok()).toBeTruthy();

  const workspaces = await (await page.request.get("/api/workspaces")).json();
  const workspaceId = workspaces[0].id;

  const sections = await (
    await page.request.get(`/api/sections?workspaceId=${workspaceId}`)
  ).json();
  const priv = sections.find((s: { type: string }) => s.type === "private");
  let team = sections.find((s: { type: string }) => s.type === "team");
  if (!team) {
    team = await (
      await page.request.post("/api/sections", {
        data: { workspaceId, name: "Équipe", type: "team" },
      })
    ).json();
  }

  const privRoot = await apiPage(page, workspaceId, "PrivRoot", { sectionId: priv.id });
  const privChild = await apiPage(page, workspaceId, "PrivChild", { parentId: privRoot.id });
  const privGrand = await apiPage(page, workspaceId, "PrivGrand", { parentId: privChild.id });

  const teamRoot = await apiPage(page, workspaceId, "TeamRoot", { sectionId: team.id });
  const teamChild = await apiPage(page, workspaceId, "TeamChild", { parentId: teamRoot.id });
  const teamGrand = await apiPage(page, workspaceId, "TeamGrand", { parentId: teamChild.id });

  return { privRoot, privChild, privGrand, teamRoot, teamChild, teamGrand };
}

// On navigue sur `/` (pas /pages/[id]) pour laisser « Récents » vide : ainsi
// chaque href `/pages/<id>` n'apparaît qu'UNE fois (dans l'arbre), et les
// locators sont non ambigus.
function helpers(page: Page) {
  const sidebar = page.locator("aside");
  const link = (id: string) => sidebar.locator(`a[href="/pages/${id}"]`);
  const chevron = (id: string) => link(id).locator("xpath=..").getByTitle(CHEVRON_TITLE);
  return { sidebar, link, chevron };
}

test("critère 1 — aucune persistance : arbre déplié au chargement et après reload", async ({ page }) => {
  const { privGrand } = await seed(page);
  const { link } = helpers(page);

  await page.goto("/");
  // La feuille la plus profonde est visible → toute la branche est dépliée.
  await expect(link(privGrand.id)).toBeVisible();

  await page.reload();
  await expect(link(privGrand.id)).toBeVisible();
});

test("critère 2 — clic simple : ne bascule que ce dossier, préserve les sous-dossiers, ne navigue pas", async ({ page }) => {
  const { privRoot, privChild, privGrand } = await seed(page);
  const { link, chevron } = helpers(page);

  await page.goto("/");
  await expect(link(privGrand.id)).toBeVisible();

  // Clic simple sur le chevron de privChild → seul privChild se replie.
  await chevron(privChild.id).click();
  await expect(link(privGrand.id)).toBeHidden(); // enfant de privChild masqué
  await expect(link(privChild.id)).toBeVisible(); // privChild toujours rendu
  await expect(link(privRoot.id)).toBeVisible(); // privRoot inchangé
  await expect(page).not.toHaveURL(/\/pages\//); // pas de navigation

  // Replier privRoot puis le rouvrir : privChild reste replié (état par nœud préservé).
  await chevron(privRoot.id).click();
  await expect(link(privChild.id)).toBeHidden();
  await chevron(privRoot.id).click();
  await expect(link(privChild.id)).toBeVisible();
  await expect(link(privGrand.id)).toBeHidden();
});

test("critère 3 — Maj+clic sur une branche dépliée : replie le dossier ET tous ses sous-dossiers", async ({ page }) => {
  const { privRoot, privChild, privGrand } = await seed(page);
  const { link, chevron } = helpers(page);

  await page.goto("/");
  await expect(link(privGrand.id)).toBeVisible();

  await chevron(privRoot.id).click({ modifiers: ["Shift"] });
  await expect(link(privChild.id)).toBeHidden();

  // Rouvrir la racine (clic simple) : privChild est resté replié récursivement.
  await chevron(privRoot.id).click();
  await expect(link(privChild.id)).toBeVisible();
  await expect(link(privGrand.id)).toBeHidden();
});

test("critère 4 — Maj+clic sur une branche repliée : déplie toute la branche", async ({ page }) => {
  const { privRoot, privGrand } = await seed(page);
  const { link, chevron } = helpers(page);

  await page.goto("/");
  await expect(link(privGrand.id)).toBeVisible();

  // Replier toute la branche.
  await chevron(privRoot.id).click({ modifiers: ["Shift"] });
  await expect(link(privGrand.id)).toBeHidden();

  // Maj+clic sur la racine repliée : la feuille profonde réapparaît (branche ouverte).
  await chevron(privRoot.id).click({ modifiers: ["Shift"] });
  await expect(link(privGrand.id)).toBeVisible();
});

test("critère 5 — le chevron porte un title mentionnant Maj+clic (découvrabilité)", async ({ page }) => {
  const { privRoot } = await seed(page);
  const { chevron } = helpers(page);

  await page.goto("/");
  await expect(chevron(privRoot.id)).toHaveAttribute("title", /Maj\+clic/);
});

test("critère 6 — repli d'une section sans impact sur l'autre, et pas de bouton « Tout replier »", async ({ page }) => {
  const { privRoot, privGrand, teamGrand } = await seed(page);
  const { sidebar, link, chevron } = helpers(page);

  await page.goto("/");
  await expect(link(privGrand.id)).toBeVisible();
  await expect(link(teamGrand.id)).toBeVisible();

  // Repli récursif dans Privé.
  await chevron(privRoot.id).click({ modifiers: ["Shift"] });
  await expect(link(privGrand.id)).toBeHidden();

  // La section Équipe reste intégralement dépliée.
  await expect(link(teamGrand.id)).toBeVisible();

  // Aucun bouton « Tout replier » n'a été ajouté à la sidebar.
  await expect(sidebar.getByRole("button", { name: /tout replier/i })).toHaveCount(0);
});

test("cas limite — une feuille n'a pas de chevron (Maj+clic no-op)", async ({ page }) => {
  const { privGrand } = await seed(page);
  const { link, chevron } = helpers(page);

  await page.goto("/");
  await expect(link(privGrand.id)).toBeVisible();
  // privGrand est une feuille : pas de bouton chevron dans sa ligne.
  await expect(chevron(privGrand.id)).toHaveCount(0);
});
