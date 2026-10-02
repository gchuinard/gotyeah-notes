---
paths:
  - "prisma/schema.prisma"
  - "src/lib/{pages,positions,trash,db,tree}.ts"
  - "src/app/api/{pages,sections,trash,search}/**/*"
---

# Le modèle de données : invariants

- Modifier `schema.prisma` = une nouvelle migration (`migrate dev --name …`), jamais l'édition d'une migration appliquée ; `db push` seulement sur une base jetable.
- Les énumérations (`role`, `type`, `visibility`, `state`…) sont des `String`, jamais un `enum` Prisma ; un champ JSON est une `String` sérialisée par ses `parse*`/`serialize*` de `lib/db.ts`, jamais le type `Json`.
- `Membership.role` a `"admin"` pour défaut : toute création de membership passe son rôle explicitement (un rôle d'invitation illisible retombe sur `viewer`).
- `parentId`, `sectionId` et `visibility` ne s'écrivent que dans `lib/pages.ts` ; `lib/trash.ts` n'écrit que `trashedAt` ; tout déplacement passe par `setPageSection`, qui rend `{ ok: false, code }` sans lever.
- `sectionId` ne se pose que sur une racine ; `visibility` est dénormalisée (racine = type de sa section, enfant = celle du parent) et propagée dans la transaction ; `Section.type` ne change jamais.
- `createPage` ne vérifie rien de sa cible : la route contrôle que le parent existe, hors corbeille, et accessible (`isPageAccessible`).
- `position` est un `Float` ; `nextPosition(model, where, tx)` rend MAX + 1000 (`databaseProperty`, `record`, `view`, `sprint` seulement) ; un réordonnancement n'écrit que l'élément déplacé.
- Seuls `Page` et `Record` ont un `trashedAt` : toute lecture filtre `trashedAt: null`, `trashPageSubtree` estampe le sous-arbre en une transaction ; ailleurs supprimer est définitif.
- Prisma 7 : les types `…Model` ne sont importés que par `lib/db.ts` (aliasés) ; ailleurs `ParsedRecord`, `ParsedView`, `ParsedDatabaseProperty` ; un client de transaction se type `Prisma.TransactionClient`.

Détail et gardes : `docs/doctrine/modele.md`.
