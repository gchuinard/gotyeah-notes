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

export type WorkspaceRole = "admin" | "editor" | "viewer";

export const WORKSPACE_ROLES: WorkspaceRole[] = ["admin", "editor", "viewer"];

const ROLE_RANK: Record<WorkspaceRole, number> = { viewer: 0, editor: 1, admin: 2 };

/**
 * Rôles hiérarchiques : admin ⊇ editor ⊇ viewer. Tolère null (résultat brut de
 * getMembership) et un role inconnu en base (→ false, jamais d'exception).
 * Le mapping bool → 403 reste dans les routes, comme le mapping null → 404.
 */
export function hasRole(
  membership: { role: string } | null | undefined,
  required: WorkspaceRole
): boolean {
  if (!membership) return false;
  const rank = ROLE_RANK[membership.role as WorkspaceRole];
  return rank !== undefined && rank >= ROLE_RANK[required];
}

/**
 * Pour les routes SANS contexte workspace (/api/upload, /api/config) : le rôle
 * étant par-workspace, on approxime par « required quelque part » — un user
 * lecteur-partout ne peut ni uploader ni toucher la config d'instance.
 */
export async function hasRoleInAnyWorkspace(
  userId: string,
  required: WorkspaceRole
): Promise<boolean> {
  const allowed = WORKSPACE_ROLES.filter((r) => ROLE_RANK[r] >= ROLE_RANK[required]);
  const membership = await prisma.membership.findFirst({
    where: { userId, role: { in: allowed } },
    select: { role: true },
  });
  return membership !== null;
}

/**
 * Change le rôle d'un membre. Garde-fou « dernier admin » : rétrograder le seul
 * admin laisserait l'espace orphelin → refus. Count + update dans la MÊME
 * transaction (deux rétrogradations concurrentes hors transaction passeraient
 * toutes les deux le count). Union non-levante, façon setPageSection.
 */
export async function updateMemberRole(
  workspaceId: string,
  targetUserId: string,
  role: WorkspaceRole
): Promise<
  | { ok: true; membership: { userId: string; role: string } }
  | { ok: false; code: "not_found" | "last_admin" }
> {
  return prisma.$transaction(async (tx) => {
    const target = await tx.membership.findUnique({
      where: { userId_workspaceId: { userId: targetUserId, workspaceId } },
      select: { role: true },
    });
    if (!target) return { ok: false as const, code: "not_found" as const };

    if (target.role === "admin" && role !== "admin") {
      const admins = await tx.membership.count({ where: { workspaceId, role: "admin" } });
      if (admins <= 1) return { ok: false as const, code: "last_admin" as const };
    }

    const updated = await tx.membership.update({
      where: { userId_workspaceId: { userId: targetUserId, workspaceId } },
      data: { role },
      select: { userId: true, role: true },
    });
    return { ok: true as const, membership: updated };
  });
}

/**
 * Retire un membre de l'espace (y compris soi-même = quitter l'espace).
 * Même garde-fou transactionnel « dernier admin » que updateMemberRole.
 */
export async function removeMember(
  workspaceId: string,
  targetUserId: string
): Promise<{ ok: true } | { ok: false; code: "not_found" | "last_admin" }> {
  return prisma.$transaction(async (tx) => {
    const target = await tx.membership.findUnique({
      where: { userId_workspaceId: { userId: targetUserId, workspaceId } },
      select: { role: true },
    });
    if (!target) return { ok: false as const, code: "not_found" as const };

    if (target.role === "admin") {
      const admins = await tx.membership.count({ where: { workspaceId, role: "admin" } });
      if (admins <= 1) return { ok: false as const, code: "last_admin" as const };
    }

    await tx.membership.delete({
      where: { userId_workspaceId: { userId: targetUserId, workspaceId } },
    });
    return { ok: true as const };
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
