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

/**
 * Ids de la branche enracinée en `node` : l'id du nœud lui-même + tous les ids
 * de ses descendants (dossiers ET feuilles), en profondeur. Pur → testable.
 * Sert au repli/dépli RÉCURSIF d'une branche de la sidebar (Maj+clic sur le chevron).
 */
export function collectSubtreeIds(node: TreeNode): string[] {
  const ids: string[] = [node.id];
  for (const child of node.children) {
    ids.push(...collectSubtreeIds(child));
  }
  return ids;
}

/**
 * Prochain Set d'ids « repliés » après un Maj+clic sur le chevron de `node`
 * (repli/dépli RÉCURSIF de toute la branche). La direction dépend de l'état
 * courant du nœud cliqué :
 * - nœud déplié (absent du Set) → repli : ajoute l'id du nœud et de tous ses
 *   descendants au Set.
 * - nœud replié (présent dans le Set) → dépli : retire l'id du nœud et de tous
 *   ses descendants du Set.
 * Retourne TOUJOURS un nouveau Set (immutabilité, aucune mutation en place).
 */
export function toggleBranchCollapsed(
  collapsed: Set<string>,
  node: TreeNode
): Set<string> {
  const next = new Set(collapsed);
  const collapse = !collapsed.has(node.id);
  for (const id of collectSubtreeIds(node)) {
    if (collapse) next.add(id);
    else next.delete(id);
  }
  return next;
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

/** Référence d'un résultat de la palette de recherche pour dériver son chemin. */
export type SearchPathRef =
  | { kind: "page"; id: string }
  | { kind: "record"; pageId: string };

/**
 * Segments (labels) du chemin à afficher sous un résultat de la palette de recherche.
 * - `page` : fil de la page SANS son propre titre (déjà affiché en 1re ligne)
 *   → [section, …, dossier parent]. Page racine d'une section → [section] seul.
 * - `record` : fil COMPLET de la page hôte (la 1re ligne porte le titre du record,
 *   pas celui de la page hôte) → [section, …, page hôte].
 * Renvoie [] si l'élément est introuvable ou si le cache pages/sections est vide
 * (buildBreadcrumb renvoie []), pour que la 2e ligne soit simplement omise.
 */
export function searchResultPathSegments(
  pages: FlatPage[],
  sections: { id: string; name: string; icon: string | null }[],
  ref: SearchPathRef
): string[] {
  const targetId = ref.kind === "record" ? ref.pageId : ref.id;
  const crumbs = buildBreadcrumb(pages, sections, targetId);
  if (crumbs.length === 0) return [];
  const labels = crumbs.map((c) => c.label);
  return ref.kind === "record" ? labels : labels.slice(0, -1);
}

/**
 * Tronque un chemin (liste de segments) en conservant la FIN : préfixe « … › »
 * dès qu'un segment est retiré, et n'ampute JAMAIS le dernier segment (même s'il
 * dépasse à lui seul `maxChars`). Chemin qui tient dans le budget → rendu inchangé.
 */
export function truncatePathEnd(segments: string[], maxChars: number): string {
  const SEP = " › ";
  const ELLIPSIS = "…";
  if (segments.length === 0) return "";

  const full = segments.join(SEP);
  if (full.length <= maxChars) return full;

  // On garde toujours le dernier segment, puis on rajoute des segments depuis la
  // fin tant que le résultat préfixé par « … › » tient dans le budget.
  const kept = [segments[segments.length - 1]];
  for (let i = segments.length - 2; i >= 0; i--) {
    const candidate = ELLIPSIS + SEP + [segments[i], ...kept].join(SEP);
    if (candidate.length > maxChars) break;
    kept.unshift(segments[i]);
  }
  // Rien n'a été retiré (chemin d'un seul segment plus long que le budget) : pas
  // d'ellipse — on n'ampute jamais le dernier segment.
  if (kept.length === segments.length) return kept.join(SEP);
  return ELLIPSIS + SEP + kept.join(SEP);
}
