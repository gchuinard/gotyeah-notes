# Doctrine : Modèle de données

Périmètre : la carte des modèles Prisma, l'arbre des pages (section, visibilité, propriétaire), les positions, la corbeille, les champs JSON et les types générés.
Invariants courts : `.claude/rules/modele.md` · Décisions datées : `docs/adr/`

## Carte des modèles

Le schéma fait foi pour les champs et les relations (`prisma/schema.prisma`) ; le nombre de modèles se lit avec `grep -c '^model ' prisma/schema.prisma`. Deux de ses commentaires sont périmés : `WorkspaceInvitation` (« devient une Membership toute seule ») et `LoginToken` (« la consommation crée le compte ») ; les lignes ci-dessous les corrigent. Une ligne par modèle, le détail vit dans la doctrine indiquée.

- `User` : `email` unique, normalisé par `normalizeEmail` ; `firstName`, `lastName`, `displayName`, `passwordHash`, `isService`. `displayName` est le seul nom affiché (en-tête, barre latérale, acteur des révisions) ; prénom et nom ne servent qu'au profil et à la création de comptes. `isService` : doctrine `roles-permissions`.
- `Session` : `id = sha256(token)`, le jeton ne vit qu'en cookie ; `currentWorkspaceId` = espace actif (SetNull) ; index sur `expiresAt` pour la purge. Doctrine `auth-invitations`.
- `LoginToken` : jeton de connexion par email. `id = sha256(token)`, `email` normalisé, `expiresAt`, aucune relation vers `User` (l'adresse peut ne pas avoir de compte). La consommation du lien (`consumeMagicLink`) ne crée jamais de compte : sur ce chemin, seule l'acceptation par `POST /api/invitations/claim` en crée un. Doctrine `auth-invitations` (ADR 0027).
- `Workspace` : conteneur partageable ; sa suppression cascade tout son contenu. `createdBy` n'est qu'une référence : l'autorité, c'est `Membership`.
- `Membership` : `(userId, workspaceId, role)`, unique sur `(userId, workspaceId)` ; rôles `admin | editor | viewer`, appliqués par `hasRole` (doctrine `roles-permissions`).
- `WorkspaceInvitation` : proposition d'un rôle à une adresse normalisée, que le compte existe ou non ; unique sur `(workspaceId, email)`, `invitedBy` en SetNull. Elle devient une `Membership` à l'acceptation, ou par `grant: true` sur un compte OIDC neuf, puis la ligne est supprimée ; un refus la conserve avec `declinedAt`. Doctrine `auth-invitations` (ADR 0035).
- `Section` : conteneur de la barre latérale ; `name`, `type` `private | team` figé à la création, `icon`, `position`. Voir « Pages ».
- `Page` : arbre par `parentId` (Cascade), `sectionId` sur les racines seulement, `visibility` dénormalisée, `ownerId` = créateur, `content` (document BlockNote), `trashedAt`. Voir « Pages ».
- `PageVisit` : upsert sur `(userId, pageId)` à chaque visite ; alimente « Récents » (`GET /api/pages/recent`, les 5 dernières).
- `Database` : liée 1-1 à une page (`pageId` unique) : une database est une page, et une page en porte au plus une (409). `recordTemplate` = corps libre pré-rempli à la création d'une carte (`PATCH /api/databases/[id]`, `notes_set_record_template`). `templateId` + `recordSections` = template source et squelette de sections estampé, copié à la création pour survivre au template (ADR 0004). `patchNotesPageId` = référence libre, sans relation Prisma (doctrine `sprints-backlog`).
- `DatabaseProperty` : colonne dynamique (`name`, `type`, `position`, `config` JSON). Les types sont ceux de `PropertyType` (`lib/db.ts`) : `title`, `text`, `number`, `select`, `multiselect`, `date`, `checkbox`, `url`, `email`, `relation`, `user`. Doctrine `records`.
- `Record` : ligne d'une database. `title`, `properties` (JSON indexé par `DatabaseProperty.id`), corps libre `content` ou corps sectionné `templateId` + `sectionsBody`, `sprintId` (null = backlog, SetNull), `createdBy` (SetNull), `coverUrl`, `position`, `trashedAt`. Doctrine `records` ; `sprintId` : doctrine `sprints-backlog`.
- `RecordRevision` : une ligne par champ réellement changé d'un record (`field`, `before`/`after` en JSON, `actorId` en SetNull), sans purge. Doctrine `records` (ADR 0013).
- `RecordComment` : fil d'une carte, texte brut, append-only (ni `updatedAt` ni `deletedAt`) ; `recordId` en Cascade, `authorId` en SetNull. Doctrine `records` (ADR 0041).
- `RecordAttachment` : référence d'un fichier sur disque (`fileName` = `<uuid>.<ext>`, `name` d'origine, `mimeType`, `size`) ; `recordId` en Cascade, `uploadedBy` en SetNull ; pas de `trashedAt`. Doctrine `uploads` (ADR 0040).
- `Sprint` : sprint d'une database ; `state` `future | active | completed`, `releaseNotes`, `position`. Doctrine `sprints-backlog` (ADR 0003).
- `View` : vue d'une database ; `type` parmi `VIEW_TYPES` (`table | kanban | calendar | gallery | backlog`), `config` JSON réécrit en entier. Doctrine `vues`.
- `Template` : modèle par espace (`columns`, `kanbanGroupProperty`, `sections` `[{id, label}]`). Les templates fournis (scrum, ticket, bug) vivent en code (`lib/templates.ts`, id `builtin-*`, lecture seule). Doctrine `records`.
- `Notification` : message de la cloche, jamais une autorisation ; `payload` JSON, `readAt` (null = non lu), unique sur `(userId, invitationId)`. Doctrine `notifications` (ADR 0036).
- `AppConfig` : ligne unique `id = "app"` (`uploadMaxMb`), lue et écrite par `lib/appConfig.ts` seulement. Doctrine `uploads`.

