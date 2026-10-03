# 0039 : Post-mortem : le contrôle d'espace ne suffit pas pour un parent de page

- Date : 2026-08-08
- Référence : commit `4a19506` (PR #71)
- Statut : acceptée

## Contexte
`POST /api/pages` vérifiait que `parentId` appartenait à l'espace contrôlé, jamais que le parent était accessible : un éditeur pouvait créer une sous-page sous la page privée d'un autre membre.
`createPage` recopie la `visibility` du parent : l'enfant naissait privé au nom de son créateur, planté dans un arbre que le propriétaire ne verrait jamais, et remonté en racine orpheline chez le créateur, `buildTree` remontant un nœud dont le parent est absent de la map.
Le trou, préexistant, a été trouvé en cadrant les permissions par colonne.

## Décision
La route applique `isPageAccessible(parent, user.id, user.isService)` au parent et répond 404, jamais 403 : on ne dit pas qu'une page privée existe.
Le compte de service garde son exemption, et un test le vérifie (`tests/api/gardes-parent-et-rules.test.ts`), l'oubli du lot C ayant porté sur la même famille de routes (0025).

## Conséquences
Pour un id de rattachement de page, le bon espace ne suffit pas : l'accessibilité du parent se contrôle aussi (invariant 7 du CLAUDE.md).
`createPage` ne vérifie rien de sa cible et `setPageSection` n'en vérifie que l'espace : ce contrôle revient à la route.
Écart connu : un déplacement par `PATCH /api/pages/[id]` passe par `setPageSection` et ne teste ni l'accessibilité ni la mise en corbeille du nouveau parent (doctrine `modele`).
