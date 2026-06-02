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
