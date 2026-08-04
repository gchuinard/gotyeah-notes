import { expect, type Page } from "@playwright/test";

/**
 * Crée un compte via POST /api/auth/register (REGISTRATION=on dans le harnais
 * E2E) : pose le cookie de session dans le contexte de `page` et provisionne
 * un workspace « Mon espace ». Le suffixe aléatoire évite la collision de deux
 * inscriptions dans la même milliseconde (User.email est unique).
 */
export async function register(page: Page, tag: string, displayName = "Testeur") {
  const email = `${tag}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}@x.tld`;
  const reg = await page.request.post("/api/auth/register", {
    data: { firstName: "Test", lastName: "E2E", displayName, email, password: "Test1234!" },
  });
  expect(reg.ok()).toBeTruthy();
  const workspaces = await (await page.request.get("/api/workspaces")).json();
  return { email, workspaceId: workspaces[0].id as string };
}
