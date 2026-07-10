import { test, expect } from "@playwright/test";

test("GET /api/pages sans session → 401", async ({ request }) => {
  const res = await request.get("/api/pages");
  expect(res.status()).toBe(401);
});

test("inscription puis home affiche l'écran d'accueil", async ({ page }) => {
  const email = `e2e-${Date.now()}@example.com`;
  const res = await page.request.post("/api/auth/register", {
    data: {
      firstName: "E2E",
      lastName: "Bot",
      displayName: "E2E Bot",
      email,
      password: "Test1234!",
    },
  });
  expect(res.ok()).toBeTruthy();

  // Le cookie de session posé par /register vit dans le contexte du navigateur.
  await page.goto("/");
  await expect(
    page.getByText("Sélectionne une page ou crée-en une nouvelle.")
  ).toBeVisible();
});