## Schéma, types et migrations

- Modifier `schema.prisma` = une nouvelle migration (`npx prisma migrate dev --name …`) ; ne jamais éditer une migration appliquée, et `db push` seulement sur une base jetable (doctrine `deploiement`, ADR 0024).
- Les énumérations (`Membership.role`, `Section.type`, `Page.visibility`, `DatabaseProperty.type`, `View.type`, `Sprint.state`, `Notification.type`) sont des `String`, pas des `enum` Prisma : le code les valide à l'écriture et tolère une valeur inconnue à la lecture (`hasRole` rend `false` sur un rôle inconnu ; un type de notification inconnu dégrade, doctrine `notifications`).
- `Membership.role` a `"admin"` pour défaut dans le schéma : toute création de membership passe son rôle explicitement, et un rôle d'invitation illisible retombe sur `viewer` (`safeRole`), jamais sur ce défaut. `WorkspaceInvitation.role` n'a aucun défaut, à dessein. Garde partielle : `tests/api/invitations.test.ts` (« un rôle illisible en base retombe sur viewer… », chemin `claimInvitations`) ; les autres créations, non testé (contrôle : `grep -rnE "membership\.(create|createMany)\(" src`).
- Un champ JSON est une `String` sérialisée, jamais le type `Json` de Prisma (voir « Champs JSON »).
- Prisma stocke les `DateTime` SQLite en texte ISO-8601, comparé lexicographiquement : en SQL direct, horodater avec `prismaNow()`, jamais `CURRENT_TIMESTAMP` (doctrine `deploiement`).
- Prisma 7 génère les types de modèles avec le suffixe `Model` (`RecordModel`, `ViewModel`, `DatabasePropertyModel`, dans `generated/prisma/models`). Seul `lib/db.ts` les importe, en les aliasant (`RecordModel as PrismaRecord`), car le nom `Record` masquerait le type natif de TypeScript. Ailleurs, utiliser `ParsedRecord`, `ParsedView` et `ParsedDatabaseProperty` de `lib/db.ts`, pas le type généré.
- Un client de transaction se type `Prisma.TransactionClient` (`generated/prisma/client`), comme dans `lib/pages.ts` et `lib/trash.ts`.

## Champs JSON

Rappel du CLAUDE.md : les champs JSON passent par leurs helpers `parse*`/`serialize*`. Chaque colonne a son couple, et une colonne JSON nouvelle reçoit le sien dans le module de son domaine, jamais un `JSON.parse` dans une route.

