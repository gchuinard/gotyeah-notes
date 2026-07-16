import { prisma } from "./prisma";
import type { Prisma } from "../../generated/prisma/client";
import { appendReleaseNotesToContent, type BlockNoteBlock } from "./db";

type CreatePageInput = {
  title?: string;
  parentId?: string | null;
  workspaceId: string;
  ownerId: string;
  sectionId?: string | null;
};

export async function createPage({
  title = "Sans titre",
  parentId = null,
  workspaceId,
  ownerId,
  sectionId = null,
}: CreatePageInput) {
  let resolvedSectionId: string | null = null;
  let visibility: string;

  if (parentId) {
    // Child page: copy visibility from parent, sectionId stays null
    const parent = await prisma.page.findUnique({
      where: { id: parentId },
      select: { visibility: true },
    });
    visibility = parent?.visibility ?? "team";
  } else {
    // Root page: resolve section and derive visibility from it
    if (sectionId) {
      resolvedSectionId = sectionId;
    } else {
      // Default to user's private section
      const privateSection = await prisma.section.findFirst({
        where: { workspaceId, type: "private" },
        select: { id: true },
      });
      resolvedSectionId = privateSection?.id ?? null;
    }

    if (resolvedSectionId) {
      const section = await prisma.section.findUnique({
        where: { id: resolvedSectionId },
        select: { type: true },
      });
      visibility = section?.type === "private" ? "private" : "team";
    } else {
      visibility = "team";
    }
  }

  const last = await prisma.page.findFirst({
    where: {
      parentId,
      workspaceId,
      // Pour les pages racines, scoper la position à la section
      ...(parentId === null && resolvedSectionId ? { sectionId: resolvedSectionId } : {}),
    },
    orderBy: { position: "desc" },
    select: { position: true },
  });
  const position = (last?.position ?? 0) + 1;

  return prisma.page.create({
    data: {
      title,
      parentId,
      workspaceId,
      sectionId: resolvedSectionId,
      ownerId,
      visibility,
      position,
    },
  });
}

// ─── Déplacement de page (parent / section) ──────────────────────────────────

export type SetPageSectionInput = {
  // Présence de la clé = intention de la modifier. Absente = inchangée.
  parentId?: string | null;
  sectionId?: string | null;
};

export type SetPageSectionResult =
  | { ok: true; page: Awaited<ReturnType<typeof prisma.page.findUniqueOrThrow>> }
  | { ok: false; code: "page_not_found" | "section_on_child" | "cycle" | "target_not_found" };

/**
 * Collecte tous les descendants (récursivement) d'une page, par vagues de parentId.
 */
