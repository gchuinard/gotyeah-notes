import { prisma } from "@/lib/prisma";

/**
 * Factory de données de test : crée un User + un Workspace + la Membership admin.
 * Réutilisable par les tests API des tickets à venir. Retourne les entités créées.
 * Les tests forgent la session en mockant getSession (voir tests/api/pages.test.ts) ;
 * un vrai cookie n'est nécessaire que côté E2E Playwright.
 */
export async function seedUserWithWorkspace(email = `test-${Date.now()}@example.com`) {
  const user = await prisma.user.create({
    data: {
      email,
      firstName: "Test",
      lastName: "User",
      displayName: "Test User",
      passwordHash: "not-a-real-hash",
    },
  });
  const workspace = await prisma.workspace.create({
    data: { name: "Espace de test", createdBy: user.id },
  });
  await prisma.membership.create({
    data: { userId: user.id, workspaceId: workspace.id, role: "admin" },
  });
  return { user, workspace };
}

/**
 * Ajoute un membre (user + membership) à un workspace existant, avec un rôle
 * explicite — pour les tests par rôle (admin/editor/viewer du MÊME espace).
 * L'email par défaut inclut le rôle : deux Date.now() dans la même milliseconde
 * collisionneraient sinon (User.email est @unique).
 */
export async function seedMember(
  workspaceId: string,
  role: "admin" | "editor" | "viewer",
  email = `member-${role}-${Date.now()}@example.com`
) {
  const user = await prisma.user.create({
    data: {
      email,
      firstName: "Test",
      lastName: role,
      displayName: `Test ${role}`,
      passwordHash: "not-a-real-hash",
    },
  });
  const membership = await prisma.membership.create({
    data: { userId: user.id, workspaceId, role },
  });
  return { user, membership };
}
