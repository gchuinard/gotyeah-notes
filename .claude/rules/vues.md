---
paths:
  - "src/app/api/{views,databases/*/views}/**/*"
  - "src/lib/client/{viewFilters,kanban,reorder,useWorkspaceMembers}.ts"
  - "src/components/databases/{DatabaseShell,TableView,KanbanView,CalendarView,GalleryView,FilterControls,SortControls,CardActions,SelectCheckbox,portal}.tsx"
---

# Les vues et les filtres : invariants

- Le type d'une vue est figé (un `PATCH` qui porte `type` répond 400) ; `DELETE` est admin, définitif, et refusé (400) sur la dernière vue.
- `View.config` s'écrit en remplacement total : réémettre `{ ...view.config, clé: valeur }`, jamais la seule clé. Il est partagé par tous les membres : la vue active (`?v=`) et la sélection ne s'y écrivent jamais.
- Toute clé de `ViewConfig` a une porte d'UI qui la pose (ADR 0042) ; un id de config n'est pas la preuve qu'une propriété existe encore.
- Filtres et tris s'appliquent côté client par `applyViewConfig(records, config, properties, currentUserId)` ; passer `currentUserId` à chaque appel : il est optionnel, tsc ne signale pas l'oubli, la vue « Moi » devient vide.
- Le filtre « Moi » stocke le jeton `@me`, jamais un userId ; `resolveFilterTokens` ne le résout que sur une propriété `user`, et sans identité il reste littéral (vue vide plutôt que complète).
- Sur `multiselect`, `relation` et `user`, seuls `contains`, `notContains`, `isEmpty` et `isNotEmpty` agissent ; n'écrire que des opérateurs de `FilterOperator`, un autre est sans effet et sans erreur.
- `viewFilters.ts` reste pur (son seul import est `@/lib/db`), parce qu'une route l'importe.
- Kanban : colonnes par `buildKanbanColumns`, axe `user` nourri des membres de l'espace de la database (`useWorkspaceMembers`), `displayName` jamais email ; « Membre retiré » n'est jamais cible de dépôt (`useDroppable({ disabled })` et retour anticipé de `handleDragEnd`) ; valeur au dépôt par `groupValueOnDrop`, id DnD par `cardDndId`.
- Un clic simple sur le titre d'une carte kanban ouvre la carte après `DOUBLE_CLICK_DELAY_MS`, le double-clic renomme : ne pas retirer ce report. Sous `md`, les actions de carte restent visibles, sans `pointer-events-none`.

Détail et gardes : `docs/doctrine/vues.md`.
