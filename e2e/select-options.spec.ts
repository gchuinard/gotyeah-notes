import { test, expect, type Page } from "@playwright/test";

/** Fixture : page → database → propriété select (o1/o2) → record sur o1. */
async function seed(page: Page, tag: string) {
  const email = `${tag}-${Date.now()}@x.tld`;
  const reg = await page.request.post("/api/auth/register", {
    data: { firstName: "S", lastName: "O", displayName: "SO", email, password: "Test1234!" },
  });
  expect(reg.ok()).toBeTruthy();
  const workspaceId = (await (await page.request.get("/api/workspaces")).json())[0].id;

  const pg = await (
    await page.request.post("/api/pages", { data: { workspaceId, title: "DB selopt" } })
  ).json();
  const db = await (await page.request.post("/api/databases", { data: { pageId: pg.id } })).json();

  const prop = await (
    await page.request.post(`/api/databases/${db.id}/properties`, {
      data: {
        name: "Statut",
        type: "select",
        config: {
          type: "select",
          options: [
            { id: "o1", name: "À faire", color: "blue" },
            { id: "o2", name: "Fait", color: "green" },
          ],
        },
      },
    })
  ).json();

  await page.request.post(`/api/databases/${db.id}/records`, {
    data: { title: "Ticket X", properties: { [prop.id]: "o1" } },
  });

  return { pageId: pg.id as string, propId: prop.id as string };
}

test("options de select : rename+recolor suivent sur les badges ; suppression d'une option référencée refusée", async ({ page }) => {
  const { pageId: pgId, propId } = await seed(page, "selopt");
  const pg = { id: pgId };
  const prop = { id: propId };

  await page.goto(`/pages/${pg.id}`);
  await expect(page.getByText("À faire")).toBeVisible();

  // ── Renommer + recolorer l'option o1 via le popover de colonne ──────────────
  await page.getByRole("columnheader", { name: "Statut" }).click();
  const optInput = page.locator('input[placeholder="Option sans nom"]').first();
  await expect(optInput).toHaveValue("À faire");

  const renamed = page.waitForResponse(
    (r) => r.url().includes(`/api/properties/${prop.id}`) && r.request().method() === "PATCH"
  );
  await optInput.fill("En cours");
  await renamed;

  const recolored = page.waitForResponse(
    (r) => r.url().includes(`/api/properties/${prop.id}`) && r.request().method() === "PATCH"
  );
  await page.locator('button[title="red"]').first().click();
  await recolored;

  // Reload → le badge du record suit (id d'option stable, name/color à jour).
  await page.goto(`/pages/${pg.id}`);
  await expect(page.getByText("En cours")).toBeVisible();
  await expect(page.getByText("À faire")).toHaveCount(0);

  // ── Supprimer l'option o1, encore référencée par le record → refus + restauration ──
  await page.getByRole("columnheader", { name: "Statut" }).click();
  const row = page.locator('input[placeholder="Option sans nom"]').first();
  await expect(row).toHaveValue("En cours");

  const refused = page.waitForResponse(
    (r) => r.url().includes(`/api/properties/${prop.id}`) && r.request().method() === "PATCH"
  );
  await row.locator("xpath=following-sibling::button").click();
  const res = await refused;
  expect(res.status()).toBe(400);

  // L'UI affiche l'erreur et restaure l'option (elle existe toujours en base).
  await expect(page.getByText(/Option référencée/)).toBeVisible();
  await expect(page.locator('input[placeholder="Option sans nom"]').first()).toHaveValue("En cours");
});

// Régression : un PATCH part à chaque frappe. Vider le champ pour retaper produisait
// un name="" refusé (400) qui restaurait l'ancien nom en pleine saisie.
test("vider le nom d'une option pour le retaper : aucun PATCH refusé, aucune erreur affichée", async ({ page }) => {
  const { pageId, propId } = await seed(page, "selopt-retype");

  const rejected: number[] = [];
  page.on("response", (r) => {
    if (r.url().includes(`/api/properties/${propId}`) && r.request().method() === "PATCH" && r.status() >= 400) {
      rejected.push(r.status());
    }
  });

  await page.goto(`/pages/${pageId}`);
  await page.getByRole("columnheader", { name: "Statut" }).click();
  const optInput = page.locator('input[placeholder="Option sans nom"]').first();
  await expect(optInput).toHaveValue("À faire");

  // Champ vidé : rien n'est envoyé, aucune erreur, la saisie reste vide.
  await optInput.click();
  await optInput.press("Control+a");
  await optInput.press("Backspace");
  await expect(optInput).toHaveValue("");
  await expect(page.getByText(/Validation failed|refusée|référencée/)).toHaveCount(0);

  // On retape : l'enregistrement reprend et le badge du record suit.
  await optInput.pressSequentially("Terminé");
  await expect(page.getByText("Terminé")).toBeVisible();

  await page.goto(`/pages/${pageId}`);
  await expect(page.getByText("Terminé")).toBeVisible();
  expect(rejected).toEqual([]);
});
