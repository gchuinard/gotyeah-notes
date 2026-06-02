import { prisma } from "./prisma";

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
