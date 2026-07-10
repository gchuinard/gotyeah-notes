import { test, expect } from "@playwright/test";

test("suppression de section : les pages racines réapparaissent sous le repli (pas orphelines)", async ({ page }) => {
  const email = `secdel-${Date.now()}@x.tld`;
  const rootTitle = `RacineSuppr ${Date.now()}`;
  const childTitle = `EnfantSuppr ${Date.now()}`;

  const reg = await page.request.post("/api/auth/register", {
    data: { firstName: "S", lastName: "D", displayName: "SD", email, password: "Test1234!" },
  });
  expect(reg.ok()).toBeTruthy();

  const workspaces = await (await page.request.get("/api/workspaces")).json();
  const workspaceId = workspaces[0].id;

  // Section team supplémentaire ; le repli sera la team par défaut (« Espace d'équipe »).
  const section = await (
    await page.request.post("/api/sections", { data: { workspaceId, name: "À supprimer", type: "team" } })
  ).json();

  // Racine dans cette section + un enfant (hérite de la section via la racine).
  const root = await (
    await page.request.post("/api/pages", { data: { workspaceId, title: rootTitle, sectionId: section.id } })
  ).json();
  await page.request.post("/api/pages", { data: { workspaceId, title: childTitle, parentId: root.id } });

  const sidebar = page.locator("aside");
  // Le nœud d'arbre est un bouton sortable (≠ le lien « Récents », piloté par
  // PageVisit indépendamment de sectionId) : on cible le bouton pour prouver que
  // la page est bien rendue SOUS une section, pas seulement présente quelque part.
  const rootNode = sidebar.getByRole("button", { name: rootTitle });

  // Baseline : racine (sous « À supprimer ») + enfant visibles dans la sidebar.
  await page.goto(`/pages/${root.id}`);
  await expect(rootNode).toBeVisible();
  await expect(sidebar.getByText(childTitle)).toBeVisible();

  // Suppression de la section via l'API (aucune UI ne déclenche ce DELETE aujourd'hui).
  const del = await page.request.delete(`/api/sections/${section.id}`);
  expect(del.status()).toBe(200);

  // Après reload : la racine est rendue sous le repli team (pas orpheline) et
  // l'enfant suit via l'héritage.
  await page.goto(`/pages/${root.id}`);
  await expect(rootNode).toBeVisible();
  await expect(sidebar.getByText(childTitle)).toBeVisible();
});
