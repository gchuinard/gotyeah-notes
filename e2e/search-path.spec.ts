import { test, expect } from "@playwright/test";

/**
 * Ticket 9 — la palette de recherche (Cmd+K) affiche sous chaque résultat une 2e
 * ligne = son chemin (section › dossiers parents), calculée côté client depuis le
 * cache SWR pages/sections (mêmes clés que Breadcrumb.tsx). Zéro changement d'API.
 */

async function registerAndWorkspace(page: import("@playwright/test").Page, email: string) {
  const reg = await page.request.post("/api/auth/register", {
    data: { firstName: "S", lastName: "P", displayName: "SP", email, password: "Test1234!" },
  });
  expect(reg.ok()).toBeTruthy();
  const workspaces = await (await page.request.get("/api/workspaces")).json();
  return workspaces[0].id as string;
}

test("deux pages homonymes → 2e ligne de chemin distincte pour chacune (critère 1)", async ({ page }) => {
  const email = `searchpath-${Date.now()}@x.tld`;
  const title = `Q3-${Date.now()}`;
  const workspaceId = await registerAndWorkspace(page, email);

  const secA = await (
    await page.request.post("/api/sections", { data: { workspaceId, name: "AlphaSec", type: "team" } })
  ).json();
  const secB = await (
    await page.request.post("/api/sections", { data: { workspaceId, name: "BetaSec", type: "team" } })
  ).json();

  const rootA = await (
    await page.request.post("/api/pages", { data: { workspaceId, title: "AlphaFolder", sectionId: secA.id } })
  ).json();
  const rootB = await (
    await page.request.post("/api/pages", { data: { workspaceId, title: "BetaFolder", sectionId: secB.id } })
  ).json();

  // Deux pages HOMONYMES (même titre) dans deux arborescences distinctes.
  await page.request.post("/api/pages", { data: { workspaceId, title, parentId: rootA.id } });
  await page.request.post("/api/pages", { data: { workspaceId, title, parentId: rootB.id } });

  await page.goto(`/pages/${rootA.id}`);
  await expect(page.getByRole("link", { name: "Accueil" })).toBeVisible();

  await page.keyboard.press("Control+k");
  const input = page.getByPlaceholder("Rechercher une page ou une fiche…");
  await expect(input).toBeVisible();
  await input.fill(title);

  // Les deux résultats homonymes remontent, chacun avec SON chemin (distinct).
  const alpha = page.getByRole("listitem").filter({ hasText: "AlphaFolder" });
  const beta = page.getByRole("listitem").filter({ hasText: "BetaFolder" });
  await expect(alpha).toBeVisible();
  await expect(beta).toBeVisible();
  await expect(alpha).toContainText("AlphaSec");
  await expect(beta).toContainText("BetaSec");
  // Le chemin d'une page ne répète pas son propre titre (critère 4) : la section
  // « AlphaSec » n'apparaît que sous le résultat AlphaFolder, pas sous BetaFolder.
  await expect(beta).not.toContainText("AlphaSec");
});

test("résultat record → badge « fiche » conservé ET 2e ligne = chemin de la page hôte (critères 3-4)", async ({ page }) => {
  const email = `searchpath-rec-${Date.now()}@x.tld`;
  const recTitle = `FicheChemin ${Date.now()}`;
  const workspaceId = await registerAndWorkspace(page, email);

  const sec = await (
    await page.request.post("/api/sections", { data: { workspaceId, name: "RecoSec", type: "team" } })
  ).json();
  const folder = await (
    await page.request.post("/api/pages", { data: { workspaceId, title: "RecoFolder", sectionId: sec.id } })
  ).json();
  const dbPage = await (
    await page.request.post("/api/pages", { data: { workspaceId, title: "RecoHost", parentId: folder.id } })
  ).json();
  const db = await (await page.request.post("/api/databases", { data: { pageId: dbPage.id } })).json();
  await page.request.post(`/api/databases/${db.id}/records`, { data: { title: recTitle } });

  await page.goto(`/pages/${folder.id}`);
  await expect(page.getByRole("link", { name: "Accueil" })).toBeVisible();

  await page.keyboard.press("Control+k");
  const input = page.getByPlaceholder("Rechercher une page ou une fiche…");
  await expect(input).toBeVisible();
  await input.fill(recTitle);

  const item = page.getByRole("listitem").filter({ hasText: recTitle });
  await expect(item).toBeVisible();
  await expect(item.getByText("fiche")).toBeVisible();
  // Le chemin est le fil COMPLET de la page hôte (section › dossier › page hôte).
  await expect(item).toContainText("RecoSec");
  await expect(item).toContainText("RecoHost");
});

test("non-régression : ouvrir la palette + rechercher ne refetch pas pages/sections (cache SWR réutilisé, critère 2)", async ({ page }) => {
  const email = `searchpath-net-${Date.now()}@x.tld`;
  const title = `NetChemin-${Date.now()}`;
  const workspaceId = await registerAndWorkspace(page, email);

  const root = await (
    await page.request.post("/api/pages", { data: { workspaceId, title: "NetRoot" } })
  ).json();
  await page.request.post("/api/pages", { data: { workspaceId, title, parentId: root.id } });

  const reqs: string[] = [];
  page.on("request", (r) => reqs.push(r.url()));

  await page.goto(`/pages/${root.id}`);
  await expect(page.getByRole("link", { name: "Accueil" })).toBeVisible();
  await page.waitForLoadState("networkidle");

  const count = (needle: string) => reqs.filter((u) => u.includes(needle)).length;
  const pagesBefore = count("/api/pages?");
  const sectionsBefore = count("/api/sections?");
  const searchBefore = count("/api/search?");

  await page.keyboard.press("Control+k");
  const input = page.getByPlaceholder("Rechercher une page ou une fiche…");
  await expect(input).toBeVisible();
  await input.fill(title);

  // Le résultat (et donc son chemin) s'affiche à partir du cache déjà chargé.
  await expect(page.getByRole("listitem").filter({ hasText: title })).toContainText("NetRoot");
  await page.waitForTimeout(300);

  // La palette n'a déclenché AUCUN refetch pages/sections (clés dédupliquées avec
  // la sidebar / Breadcrumb) ; seule la recherche a appelé /api/search.
  expect(count("/api/pages?")).toBe(pagesBefore);
  expect(count("/api/sections?")).toBe(sectionsBefore);
  expect(count("/api/search?")).toBeGreaterThan(searchBefore);
});
