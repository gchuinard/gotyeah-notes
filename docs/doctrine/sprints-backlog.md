# Doctrine : Sprints et backlog

Périmètre : le modèle `Sprint` et `Record.sprintId`, la vue `backlog`, le board scopé (`View.config.sprintScope`), l'API des sprints, la clôture transactionnelle et ses notes de version, la page « Patch notes » (`Database.patchNotesPageId`).
Invariants courts : `.claude/rules/sprints-backlog.md` · Décisions datées : `docs/adr/`

## Fichiers

- `src/app/api/databases/[id]/sprints/route.ts` : `GET` (liste triée par `position`), `POST` (création).
- `src/app/api/sprints/[id]/route.ts` : `PATCH` (champs, démarrer, clôturer), `DELETE`.
- `src/lib/db.ts` : `SprintState`, `ParsedSprint`, les clés backlog de `ViewConfig`, et la logique pure des notes de version (`buildReleaseNotesBlocks`, `reconcileDelivered`, `appendReleaseNotesToContent`, `releaseNotesBlockId`).
- `src/lib/pages.ts` : `appendReleaseNotesToPage`, l'écriture dans la page, dans la transaction de la clôture.
- `src/lib/workspace.ts` : `checkSprintAccess`.
- `src/components/databases/BacklogView.tsx` : la vue backlog (lanes, points, épics, cycle du sprint). `KanbanView.tsx` : `SprintBoardHeader` et le scope du board.
- `src/lib/templates.ts` (`builtin-scrum`, type `BacklogConfig`) et `src/app/api/databases/route.ts` (scaffold) : le câblage d'une database scrum.

## Modèle

- `Sprint` appartient à une database (Cascade : supprimer la database supprime ses sprints). Champs : `name` (défaut « Sprint »), `goal`, `startDate`, `endDate`, `state`, `position`, `releaseNotes` (ADR 0003).
- `state` est une `String` (`future | active | completed`, défaut `future`) validée par `z.enum` dans les deux routes, pas un enum Prisma.
- `releaseNotes` vaut `null` tant que le sprint n'a pas été clôturé. Seule la clôture l'écrit : aucun schéma de route ne l'accepte en entrée.
- `Record.sprintId` : `null` = backlog. `onDelete: SetNull` : supprimer un sprint renvoie ses cartes au backlog sans rien perdre. Tenu par le schéma, non testé.
- Supprimer un sprint est définitif (pas de `trashedAt`) et réservé à l'admin : nom, objectif et notes de version disparaissent avec lui.
- Position : `nextPosition("sprint", { databaseId }, tx)` dans la transaction du `POST` (`tests/api/concurrency.test.ts`, cas « idem property / view / sprint »). Le `PATCH` accepte une `position` libre.
- Transitions : l'API n'impose que la règle du sprint actif unique. `future → active` démarre, `active → completed` clôture, `completed → active` rouvre (menu du backlog seulement), `active → future` passe aussi. Non testé au-delà du 409.

## Un seul sprint actif

