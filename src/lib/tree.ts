export type FlatPage = {
  id: string;
  title: string;
  icon: string | null;
  parentId: string | null;
  position: number;
  sectionId: string | null;
  visibility: string;
  ownerId: string | null;
};

export type TreeNode = FlatPage & { children: TreeNode[] };

export function buildTree(pages: FlatPage[]): TreeNode[] {
  const map = new Map<string, TreeNode>();
  pages.forEach((p) => map.set(p.id, { ...p, children: [] }));

  const roots: TreeNode[] = [];
  map.forEach((node) => {
    if (node.parentId && map.has(node.parentId)) {
      map.get(node.parentId)!.children.push(node);
    } else {
      roots.push(node);
    }
  });

  const sortRec = (nodes: TreeNode[]) => {
    nodes.sort((a, b) => a.position - b.position);
    nodes.forEach((n) => sortRec(n.children));
  };
  sortRec(roots);
  return roots;
}

export type Crumb = { label: string; href: string | null; icon: string | null };

/**
 * Fil d'ariane d'une page : [section, racine, …, page courante].
 * - La section (dérivée du `sectionId` de la racine) n'est pas cliquable (href null).
 * - La page courante (dernière) n'est pas cliquable non plus.
 * - Renvoie [] si la page n'est pas dans la liste (route sans page, liste non chargée).
 * Pur → testable. `pages` = liste plate (cf. GET /api/pages), `sections` = GET /api/sections.
 */
export function buildBreadcrumb(
  pages: FlatPage[],
  sections: { id: string; name: string; icon: string | null }[],
  currentId: string
): Crumb[] {
  const byId = new Map(pages.map((p) => [p.id, p]));
  if (!byId.has(currentId)) return [];

  // Remonte la chaîne parentId → [racine, …, courante] (garde anti-cycle).
  const chain: FlatPage[] = [];
  const seen = new Set<string>();
  let node: FlatPage | undefined = byId.get(currentId);
  while (node && !seen.has(node.id)) {
    seen.add(node.id);
    chain.unshift(node);
    node = node.parentId ? byId.get(node.parentId) : undefined;
  }

  const crumbs: Crumb[] = [];
  const rootSectionId = chain[0]?.sectionId ?? null;
  if (rootSectionId) {
    const sec = sections.find((s) => s.id === rootSectionId);
    if (sec) crumbs.push({ label: sec.name, href: null, icon: sec.icon });
  }
  chain.forEach((p, i) => {
    const isLast = i === chain.length - 1;
    crumbs.push({
      label: p.title || "Sans titre",
      href: isLast ? null : `/pages/${p.id}`,
      icon: p.icon,
    });
  });
  return crumbs;
}
