import { prisma } from "./prisma";
import type { Prisma } from "../../generated/prisma/client";

export const TRASH_PURGE_DAYS = 30;

/** Date-limite de purge : tout élément trashé AVANT cette date est purgé. Pur. */
export function purgeCutoff(now: Date = new Date()): Date {
  return new Date(now.getTime() - TRASH_PURGE_DAYS * 24 * 60 * 60 * 1000);
}

/** Ids du sous-arbre d'une page (racine incluse), par vagues de parentId. */
export async function collectPageSubtreeIds(
  tx: Prisma.TransactionClient,
  rootId: string
): Promise<string[]> {
  const all = [rootId];
  let frontier = [rootId];
  while (frontier.length > 0) {
    const children = await tx.page.findMany({
      where: { parentId: { in: frontier } },
      select: { id: true },
    });
    const ids = children.map((c) => c.id);
    all.push(...ids);
    frontier = ids;
  }
  return all;
}

/**
 * Trash (soft delete) une page ET tout son sous-arbre, en une transaction.
 * Le hard delete cascadait via les FK ; le soft delete doit propager à la main,
 * sinon la sidebar orphelinerait les enfants non trashés d'un parent trashé.
 * Idempotent. Restaure le même sous-arbre via restorePageSubtree.
 */
export async function trashPageSubtree(pageId: string, at: Date = new Date()): Promise<number> {
  return prisma.$transaction(async (tx) => {
    const ids = await collectPageSubtreeIds(tx, pageId);
    await tx.page.updateMany({ where: { id: { in: ids } }, data: { trashedAt: at } });
    return ids.length;
  });
}

/** Restaure une page ET tout son sous-arbre (trashedAt = null). */
export async function restorePageSubtree(pageId: string): Promise<number> {
  return prisma.$transaction(async (tx) => {
    const ids = await collectPageSubtreeIds(tx, pageId);
    await tx.page.updateMany({ where: { id: { in: ids } }, data: { trashedAt: null } });
    return ids.length;
  });
}

/**
 * Purge définitive des éléments en corbeille depuis plus de 30 j (hard delete).
 * Appelée PARESSEUSEMENT à l'ouverture de la corbeille (pas de cron en self-host).
 * Supprimer une page cascade (FK ON DELETE) sur son sous-arbre + database + records ;
 * on purge d'abord les records trashés isolés, puis les pages.
 */
export async function purgeExpiredTrash(
  now: Date = new Date()
): Promise<{ pages: number; records: number }> {
  const cutoff = purgeCutoff(now);
  const records = await prisma.record.deleteMany({ where: { trashedAt: { lt: cutoff } } });
  const pages = await prisma.page.deleteMany({ where: { trashedAt: { lt: cutoff } } });
  return { pages: pages.count, records: records.count };
}
