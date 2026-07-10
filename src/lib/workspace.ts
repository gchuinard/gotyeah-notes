import { prisma } from "./prisma";

/**
 * Règle de confidentialité intra-workspace : une page privée n'est accessible
 * qu'à son propriétaire. Alignée sur getPageWithMembership (api/pages/[id]).
 * Les databases/records/etc. posés sur une page privée héritent de cette règle
 * via les check*Access — sinon un membre du workspace lirait le contenu privé
 * d'un autre membre.
 */
export function isPageAccessible(
  page: { visibility: string; ownerId: string | null },
  userId: string
): boolean {
  return !(page.visibility === "private" && page.ownerId !== userId);
}

/**
 * Vérifie que userId a une Membership pour le workspace auquel appartient
 * la database, ET que la page hôte lui est accessible (privée → propriétaire).
 *
 * Retourne null si la database n'existe pas, si l'user n'a pas accès, ou si la
 * page est privée et n'appartient pas à l'user.
 */
export async function checkDatabaseAccess(
  databaseId: string,
  userId: string,
  includeTrashed = false
) {
  const db = await prisma.database.findUnique({
    where: { id: databaseId },
    select: {
      id: true,
      page: { select: { workspaceId: true, visibility: true, ownerId: true, trashedAt: true } },
    },
  });
  if (!db) return null;
  // Une database sur une page en corbeille est inaccessible (cascade logique).
  if (!includeTrashed && db.page.trashedAt) return null;
  const membership = await getMembership(userId, db.page.workspaceId);
  if (!membership) return null;
  if (!isPageAccessible(db.page, userId)) return null;
  return { workspaceId: db.page.workspaceId, membership };
}

/**
 * Vérifie que userId a accès à la property via property → database → page → workspaceId.
 *
 * Retourne null si la property n'existe pas ou si l'user n'a pas accès.
 */
export async function checkPropertyAccess(propertyId: string, userId: string) {
  const row = await prisma.databaseProperty.findUnique({
    where: { id: propertyId },
    select: {
      id: true,
      databaseId: true,
      type: true,
      database: {
        select: {
          page: { select: { workspaceId: true, visibility: true, ownerId: true, trashedAt: true } },
        },
      },
    },
  });
  if (!row) return null;
  if (row.database.page.trashedAt) return null;
  const membership = await getMembership(userId, row.database.page.workspaceId);
  if (!membership) return null;
  if (!isPageAccessible(row.database.page, userId)) return null;
  const { database: _db, ...property } = row;
  return {
    workspaceId: row.database.page.workspaceId,
    membership,
    databaseId: row.databaseId,
    property,
  };
}

/**
 * Vérifie que userId a accès au record via record → database → page → workspaceId.
 * Retourne le record inclus pour éviter un 2e findUnique dans les routes PATCH/DELETE.
 */
export async function checkRecordAccess(
  recordId: string,
  userId: string,
  includeTrashed = false
) {
  const row = await prisma.record.findUnique({
    where: { id: recordId },
    include: {
      database: {
        select: {
          page: { select: { workspaceId: true, visibility: true, ownerId: true, trashedAt: true } },
        },
      },
    },
  });
  if (!row) return null;
  // Record trashé OU sous une page trashée → inaccessible (sauf lifecycle corbeille).
  if (!includeTrashed && (row.trashedAt || row.database.page.trashedAt)) return null;
  const membership = await getMembership(userId, row.database.page.workspaceId);
  if (!membership) return null;
  if (!isPageAccessible(row.database.page, userId)) return null;
  // Strip the nested relation so routes can pass `record` straight to parseRecord.
  const { database: _db, ...record } = row;
  return {
    workspaceId: row.database.page.workspaceId,
    membership,
    databaseId: row.databaseId,
    record,
  };
}

/**
 * Vérifie que userId a accès à la view via view → database → page → workspaceId.
 * Retourne la view dans le résultat pour éviter un 2e findUnique dans les routes.
 */
export async function checkViewAccess(viewId: string, userId: string) {
  const row = await prisma.view.findUnique({
    where: { id: viewId },
    include: {
      database: {
        select: {
          page: { select: { workspaceId: true, visibility: true, ownerId: true, trashedAt: true } },
        },
      },
    },
  });
  if (!row) return null;
  if (row.database.page.trashedAt) return null;
  const membership = await getMembership(userId, row.database.page.workspaceId);
  if (!membership) return null;
  if (!isPageAccessible(row.database.page, userId)) return null;
  const { database: _db, ...view } = row;
  return {
    workspaceId: row.database.page.workspaceId,
    membership,
    databaseId: row.databaseId,
    view,
  };
}

/**
 * Vérifie que userId a accès au sprint via sprint → database → page → workspaceId.
 * Retourne le sprint dans le résultat pour éviter un 2e findUnique dans les routes.
 */
export async function checkSprintAccess(sprintId: string, userId: string) {
  const row = await prisma.sprint.findUnique({
    where: { id: sprintId },
    include: {
      database: {
        select: {
          page: { select: { workspaceId: true, visibility: true, ownerId: true, trashedAt: true } },
        },
      },
    },
  });
  if (!row) return null;
  if (row.database.page.trashedAt) return null;
  const membership = await getMembership(userId, row.database.page.workspaceId);
  if (!membership) return null;
  if (!isPageAccessible(row.database.page, userId)) return null;
  const { database: _db, ...sprint } = row;
  return {
    workspaceId: row.database.page.workspaceId,
    membership,
    databaseId: row.databaseId,
    sprint,
  };
}

export async function getMembership(userId: string, workspaceId: string) {
  return prisma.membership.findUnique({
    where: { userId_workspaceId: { userId, workspaceId } },
    select: { role: true },
  });
}

export async function createWorkspaceWithDefaults(name: string, userId: string) {
  return prisma.$transaction(async (tx) => {
    const workspace = await tx.workspace.create({
      data: { name, createdBy: userId },
    });
    await tx.membership.create({
      data: { userId, workspaceId: workspace.id, role: "admin" },
    });
    await tx.section.createMany({
      data: [
        { name: "Pages privées", type: "private", position: 0, workspaceId: workspace.id },
        { name: "Espace d'équipe", type: "team", position: 1, workspaceId: workspace.id },
      ],
    });
    return workspace;
  });
}
