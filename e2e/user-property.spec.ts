import { test, expect } from "@playwright/test";
import { register } from "./helpers/auth";

// Propriété « utilisateur » : la cellule liste les MEMBRES de l'espace de la
// database, écrit un tableau d'ids, et n'expose jamais leur email. Deux
// contextes navigateur = deux comptes réels (cookies isolés, workers: 1).

test("assigner un membre depuis une cellule utilisateur, filtrer dessus, sans fuite d'email", async ({
  page,
  browser,
}) => {
  const a = await register(page, "userprop-a", "Alice Admin");
  const ctxB = await browser.newContext();
  const pageB = await ctxB.newPage();
  const b = await register(pageB, "userprop-b", "Bob Membre");
  await ctxB.close();

  // B devient membre de l'espace de A (éditeur), donc assignable.
  const added = await page.request.post(`/api/workspaces/${a.workspaceId}/members`, {
    data: { email: b.email, role: "editor" },
  });
  expect(added.ok()).toBeTruthy();

  // Database + colonne « Assigné » de type user + une carte.
  const pg = await (
    await page.request.post("/api/pages", { data: { workspaceId: a.workspaceId, title: "DB assignés" } })
  ).json();
  const db = await (await page.request.post("/api/databases", { data: { pageId: pg.id } })).json();
  const prop = await (
    await page.request.post(`/api/databases/${db.id}/properties`, {
      data: { name: "Assigné", type: "user" },
    })
  ).json();
  await page.request.post(`/api/databases/${db.id}/records`, { data: { title: "Ticket X" } });

  await page.goto(`/pages/${pg.id}`);
  await expect(page.getByText("Ticket X")).toBeVisible();

  // ── Assigner Bob depuis la cellule ─────────────────────────────────────────
  const saved = page.waitForResponse(
    (r) => r.url().includes("/api/records/") && r.request().method() === "PATCH"
  );
  // Colonnes de la ligne : [poignée/index, Titre, Assigné, suppression].
  const assigneeCell = page.getByRole("row").filter({ hasText: "Ticket X" }).getByRole("cell").nth(2);
  // Le clic peut partir avant l'hydratation React (next dev) → auto-réessayé.
  await expect(async () => {
    await assigneeCell.click();
    await expect(page.getByPlaceholder("Rechercher un membre…")).toBeVisible({ timeout: 2000 });
  }).toPass();
  await page.getByRole("button", { name: /Bob Membre/ }).click();
  await page.keyboard.press("Escape");
  const res = await saved;
  expect(res.status()).toBe(200);

  // La valeur écrite est bien un TABLEAU d'ids (pas une string).
  const records = await (await page.request.get(`/api/databases/${db.id}/records`)).json();
  expect(records[0].properties[prop.id]).toEqual([expect.any(String)]);

  // ── Reload : le badge persiste, l'email du membre n'est jamais affiché ─────
  await page.goto(`/pages/${pg.id}`);
  await expect(page.getByText("Bob Membre").first()).toBeVisible();
  await expect(page.getByText(b.email)).toHaveCount(0);
});
