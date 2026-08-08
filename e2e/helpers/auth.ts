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

/**
 * Fait REJOINDRE un espace à un compte existant, de bout en bout.
 *
 * ⚠️ Depuis le 07/08, `POST /members` ne crée plus la Membership : il pose une
 * invitation, et la personne l'accepte depuis sa cloche. Un test qui a besoin
 * d'un membre installé doit donc jouer les DEUX temps — d'où ce helper, qui
 * évite de recopier la séquence dans chaque spec.
 */
export async function joinWorkspace(
  admin: Page,
  member: Page,
  workspaceId: string,
  email: string,
  role: "admin" | "editor" | "viewer" = "viewer"
) {
  const invited = await admin.request.post(`/api/workspaces/${workspaceId}/members`, {
    data: { email, role },
  });
  expect(invited.ok()).toBeTruthy();

  const notifications = await (await member.request.get("/api/notifications")).json();
  const invitation = notifications.find(
    (n: { actionable: boolean; invitationId: string | null }) => n.actionable && n.invitationId
  );
  expect(invitation, "aucune invitation actionnable reçue").toBeTruthy();

  const accepted = await member.request.post(`/api/invitations/${invitation.invitationId}`, {
    data: { action: "accept" },
  });
  expect(accepted.ok()).toBeTruthy();
}
