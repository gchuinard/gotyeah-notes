# Doctrine : Vues et filtres

Périmètre : le modèle `View` et ses routes, `View.config`, le filtrage et le tri (`applyViewConfig`, jeton `@me`), la création depuis une vue filtrée, le kanban (colonnes, dépôt, titre), les onglets de vues et le réordonnancement, `CardActions` et la sélection dans chaque vue. Le backlog et `sprintScope` relèvent de la doctrine `sprints-backlog`.
Invariants courts : `.claude/rules/vues.md` · Décisions datées : `docs/adr/`

## Fichiers

- `src/app/api/databases/[id]/views/route.ts` (`POST`) et `src/app/api/views/[id]/route.ts` (`PATCH`, `DELETE`).
- `src/lib/client/viewFilters.ts` : `resolveFilterTokens`, `deriveSeedFromFilters`, `applyFilters`, `applySorts`, `applyViewConfig`. Pur, son seul import est `@/lib/db`.
- `src/lib/client/kanban.ts` : logique pure du kanban (colonnes, ids DnD, valeur au dépôt, bouton d'ajout, propriétés de carte).
- `src/lib/client/reorder.ts` : `intermediatePosition`, position d'un élément déplacé.
- `src/lib/client/useWorkspaceMembers.ts` : membres de l'espace de la database, pour les cellules, les filtres et les colonnes `user`.
- `src/components/databases/DatabaseShell.tsx` : onglets de vues, barre d'outils (Trier, Filtrer, compteur), branchement vers la vue active. Vues : `TableView`, `KanbanView`, `CalendarView`, `GalleryView`, `BacklogView` (doctrine `sprints-backlog`). Contrôles : `FilterControls`, `SortControls`, `CardActions`, `SelectCheckbox`, `portal.tsx`.
- `src/app/pages/[id]/page.tsx` : Server Component qui résout au SSR le rôle et `currentUserId`, puis monte `DatabaseShell`.

## Le modèle `View` et ses routes

- Le type d'une vue est l'un de `VIEW_TYPES` (`table`, `kanban`, `calendar`, `gallery`, `backlog`) et il est fixé à la création : un `PATCH` qui porte `type` répond 400 (`type cannot be changed`). Pour changer de type, créer une autre vue. Non testé.
- Une database naît avec une vue table « Vue principale » (`config: {}`) ; un template y ajoute un kanban groupé et, pour le scrum, un backlog (doctrines `records` et `sprints-backlog`).
- `POST /api/databases/[id]/views` : éditeur+, `nextPosition("view", …, tx)` dans la transaction de création, 201. `PATCH /api/views/[id]` (`name`, `config`, `position`) : éditeur+. `DELETE /api/views/[id]` : admin, définitif (une vue n'a pas de corbeille), 400 sur la dernière vue d'une database. Garde : `tests/api/role-gates.test.ts` pour les rôles ; le refus de la dernière vue : non testé.
- `GET /api/databases/[id]` rend les vues triées par `position` et le `workspaceId` de la database, source des membres côté client (voir Kanban).
- Supprimer une propriété ne nettoie aucun `View.config` : un id disparu y est ignoré à la lecture (filtre sans effet, tri sauté), et un `groupByPropertyId` disparu ramène le kanban au choix de l'axe. Ne pas tenir un id de config pour la preuve qu'une propriété existe. Non testé.
- Une option select encore citée par un filtre de vue ou par `doneStatusOptionId` ne se retire pas (400, `findReferencedOptionIds`) : le filtre resterait sinon sur un id fantôme. Garde : `tests/api/property-options.test.ts` (cas AC5), `tests/unit/propertyConfig.test.ts`.

## `View.config`

- Remplacement total au `PATCH`, sans merge : réémettre le config complet, `{ ...view.config, clé: valeur }`, jamais la seule clé modifiée. Tous les écrans le font. `notes_update_view` (MCP) transmet `config` tel quel : un agent relit la vue avant d'écrire. Garde : `e2e/view-settings-toggle.spec.ts` (l'axe survit à la bascule) ; le remplacement côté serveur : non testé.
- `DatabaseProperty.config` suit la même règle, avec une exception limitée à `rules` (doctrine `roles-permissions`).
- Le serveur ne valide que la forme (`z.record(z.string(), z.unknown())`) : toute clé est stockée. La liste des clés fait foi dans le type `ViewConfig` (`src/lib/db.ts`) :
  - `filters`, `sorts` : toutes les vues ;
  - `groupByPropertyId`, `createInUnassignedOnly` : kanban ;
  - `calendarPropertyId` : calendrier ;
  - `columnWidths` : table ;
  - `visiblePropertyIds` : lue par la galerie seulement (trois propriétés au plus) ;
  - `pointsPropertyId`, `statusPropertyId`, `epicPropertyId`, `doneStatusOptionId`, `sprintScope` : backlog et board scrum (doctrine `sprints-backlog`).
- Le config est partagé par tous les membres : trier, filtrer, choisir l'axe ou la date, élargir une colonne change la vue de tout le monde. Ces contrôles sont masqués en lecture seule, où un kanban ou un calendrier non configuré affiche un message au lieu du sélecteur ; le serveur exige éditeur+. Garde : `tests/api/role-gates.test.ts` pour le rôle ; le masquage : non testé.
- Une clé sans écran qui l'écrit n'existe pas pour l'utilisateur (ADR 0042) : ajouter une clé à `ViewConfig`, c'est ajouter la porte qui la pose. `visiblePropertyIds` est dans ce cas : aucun écran ne l'écrit, seul le MCP peut la poser.
- Ce qui n'est pas partagé : la vue active, lue dans `?v=<viewId>` (défaut : la première par position), et la sélection multiple. Ne jamais les écrire dans le config.

## Filtrer et trier

- Le filtrage se fait côté client : `GET /api/databases/[id]/records` rend toutes les cartes hors corbeille, et chaque vue applique `applyViewConfig(records, config, properties, currentUserId?: string | null)`, qui résout les jetons, filtre puis trie (ADR 0009). Utiliser ce helper, pas un filtre local.
- Les filtres se combinent en ET. Les tris s'appliquent dans l'ordre de la liste : un select se trie sur le nom de l'option, pas sur l'ordre des options ; un champ multi-valeurs sur son nombre de valeurs ; un texte par `localeCompare` en français.
- `multiselect`, `relation` et `user` sont des tableaux : seuls `contains`, `notContains`, `isEmpty` et `isNotEmpty` y agissent, `eq` et `neq` sont sans effet. `FilterControls` mappe donc « est / n'est pas » d'une propriété `user` sur `contains`/`notContains`. Garde : `tests/unit/viewFilters-user.test.ts`, `tests/unit/viewFilters-relation.test.ts`.
- Un opérateur hors `FilterOperator`, ou non géré pour le type, est sans effet (`applyFilters` rend `true`) : le filtre s'affiche actif et ne filtre rien, sans erreur ; sur `number` et `date`, seules les cartes sans valeur sont écartées. N'écrire que des opérateurs de `FilterOperator` : `contains` sur un tableau, pas `is`. `GET …/records?filter=` ne valide que la forme de l'opérateur (`z.string()`). Les anciennes vues en `is` ont été normalisées en `contains` (ADR 0020). Garde : `tests/unit/viewFilters-user.test.ts` pour un opérateur non géré (`eq` sur `user`) ; un opérateur hors `FilterOperator` : non testé.
- Écart signalé, sans fiche à ce jour : `FilterControls` donne à une propriété `relation` les opérateurs et la saisie d'un texte ; « est / n'est pas » y sont sans effet, et « contient » exige l'id exact d'une carte cible.
- L'ordre manuel prime dans le kanban et le backlog : `buildKanbanColumns` retrie chaque colonne par `position`, et `BacklogView` vide `sorts`. Écart signalé, sans fiche à ce jour : le contrôle Trier y reste proposé, sans effet.
- Le compteur de la barre d'outils (« N / M éléments ») applique les filtres de la vue à toute la database, sans le scope de sprint. Non testé.
- Côté serveur, seul `GET /api/databases/[id]/records?filter=` filtre, en réutilisant `applyFilters` et `resolveFilterTokens` : pas de seconde implémentation. Les autres paramètres (`limit`, `offset`, `includeContent`) relèvent de la doctrine `api`. Garde : `tests/api/records-list-query.test.ts` (cas AC4).
- `viewFilters.ts` est donc importé par une route : il reste pur, sans hook ni API navigateur (invariant 15 du CLAUDE.md). Exception connue : il vit encore dans `lib/client/` (fiche Discovery « Routes API : viewFilters hors de lib/client, JSON.parse remplacés par des helpers »).

## Filtre « Moi » : le jeton `@me`

- Un filtre « Moi » stocke `CURRENT_USER_TOKEN` (`"@me"`, `src/lib/db.ts`), jamais un userId : le config est partagé, et un id figé donnerait à tout le monde les cartes de son auteur (ADR 0018). `FilterControls` propose « Moi » en tête des membres, sur une propriété `user`.
- Le jeton se résout à la lecture par `resolveFilterTokens(filters, currentUserId, properties)`, et seulement sur une propriété `user` : « @me » saisi dans le filtre d'une colonne texte reste littéral, sinon cette vue tomberait à zéro résultat pour tout le monde. Sans jeton, la fonction rend le même tableau (mémos React stables). Garde : `tests/unit/filterTokens.test.ts`.
- Toute porte qui lit un filtre résout le jeton : `applyViewConfig(records, config, properties, currentUserId?)`, `deriveSeedFromFilters(filters, properties, currentUserId?)` et `GET …/records?filter=`, qui le résout sur l'appelant ; sans cette dernière, un consommateur de l'API comme le MCP filtrerait sur la chaîne littérale et recevrait zéro carte, sans erreur. Liste courante : `grep -rE 'resolveFilterTokens\(' src | grep -v 'export function'`. Garde : `tests/unit/filterTokens.test.ts`, `tests/api/records-filter-me.test.ts`.
- Passer `currentUserId` à `applyViewConfig` et `deriveSeedFromFilters` à chaque appel : le paramètre est optionnel, donc tsc ne signale pas son oubli ; la vue « Moi » est alors vide, et une carte créée depuis elle naît sans assigné puis disparaît à la revalidation.
- Sans identité, le jeton est laissé tel quel : la vue est vide plutôt que complète, parce qu'un board vide se remarque et qu'un board montrant les cartes de tout le monde ne se remarque pas. `deriveSeedFromFilters` ne sème alors rien : la chaîne `@me` dans un champ `user` ferait un 400. Garde : `tests/unit/filterTokens.test.ts`.
- `currentUserId` est résolu au SSR (`src/app/pages/[id]/page.tsx`), passé à `DatabaseShell`, puis à chaque vue et au compteur : pas de flash, pas de route `/api/me` pour ça. Garde : `e2e/kanban-me-filter.spec.ts` pour le kanban ; les autres vues : non testé (`tests/unit/actorWiring.test.ts` garde `actor`, pas `currentUserId`).
- Par le pont MCP, l'appelant est le compte incarné : `@me` y désigne ce compte, pas la personne qui parle à l'agent (doctrine `mcp`).

## Créer une carte depuis une vue filtrée

- `deriveSeedFromFilters(filters, properties, currentUserId)` sème ce que les filtres imposent, pour que la carte créée reste visible après revalidation : `eq` sur un `select` ou un `text`, `contains` sur un `user` (tableau d'un id). Rien pour les autres opérateurs, ni pour `multiselect`, `relation`, `number`, `title`, ni pour une valeur non textuelle. Garde : `tests/unit/deriveSeedFromFilters.test.ts`, `tests/unit/viewFilters-user.test.ts`, `e2e/filtered-create-seed.spec.ts`.
- Dans le kanban, la valeur de la colonne cliquée prime sur un filtre qui vise la même propriété (`mergeSeedWithGroupValue`). Garde : `tests/unit/kanban.test.ts` (cas C5).
- La table, le kanban et la galerie l'appliquent. Écart signalé, sans fiche à ce jour : le calendrier ne pose que la date du jour cliqué et le backlog ne sème rien ; une carte créée là dans une vue filtrée peut disparaître à la revalidation.

## Kanban

- L'axe (`groupByPropertyId`) est une propriété `select`, `multiselect` ou `user`. Sans axe, un éditeur voit le sélecteur, un lecteur le message « Vue kanban non configurée ».
- Les colonnes viennent de `buildKanbanColumns(records, propertyId, type, seeds, { includeOrphans })`, dans cet ordre : « Sans valeur » (`optionId: null`), les graines dans leur ordre, puis la colonne orpheline, présente seulement si une carte y tombe. Les graines (`KanbanColumnSeed`, `{ id, label }`) sont injectées par l'appelant : options pour `select` et `multiselect`, membres de l'espace pour `user`, qui n'a pas d'options à dessein. Ne pas lire `config.options` pour un axe `user`. Garde : `tests/unit/kanbanColumns.test.ts`, `e2e/kanban-me-filter.spec.ts` (kanban regroupé par assigné).
- Les membres viennent de `useWorkspaceMembers(workspaceId)`, avec le `workspaceId` de la database (`GET /api/databases/[id]`), pas `useWorkspace().activeWorkspace` : une page ouverte par lien profond ou par Cmd+K appartient parfois à un autre espace. Non testé.
- La clé `/api/workspaces/[id]/members` est partagée avec Réglages → Membres et alimente cellules, filtres et graines : n'y greffer aucun appel lent, un IdP lent bloquerait sinon l'ouverture d'un board (doctrine `auth-invitations`). Exception connue : Réglages → Membres lit cette clé avec son propre `membersFetcher`, et `useWorkspaceMembers` n'a pas `noRetryOn4xx` (fiche Discovery « Fin de l'unification du fetcher (membersFetcher, noRetryOn4xx) »).
- Colonnes, filtre et cellules affichent le `displayName` d'un membre, jamais son email, que `GET /api/workspaces/[id]/members` renvoie pourtant à tout membre (invariant 13 du CLAUDE.md). Garde : `e2e/user-property.spec.ts` (cellule de table) ; filtre et colonnes kanban : non testé.
- Un axe `user` ne se dessine pas avant la réponse des membres : sans graines, toute carte assignée serait classée « Membre retiré », puis le board se réorganiserait sous le curseur. Le kanban affiche « Chargement des membres… », et une erreur explicite si la liste ne vient pas (le hook expose `error` pour ça). `includeOrphans` reste faux pendant le chargement, en seconde ceinture. Non testé.
- Colonne « Membre retiré » (`ORPHAN_COL`, axe `user` seulement) : la carte d'un membre parti y reste visible au lieu de disparaître. Elle est réservée à `user` parce que le serveur refuse déjà de retirer une option select référencée (ADR 0018). Garde : `tests/unit/kanbanColumns.test.ts`.
- Cette colonne porte `optionId: null` et n'est jamais une cible de dépôt : y déposer une carte appliquerait la sémantique « Sans valeur » et effacerait ses assignés. Deux gardes, toutes deux nécessaires : `useDroppable({ disabled })`, et un retour anticipé dans `handleDragEnd`, parce que dnd-kit laisse passer un dépôt sur une carte de la colonne. Même double garde pour une colonne verrouillée par une règle de transition (doctrine `roles-permissions`). Non testé.
- On sort une carte de « Membre retiré » en la déposant sur un membre : au dépôt sur un axe `user`, la valeur passe par `withoutUnknownIds(valeur, memberIds)`, qui lâche le lien mort ; sans lui, `validateUserValues` refuserait tout le tableau (doctrine `records`). Garde : `e2e/kanban-me-filter.spec.ts`, `tests/unit/kanbanColumns.test.ts`.
- La valeur écrite au dépôt vient de `groupValueOnDrop` : un id, ou `null`, pour un `select` ; pour un type multi-valeurs (`isMultiValueType`), un tableau où l'id source est remplacé par l'id cible, les autres valeurs conservées ; « Sans valeur » rend `null`, qui retire la clé. Ne jamais écrire une chaîne dans un champ tableau : l'optimiste passe, le serveur refuse. Garde : `tests/unit/kanban.test.ts`, `e2e/kanban-multiselect.spec.ts`.
- Une carte multiselect apparaît dans plusieurs colonnes : son id DnD est `colonne::record` (`cardDndId`, `parseDndId`), qui dit de quelle colonne part le glissement. Utiliser ces helpers, pas `record.id`. Garde : `tests/unit/kanban.test.ts`.
- Renommer une colonne : un clic sur le badge de l'en-tête, seulement pour une colonne qui porte une vraie option (`select` ou `multiselect`), jamais pour « Sans valeur », une colonne de membre ou « Membre retiré », et pas en lecture seule. Le `PATCH /api/properties/[id]` réémet le config complet de la propriété. Non testé.
- Bouton « Nouveau » : ancré en tête de colonne, absent de la colonne orpheline et d'une colonne verrouillée. Avec `createInUnassignedOnly`, il n'apparaît que sur « Sans valeur » (`shouldShowKanbanAddButton`) ; le réglage change l'affichage du bouton, pas sa position. Il se pose depuis le menu ⋯ de l'onglet, sur un kanban seulement. Garde : `tests/unit/kanban.test.ts`, `tests/unit/laneAddButton.test.ts`, `e2e/view-settings-toggle.spec.ts`, `e2e/lane-add-button.spec.ts`.
- Propriétés affichées sur une carte (`buildCardProps`) : les deux premières par position, hors titre et axe, plus « Main à » et « Projet », toujours présentes, repérées par nom normalisé (`FORCED_CARD_PROPERTY_NAMES`). Garde : `tests/unit/kanban.test.ts`.
- Le kanban ne charge les sprints que si `sprintScope` est défini ; le board scrum relève de la doctrine `sprints-backlog`.
- Capteurs des cartes : `MouseSensor` + `TouchSensor`, sans `touch-none`, car la carte entière porte les listeners et le défilement du board serait gelé (doctrine `ui`, ADR 0028).

## Titre d'une carte kanban : clic simple, double-clic

- Un clic simple sur le titre ouvre la carte, comme partout ailleurs sur elle ; un double-clic la renomme (ADR 0044).
- L'ouverture est reportée de `DOUBLE_CLICK_DELAY_MS` (300 ms) : un double-clic émet deux `click` avant le `dblclick`, et sans report le premier ouvrirait le panneau, le renommage démarrant derrière. Garder ce report, ne pas le retirer pour simplifier.
- L'arbitrage tient dans un seul handler grâce à `e.detail` (2 = second clic du geste), qui arrive avant `dblclick`.
- Le report ne porte que sur le titre : ailleurs sur la carte, l'ouverture est immédiate. En lecture seule, pas de report, il n'y a rien à départager.
- Chaque branche a son test : clic simple et double-clic dans `e2e/kanban-title-dblclick.spec.ts`, double-clic aussi dans `e2e/kanban-inline-edit.spec.ts` (cas AC1). Sans le test du clic simple, on supprimerait le report et le titre deviendrait une zone morte.
- Cibler le champ par `data-card-title-input`, pas par `input[value='…']`, qui cesse de correspondre à la première frappe.

## Onglets de vues et réordonnancement

- L'ordre des onglets est `View.position`, partagé par tous. Glisser un onglet calcule sa position par `intermediatePosition` et n'envoie qu'un `PATCH { position }` sur la vue déplacée, optimiste, avec retour arrière en cas d'échec. Garde : `tests/api/views-reorder.test.ts`, `e2e/view-tabs-reorder.spec.ts`, `tests/unit/reorder.test.ts`.
- Les onglets gardent `MouseSensor` seul : leurs listeners couvrent l'onglet entier dans une bande qui défile, et un `TouchSensor` empêcherait d'atteindre les derniers onglets au doigt (doctrine `ui`, ADR 0028). Un clic qui bouge de moins de 6 px change de vue sans réordonner.
- Menu ⋯ d'un onglet (`TabMenu`, dans `DatabaseShell`) : Renommer ; sur un kanban, « Créer seulement dans « Sans valeur » » ; Supprimer, pour un admin et s'il reste une autre vue. Aucun menu en lecture seule.
- L'ordre manuel des cartes est `Record.position`, unique pour la database : déplacer une ligne de table déplace aussi la carte dans sa colonne kanban. On n'écrit que l'élément déplacé, dans l'écart laissé par `nextPosition` (1000), jamais une renumérotation.
- Utiliser `intermediatePosition`, pas un calcul local. Écart signalé, sans fiche à ce jour : `TableView` et `KanbanView` recopient la même formule en ligne.

## Actions sur les cartes et sélection

- `CardActions` (Dupliquer, Supprimer) sert chaque vue. `onDelete` est optionnel : la table, le kanban et le backlog le passent ; la galerie et le calendrier n'ont que Dupliquer, et on n'y ajoute pas de suppression. Absent en lecture seule. Garde : `tests/unit/cardActions.test.ts`, `e2e/card-actions.spec.ts`, `e2e/duplicate-all-views.spec.ts`.
- Sous `md`, les actions sont visibles d'office : `opacity-0` ne désarme pas le clic, et une action masquée se déclenchait au toucher (Dupliquer crée une carte sans confirmation). Ne pas ajouter `pointer-events-none` à la branche masquée : Playwright ne clique plus après survol. Exception : le calendrier les retire sous `md`, faute de place sur la pilule d'un jour.
- La duplication est immédiate ; la confirmation de suppression est chez l'appelant, par `useDialog().confirm`.
- Sélection multiple : `SelectCheckbox` (table, kanban), état local à la vue, vidé au changement de vue, jamais écrit en base. Les actions groupées relèvent de la doctrine `records`. Garde : `tests/unit/selectCheckbox.test.ts`, `e2e/select-checkbox.spec.ts`.
- Menus et popovers des vues (⋯ d'onglet, Trier, Filtrer, ajout de vue) passent par `portal.tsx`. Son `minWidth` suit le libellé le plus large du menu : il sert à clamper le menu près du bord droit.

## Chargement des cartes

- `DatabaseShell` et les vues partagent la clé SWR `/api/databases/[id]/records` : un seul fetch. `DatabaseShell` la déclare avec `noRetryOn4xx`, les vues non. Exception connue : les clés records et sprints des vues n'appliquent pas encore `noRetryOn4xx` (fiche Discovery « Fin de l'unification du fetcher (membersFetcher, noRetryOn4xx) »).
- Écart signalé, sans fiche à ce jour : les vues (table, kanban, calendrier, galerie, backlog) testent `isLoading` avant `error`, à rebours de l'ordre erreur, chargement, vide, liste de la doctrine `ui` ; `DatabaseShell` suit cet ordre.