- Une database a au plus un sprint `active`. Le `PATCH` qui pose `state: "active"` cherche un autre sprint actif et écrit dans la même `$transaction` ; le conflit lève une erreur typée, traduite en 409 hors de la transaction. Sans elle, deux démarrages concurrents (UI et MCP) passeraient le contrôle tous les deux (ADR 0003). Garde : `tests/api/concurrency.test.ts` (« démarrer un 2e sprint alors qu'un est actif → 409 », sans course réelle simulée).
- Redémarrer le sprint déjà actif répond 200 : le contrôle exclut son propre id (même fichier, second cas AC3).
- Aucune contrainte en base ne porte la règle : elle ne tient que dans le code des routes.
- Écart signalé, sans fiche à ce jour : `POST /api/databases/[id]/sprints` accepte `state: "active"` sans ce contrôle, et `notes_create_sprint` transmet `state`. Deux créations en `active` donnent deux sprints actifs. Pour démarrer un sprint, utiliser le `PATCH`, pas le `POST`.

## Affecter une carte à un sprint

- `POST /api/databases/[id]/records` et `PATCH /api/records/[id]` acceptent `sprintId`. Un sprint d'une autre database → 400 « Sprint introuvable » ; `null` renvoie au backlog. L'état du sprint n'est pas vérifié : une carte peut rejoindre un sprint terminé. Non testé.
- `POST /api/records/[id]/duplicate` recopie `sprintId` (`tests/api/record-duplicate.test.ts`). Un changement de sprint n'écrit pas de révision (doctrine `records`).
- Dans l'UI, une carte change de sprint par le glisser-déposer du backlog, seul geste de réaffectation, ou naît dans un sprint : création dans une lane, ou sur un board scopé (elle prend le sprint ciblé). Côté MCP, le paramètre `sprint` de `notes_create_record` / `notes_update_record` prend un nom ou `"backlog"` (doctrine `mcp`).
- Une carte en corbeille garde son `sprintId` : la clôture ne la renvoie pas et ne la liste pas. Restaurée, elle revient dans son sprint, même terminé. Non testé.

## Vue backlog

- Type de vue `backlog` (l'un des `VIEW_TYPES` de `src/app/api/databases/[id]/views/route.ts`). Story points, statut et épic ne sont pas un nouveau concept : ce sont des propriétés ordinaires (number, select, select), câblées par id dans `View.config` : `pointsPropertyId`, `statusPropertyId`, `epicPropertyId`, et `doneStatusOptionId` (l'option du statut qui vaut « terminé »). Liste complète des clés de `View.config` : doctrine `vues`.
- Aucun écran ne pose ce câblage : il vient du scaffold `builtin-scrum`, sinon de `PATCH /api/views/[id]` (`notes_update_view`). Une vue backlog créée depuis les onglets naît avec un config vide.
- Sans câblage, la vue dégrade : lanes par sprint, sans points, sans avancement, sans panneau d'épics ; chaque ligne montre le titre et les autres colonnes renseignées.
- Lanes : sprints actifs, puis à venir (par `position`), puis le backlog, puis les sprints terminés, repliés par défaut. Une carte dont le `sprintId` ne correspond à aucun sprint chargé tombe dans le backlog.
- Ordre manuel : les filtres de la vue s'appliquent (`applyViewConfig`), ses tris sont ignorés, les cartes suivent `position`.
- Points : somme par lane ; « terminés/total » quand `statusPropertyId` et `doneStatusOptionId` sont câblés.
- Le panneau d'épics filtre localement, sans rien écrire dans la vue.
- Une option citée par le `doneStatusOptionId` d'une vue ne se supprime pas (400, `findReferencedOptionIds`). Garde : `tests/api/property-options.test.ts` (AC5).
- Lecteur : ni création de sprint ou d'issue, ni menu de sprint ; « Supprimer » n'est proposé qu'à l'admin. Le 403 du serveur reste l'autorité.
- `releaseNotes` s'affiche en lecture seule dans la lane d'un sprint terminé, même repliée.
- Écart signalé, sans fiche à ce jour : `BacklogView` et `KanbanView` ne lisent pas l'erreur de la clé `/sprints`. Un échec de chargement montre toutes les cartes au backlog, ou « Aucun sprint actif » sur le board, au lieu d'un état d'erreur (ordre de rendu : doctrine `ui`). Cette clé n'applique pas non plus `noRetryOn4xx` : exception connue (doctrine `ui`, fiche Discovery « Fin de l'unification du fetcher (membersFetcher, noRetryOn4xx) »).

## Board scopé (scrum)

- `View.config.sprintScope` d'une vue kanban : absent = kanban classique, qui ne charge pas les sprints ; `"all"` = toutes les cartes, avec l'en-tête de sprint ; `"active"` = le sprint actif ; un id = ce sprint. Cible introuvable (aucun sprint actif, sprint supprimé) : board vide et « Aucun sprint actif ». Non testé.
- `sprintScope` naît du scaffold ou de l'API (`notes_update_view`) ; un kanban créé depuis les onglets n'en a pas, et aucun écran ne l'ajoute. Une fois posé, le sélecteur du board le change (sprint actif, un sprint, toutes les cartes) mais ne le retire pas : revenir au kanban classique passe par l'API.
- Changer de scope réécrit le `View.config` : le choix vaut pour tous les membres. Le lecteur ne voit que le libellé.
- Le statut est l'axe commun : `statusPropertyId` du backlog = `groupByPropertyId` du board, d'où un avancement visible des deux côtés.
- Démarrer (sprint `future`) et terminer (sprint `active`) se font depuis le backlog comme depuis le board ; rouvrir, depuis le backlog seulement.
- Scaffold `builtin-scrum` (`POST /api/databases { templateId }`) : colonnes Statut, Type, Priorité, Épic, Story points, Assigné ; board « Sprint actif » groupé sur Statut, avec `sprintScope: "active"` et `doneStatusOptionId: "done"` ; vue « Backlog » câblée, en position 500 pour être l'onglet par défaut. Non testé.

## Clôture

- `PATCH /api/sprints/[id]` avec `state: "completed"`, et en option `moveIncompleteToBacklog`, `statusPropertyId`, `doneStatusOptionId`. Une seule transaction, dans cet ordre (ADR 0014) :
  1. mise à jour du sprint (état et autres champs du même PATCH) ;
  2. si `moveIncompleteToBacklog` et le statut sont fournis, les cartes du sprint hors corbeille dont le statut n'est pas `doneStatusOptionId` passent à `sprintId: null` ;
  3. si `releaseNotes` est déjà rempli : fin, avec `patchNotesAppend: "already"`, sans régénération ni ajout ;
  4. les cartes restées dans le sprint sont les livrées (par `position`) ; si le statut est fourni, chacune doit être terminée, sinon rollback et 422 (réconciliation) ;
  5. écriture de `releaseNotes` ;
  6. ajout du bloc à la page « Patch notes » ; contenu illisible → rollback et 422.
- Gardes : `tests/api/concurrency.test.ts` (AC4, renvoi des non terminées), `tests/api/sprint-patch-notes.test.ts` (AC1 à AC6 et contenu illisible), `tests/api/sprint-release-notes.test.ts`, `e2e/sprint-patch-notes.spec.ts`.
- Le statut conditionne tout : sans `statusPropertyId` et `doneStatusOptionId`, rien ne retourne au backlog, aucune réconciliation n'a lieu, et toutes les cartes du sprint sont listées livrées. Avec le statut mais sans `moveIncompleteToBacklog`, une seule carte non terminée donne 422 (`tests/api/sprint-patch-notes.test.ts`, AC2).
- Ce que chaque client envoie :
  - `BacklogView` : `moveIncompleteToBacklog: true` et le statut de son propre `View.config` ;
  - le board : son `groupByPropertyId` comme statut, et le `doneStatusOptionId` de sa vue ;
  - `notes_update_sprint` : avec `database_id`, le statut lu dans la vue backlog, et un `mcpWarning` si elle n'est pas câblée ; sans `database_id`, ni statut ni avertissement (doctrine `mcp`).
- Écart signalé, sans fiche à ce jour : le board clôture avec son axe comme statut. Regroupé sur une autre colonne (assigné, priorité) avec un `doneStatusOptionId` posé, comme sur le board scaffoldé, « Terminer le sprint » renvoie toutes les cartes au backlog et publie des notes à zéro issue livrée.
- `releaseNotes` est un markdown : nom du sprint, « Clôturé le <date> », objectif, liste des livrées, nombre de reportées. Il s'écrit une seule fois : une seconde clôture, après réouverture comme en double appel, ne régénère rien et n'ajoute rien à la page, même si des cartes ont rejoint le sprint entre-temps. Gardes : `tests/api/sprint-release-notes.test.ts` (AC2), `tests/api/sprint-patch-notes.test.ts` (AC4). Conséquence : un mapping posé après la première clôture n'est jamais rattrapé (non testé).
- La date des notes et du bloc est l'`endDate` du sprint quand elle est posée, sinon le jour de la clôture (UTC) : une clôture anticipée porte la date prévue.
- Réponse : le sprint, plus `patchNotesAppend` (`appended`, `already` ou `no_page`) dès que l'état demandé est `completed`.
- Rôle : éditeur, clôture comprise, car c'est le même handler `PATCH` (`tests/api/role-gates.test.ts`, qui le teste par un renommage).

## Page « Patch notes »

- `Database.patchNotesPageId` est une référence libre, sans relation Prisma : `null` = pas de mapping, ce n'est pas une erreur (ADR 0014).
- Écriture par `PATCH /api/databases/[id]` (éditeur) : la page doit exister, être du même espace et accessible (`isPageAccessible(target, user.id, user.isService)`), sinon 400. `null` retire le mapping sans contrôle. Une page en corbeille n'est pas refusée à ce stade. Gardes : `tests/api/database-patchnotes-mapping.test.ts` (page privée d'autrui, autre espace, page d'équipe, sa propre page privée), `tests/api/service-account.test.ts` (le compte de service mappe une page privée de son espace).
- Ajout par `appendReleaseNotesToPage`, qui ne lève jamais : la page est revérifiée (existante, même espace, hors corbeille, accessible à l'acteur, `isService` compris), car la visibilité peut changer après le mapping ; sinon `no_page`, et la clôture réussit. Revérification non testée.
- `appendReleaseNotesToContent` : contenu non JSON ou non tableau → `corrupt` (422 et rollback, jamais d'écrasement) ; bloc du sprint déjà présent → `already` ; sinon les blocs s'ajoutent en fin de document, sans réordonner l'existant. Garde : `tests/unit/releaseNotesBlocks.test.ts`.
- Bloc ajouté : titre de niveau 2 composé de « <nom> », d'un tiret cadratin et de « <date> » (`lib/db.ts` l'écrit ainsi), d'id `release-notes-<sprintId>` (le marqueur d'idempotence), un paragraphe « N issues livrées », une puce par livrée (« Sans titre » pour un titre vide), un paragraphe des reportées s'il y en a.
- Aucun écran ne pose `patchNotesPageId` : l'API, donc `notes_set_patch_notes_page`, est le seul chemin (ADR 0042). Une database sans mapping clôture quand même, avec `no_page`.
- Rattachement : même règle que tout id reçu (invariant 7 du CLAUDE.md) ; le refus est un 400, pas un 404.

## API

| Route | Méthode | Rôle | Codes propres |
|---|---|---|---|
| `databases/[id]/sprints` | GET · POST | membre · éditeur | 201 à la création |
| `sprints/[id]` | PATCH | éditeur | 409 sprint déjà actif, 422 clôture |
| `sprints/[id]` | DELETE | admin | aucun |
| `databases/[id]` | PATCH `patchNotesPageId` | éditeur | 400 page refusée |

- Accès : `checkDatabaseAccess` pour la liste et la création, `checkSprintAccess` pour un sprint. Tous deux rendent `null` (404) pour un non-membre, une page hôte privée d'autrui ou en corbeille. Garde : `tests/api/access-isolation.test.ts` (page privée d'autrui) ; le cas de la corbeille n'y est pas testé pour les sprints.
- Gates de rôle : `tests/api/role-gates.test.ts` (table `DECLARED`, un cas par handler).
- `PATCH /api/sprints/[id]` valide le corps (400) avant le contrôle d'accès, à rebours de l'ordre 401 → 404 → 403 de la doctrine `api`. Sans fuite, la validation ne lisant pas la base.
- `startDate` et `endDate` arrivent en chaîne et sont convertis par `new Date()` ; `null` efface la date.