- `Record.properties` : `parseRecord`/`parseManyRecords` et `serializeRecord`. Au PATCH, `mergeRecordProperties` (une valeur `null` retire la clé) ; à la suppression d'une colonne, `removePropertyKey`. Garde : `tests/api/records-inline-save.test.ts` (« une valeur null supprime la clé »).
- `Record.sectionsBody` : `parseSectionsBody` et `serializeSectionsBody`.
- `DatabaseProperty.config` : `parseDatabaseProperty` et `serializeDatabaseProperty`, après `validatePropertyConfig` (`lib/propertyConfig.ts`).
- `View.config` : `parseView` et `serializeView`.
- `RecordRevision.before`/`after` : `parseRecordRevision` à la lecture.
- `Template.columns`/`sections` : `parseTemplateRow` (`lib/templates.ts`) à la lecture.
- `Notification.payload` : `parseNotificationPayload` et `serializeNotificationPayload` (`lib/notifications.ts`).
- `parseRecord`, `parseView` et `parseDatabaseProperty` lèvent sur un JSON illisible ; `parseSectionsBody` rend `null` (corps libre) et `parseNotificationPayload` rend `{}`.
- Les documents BlockNote (`Page.content`, `Record.content`, `Database.recordTemplate`) restent des chaînes opaques côté serveur, stockées telles que reçues. Seul `appendReleaseNotesToContent` (`lib/db.ts`) en parse un, et un document illisible y rend `corrupt` au lieu d'être écrasé (doctrine `sprints-backlog`).
- `stripRecordBody` retire `content` et `sectionsBody` d'un record parsé (`GET /api/databases/[id]/records?includeContent=false`).
- Exception connue : trois colonnes s'écrivent encore par `JSON.stringify`/`JSON.parse` à la main, faute de helper : `Database.recordSections` (écrit par `POST /api/databases`, relu par `POST /api/databases/[id]/records`), `Template.columns`/`sections` (écrits par `templates/*`) et `RecordRevision.before`/`after` (écrits par `PATCH /api/records/[id]`) (fiche Discovery « Routes API : viewFilters hors de lib/client, JSON.parse remplacés par des helpers »). Les exceptions propres aux routes (paramètre `?filter`, comparaison des `rules`, cookie OIDC) sont dans la doctrine `api`. Non testé.

## Pages : arbre, section, visibilité, propriétaire