async function collectDescendantIds(
  tx: Prisma.TransactionClient,
  rootId: string
): Promise<string[]> {
  const all: string[] = [];
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
 * Déplace une page vers un autre parent et/ou une autre section, de façon SÛRE :
 * - sectionId n'est valide que sur une RACINE (parentId final null), sinon la
 *   section est héritée via la racine → refus "section_on_child".
 * - garde anti-cycle : le nouveau parent ne peut pas être la page elle-même ni
 *   l'un de ses descendants → refus "cycle".
 * - la cible (parent ou section) doit appartenir au même workspace → refus
 *   "target_not_found" (mappé en 404 côté route, anti-leak).
 * - la visibility est RE-DÉRIVÉE (racine : depuis le type de section ; enfant :
 *   depuis le parent) et PROPAGÉE récursivement à tout le sous-arbre, le tout
 *   dans une seule transaction.
 */
export async function setPageSection(
  pageId: string,
  input: SetPageSectionInput
): Promise<SetPageSectionResult> {
  return prisma.$transaction(async (tx): Promise<SetPageSectionResult> => {
    const current = await tx.page.findUnique({
      where: { id: pageId },
      select: { id: true, parentId: true, sectionId: true, workspaceId: true },
    });
    if (!current) return { ok: false, code: "page_not_found" };

    const hasParent = "parentId" in input;
    const hasSection = "sectionId" in input;
    const nextParentId = hasParent ? input.parentId ?? null : current.parentId;

    let nextSectionId: string | null;
    let nextVisibility: string;

    if (nextParentId) {
      // Devient (ou reste) un ENFANT : la section est héritée, pas définie ici.
      if (hasSection && input.sectionId != null) {
        return { ok: false, code: "section_on_child" };
      }
      // Anti-cycle : le parent ne doit pas être la page ni un de ses descendants.
      if (nextParentId === pageId) return { ok: false, code: "cycle" };
      const descendants = await collectDescendantIds(tx, pageId);
      if (descendants.includes(nextParentId)) return { ok: false, code: "cycle" };

      const parent = await tx.page.findUnique({
        where: { id: nextParentId },
        select: { workspaceId: true, visibility: true },
      });
      if (!parent || parent.workspaceId !== current.workspaceId) {
        return { ok: false, code: "target_not_found" };
      }
      nextSectionId = null;
      nextVisibility = parent.visibility;
    } else {
      // Devient (ou reste) une RACINE : résoudre la section et en dériver la visibility.
      const targetSectionId = hasSection
        ? input.sectionId ?? null
        : current.sectionId;

      let resolved = targetSectionId;
      if (!resolved) {
        const privateSection = await tx.section.findFirst({
          where: { workspaceId: current.workspaceId, type: "private" },
          select: { id: true },
        });
        resolved = privateSection?.id ?? null;
      }

      if (resolved) {
        const section = await tx.section.findUnique({
          where: { id: resolved },
          select: { type: true, workspaceId: true },
        });
        if (!section || section.workspaceId !== current.workspaceId) {
          return { ok: false, code: "target_not_found" };
        }
        nextVisibility = section.type === "private" ? "private" : "team";
      } else {
        nextVisibility = "team";
      }
      nextSectionId = resolved;
    }

    const page = await tx.page.update({
      where: { id: pageId },
      data: { parentId: nextParentId, sectionId: nextSectionId, visibility: nextVisibility },
    });

    // Propager la visibility à tout le sous-arbre (dénormalisation).
    const descendants = await collectDescendantIds(tx, pageId);
    if (descendants.length > 0) {
      await tx.page.updateMany({
        where: { id: { in: descendants } },
        data: { visibility: nextVisibility },
      });
    }

    return { ok: true, page };
  });
}

// ─── Notes de version : append à la page « Patch notes » ─────────────────────

export type AppendReleaseNotesResult =
  | { status: "appended" }
  | { status: "already" }
  | { status: "no_page" } // pas de mapping, ou page introuvable / hors workspace / en corbeille / inaccessible
  | { status: "corrupt" };

/**
 * Append (idempotent) le groupe de blocs de notes de version À LA FIN du document
 * BlockNote de la page cible, DANS la transaction fournie (même atomicité que la
 * clôture du sprint). Ne lève jamais : renvoie un statut que l'appelant traduit
 * (flag de réponse ou rollback selon le cas). Robustesse du mapping libre :
 * page absente / d'un autre workspace / en corbeille / inaccessible à l'acteur
 * (page privée d'un autre membre) ⇒ "no_page" (défense en profondeur : le mapping
 * est déjà refusé à la configuration, mais la visibility peut changer après coup).
 */
export async function appendReleaseNotesToPage(
  tx: Prisma.TransactionClient,
  opts: {
    pageId: string | null;
    workspaceId: string;
    userId: string;
    sprintId: string;
    blocks: BlockNoteBlock[];
  }
): Promise<AppendReleaseNotesResult> {
  if (!opts.pageId) return { status: "no_page" };

  const page = await tx.page.findUnique({
    where: { id: opts.pageId },
    select: { content: true, workspaceId: true, trashedAt: true, visibility: true, ownerId: true },
  });
  if (
    !page ||
    page.workspaceId !== opts.workspaceId ||
    page.trashedAt ||
    (page.visibility === "private" && page.ownerId !== opts.userId)
  ) {
    return { status: "no_page" };
  }

  const result = appendReleaseNotesToContent(page.content, opts.sprintId, opts.blocks);
  if (result.status === "corrupt") return { status: "corrupt" };
  if (result.status === "already") return { status: "already" };

  await tx.page.update({ where: { id: opts.pageId }, data: { content: result.content } });
  return { status: "appended" };
}

// ─── Suppression de section (réaffectation des racines) ──────────────────────

export type DeleteSectionResult =
  | { ok: true }
  | { ok: false; code: "section_not_found" | "no_fallback" };

/**
 * Supprime une section en réaffectant d'abord ses pages RACINES vers une section
 * de repli du MÊME type dans le même workspace, le tout en une seule transaction
 * (réaffectation + suppression atomiques : une erreur en cours annule le tout).
 *
 * Le repli same-type garantit que la visibility dénormalisée reste identique →
 * aucune resync récursive des descendants n'est nécessaire (ils héritent via la
 * racine). Si aucune section de repli du même type n'existe → refus "no_fallback"
 * (409 côté route) : on ne supprime jamais au prix de pages orphelines.
 *
 * Respecte la convention « ne jamais écrire Page.sectionId hors d'un helper lib/ ».
 */
export async function deleteSectionReassigningRoots(
  sectionId: string
): Promise<DeleteSectionResult> {
  return prisma.$transaction(async (tx): Promise<DeleteSectionResult> => {
    const section = await tx.section.findUnique({
      where: { id: sectionId },
      select: { id: true, workspaceId: true, type: true },
    });
    if (!section) return { ok: false, code: "section_not_found" };

    // Repli déterministe : autre section du MÊME type dans le workspace.
    const fallback = await tx.section.findFirst({
      where: {
        workspaceId: section.workspaceId,
        type: section.type,
        id: { not: sectionId },
      },
      orderBy: [{ position: "asc" }, { id: "asc" }],
      select: { id: true },
    });
    if (!fallback) return { ok: false, code: "no_fallback" };

    // Repli same-type → visibility inchangée → réaffecter les seules racines.
    await tx.page.updateMany({
      where: { sectionId, parentId: null },
      data: { sectionId: fallback.id },
    });

    await tx.section.delete({ where: { id: sectionId } });
    return { ok: true };
  });
}