- `sectionId` n'est renseigné que sur une racine (`parentId` null) ; un enfant hérite de la section de sa racine. Garde : `tests/api/pages-move.test.ts` (« sectionId sur une page enfant → code section_on_child »).
- `parentId`, `sectionId` et `visibility` ne s'écrivent que dans `lib/pages.ts` (`createPage`, `setPageSection`, `deleteSectionReassigningRoots`) ; `lib/trash.ts` n'écrit que `trashedAt`. `PATCH /api/pages/[id]` confie tout changement de `parentId` ou de `sectionId` à `setPageSection` et n'écrit lui-même que `title`, `content`, `icon` et `position`. Non testé ; contrôle : `grep -rnE "\.page\.(create|update|updateMany|upsert)\(" src`.
- `visibility` (`private | team`) est dénormalisée : une racine prend le type de sa section, un enfant la valeur de son parent. `setPageSection` la redérive et la propage à tout le sous-arbre dans sa transaction. Garde : `pages-move.test.ts` (« propage visibility=team à tout le sous-arbre »).
- `Section.type` ne change pas après création (`PATCH /api/sections/[id]` ne l'accepte pas) : le changer obligerait à resynchroniser la visibilité de toutes ses pages.
- `setPageSection(pageId, input)` : la présence d'une clé dans `input` vaut intention de la modifier. Elle ne lève pas et rend `{ ok: false, code }` : `page_not_found`, `section_on_child`, `cycle` (nouveau parent = la page ou l'un de ses descendants), `target_not_found` (parent ou section absent, ou hors de l'espace). La route traduit `page_not_found` et `target_not_found` en 404, le reste en 400. Garde : `pages-move.test.ts`.
- Une racine sans section désignée tombe dans une section `private` de l'espace (la première trouvée, sans tri), donc devient privée (`createPage` comme `setPageSection`). Garde : `pages-move.test.ts` (« enfant déplacé en racine … section privée par défaut »).
- `createPage` ne vérifie rien de sa cible et `setPageSection` n'en vérifie que l'espace : contrôler que le parent existe, n'est pas en corbeille et est accessible (`isPageAccessible`) revient à la route (ADR 0039). `POST /api/pages` le fait. Garde : `tests/api/gardes-parent-et-rules.test.ts`. Exception connue : `PATCH /api/pages/[id]` ne vérifie ni l'accessibilité ni la corbeille du nouveau parent, contrairement à l'invariant du CLAUDE.md sur les ids de rattachement ; aucune fiche Discovery à ce jour. Non testé.
- `ownerId` est le créateur et l'autorité des pages privées : une page `private` n'est lisible que de son propriétaire, et d'un compte de service membre de l'espace. Le contrôle passe par `isPageAccessible` ou `pageVisibilityFilter` (doctrine `roles-permissions`).
- Une branche privée a un propriétaire par page, pas un pour la branche. D'où deux pièges, non testés : une page créée par le compte de service (pont MCP) sous une page privée, ou en racine sans section, est privée à son nom et invisible pour les humains ; déplacer une branche d'équipe vers une section privée rend chaque sous-page privée pour son propre créateur, qui la voit en racine orpheline, et invisible pour le propriétaire de la racine.
- La section `private` est partagée par l'espace : chaque membre n'y voit que ses propres pages privées. `createWorkspaceWithDefaults` crée « Pages privées » (`private`) et « Espace d'équipe » (`team`).
- Supprimer une section (`deleteSectionReassigningRoots`) réaffecte ses racines à une autre section du même type dans la même transaction, donc sans toucher la visibilité, et ne supprime aucune page ; sans section de repli du même type, refus en 409. Garde : `tests/api/sections-delete.test.ts`.
- `buildTree` (`lib/tree.ts`) remonte en racine une page dont le parent est absent de la liste (en corbeille, ou privé et inaccessible) : c'est le symptôme visible des cas ci-dessus. Garde : `tests/unit/tree.test.ts` (« traite une page dont le parent est absent comme une racine »).

## Positions

- `position` est un `Float` sans contrainte d'unicité, trié par ordre croissant.
- `nextPosition(model, where, tx)` (`lib/positions.ts`) rend `MAX(position) + 1000`, ou 1000 sur une database vide, pour `databaseProperty`, `record`, `view` et `sprint` seulement (type `PositionModel`). Rappel du CLAUDE.md : l'appeler dans la `$transaction` de la création, avec `tx`, sinon deux créations concurrentes lisent le même MAX. Garde : `tests/api/concurrency.test.ts` (valeurs et client de transaction ; aucune course réelle n'y est simulée).
- Le scaffold d'une database neuve (`POST /api/databases`) pose des positions littérales au même pas : titre et vue Tableau à 1000, colonnes du template à partir de 2000, vue kanban à 2000, vue Backlog à 500 pour en faire l'onglet par défaut.
- `Page` et `Section` n'utilisent pas `nextPosition` : `MAX + 1`, parmi les enfants du même parent ou les racines de la même section pour une page (`createPage`), parmi les sections de l'espace pour une section (`POST /api/sections`). Les deux calculs lisent le MAX hors transaction : deux créations simultanées peuvent partager une position (ordre instable, sans perte). Non testé.
- `setPageSection` ne recalcule la position (dernière de la nouvelle fratrie) que si le parent ou la section change. Un PATCH qui ne déplace rien la laisse intacte, sinon le glisser-déposer de la barre latérale, qui envoie `position` seul, serait contredit. Garde : `pages-move.test.ts` (« non-régression DnD »).
- Un réordonnancement n'écrit que l'élément déplacé, à une valeur intermédiaire entre ses voisins, jamais une renumérotation : `intermediatePosition` (`lib/client/reorder.ts`) pour les onglets de vues, un calcul local équivalent dans le tableau, le kanban, le backlog et la barre latérale.

## Corbeille

- Seuls `Page` et `Record` ont un `trashedAt` (`awk '/^model /{m=$2} /^[[:space:]]+trashedAt[[:space:]]/{print m}' prisma/schema.prisma`). Ailleurs, supprimer est définitif : vue, sprint, colonne, section ; retirer une pièce jointe aussi (ADR 0040) ; un commentaire ne se supprime pas (ADR 0041).
- Rappel du CLAUDE.md : `DELETE /api/pages/[id]` et `DELETE /api/records/[id]` mettent à la corbeille (éditeur) ; `?permanent=1` supprime pour de bon (admin), que l'élément soit déjà en corbeille ou non.
- Le soft delete ne cascade pas par les clés étrangères : `trashPageSubtree` estampe la page et tout son sous-arbre, à la même date, dans une transaction. Les records d'une database posée sur une page en corbeille ne sont pas estampés : `check*Access` les masquent via `page.trashedAt`, et ils reviennent avec la page. Garde : `tests/api/trash.test.ts`.
- `check*Access` rendent `null` (donc 404) pour un élément en corbeille ou posé sur une page en corbeille. `includeTrashed = true` (`checkDatabaseAccess`, `checkRecordAccess`, et le `getPageWithMembership` local de `pages/[id]`) ne sert qu'au cycle de vie de la corbeille : restaurer, supprimer pour de bon.
- Toute lecture filtre `trashedAt: null` : arbre, recherche, records, récents, visite. Garde partielle : `trash.test.ts` (liste, accès, recherche) ; aucun méta-test sur une lecture nouvelle.
- Les écritures d'intégrité lisent aussi les records en corbeille, puisqu'ils peuvent revenir : retrait de la clé d'une colonne supprimée (`removePropertyKey`), contrôle des options select encore référencées. Non testé.
- `restorePageSubtree` restaure tout le sous-arbre, y compris une sous-page mise à la corbeille séparément avant son parent : la mise à la corbeille du parent a réécrit sa date.
- Restaurer un record dont la page hôte est en corbeille est refusé en 409 (garde : `trash.test.ts`). Restaurer une page dont le parent est encore en corbeille ne l'est pas : elle réapparaît en racine orpheline, puis disparaît définitivement quand la purge supprime ce parent, par la cascade de `parentId`. Même sort pour une page déplacée sous un parent en corbeille. Non testé.
- `GET /api/trash` liste les seules racines de suppression, plus les records mis à la corbeille isolément sous une page active ; ces records sont bornés à 200, sans signal de troncature.
- Purge définitive au-delà de `TRASH_PURGE_DAYS` (30 j) par `purgeExpiredTrash`, déclenchée paresseusement par `GET /api/trash`, quel que soit le rôle de l'appelant (doctrine `api`, effets de bord sur GET ; ADR 0007). Elle porte sur toute l'instance, pas sur l'espace consulté : records d'abord, puis pages, dont la suppression cascade (sous-arbre, database, records, révisions, commentaires, lignes de pièces jointes). Les fichiers sont libérés ensuite par `purgeOrphanUploads` (doctrine `uploads`). Garde : `trash.test.ts` (describe « Corbeille : liste + purge 30j »).

## Modules du domaine

- `lib/pages.ts` : `createPage`, `setPageSection`, `deleteSectionReassigningRoots`, et `appendReleaseNotesToPage` (doctrine `sprints-backlog`).
- `lib/positions.ts` : `nextPosition`.
- `lib/trash.ts` : `TRASH_PURGE_DAYS`, `purgeCutoff` (pur), `collectPageSubtreeIds`, `trashPageSubtree`, `restorePageSubtree`, `purgeExpiredTrash`.
- `lib/db.ts` : types de l'application (`PropertyType`, `ViewConfig`, `ParsedRecord`, `RecordSection`…), `parse*`/`serialize*`, `mergeRecordProperties`, `removePropertyKey`, `stripRecordBody`, logique pure des révisions (doctrine `records`) et des notes de version (doctrine `sprints-backlog`).
- `lib/tree.ts` : fonctions pures de l'arbre (`buildTree`, `buildBreadcrumb`, `collectSubtreeIds`…) ; leur usage côté interface relève de la doctrine `ui`.
