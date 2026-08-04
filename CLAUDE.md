# CLAUDE.md

Ce fichier cadre le travail de Claude Code sur ce projet. Lis-le avant toute modification.

## Contexte projet

**gotyeah-notes** est un clone de Notion self-hosted. Multi-workspace, multi-membres avec rôles, pages organisées en arborescence, databases avec vues multiples (table, kanban, calendar, gallery, backlog), drag-and-drop, éditeur de blocs BlockNote.

## Stack

- **Next.js 16** (App Router, Server Components par défaut)
- **React 19**
- **TypeScript** strict
- **Tailwind CSS v4** pour le style
- **Prisma 7 + SQLite** (fichier local, provider "prisma-client", output `../generated/prisma`)
- **BlockNote** (`@blocknote/react` + `@blocknote/mantine`) pour l'éditeur de blocs
- **dnd-kit** pour le drag & drop (sidebar, table rows, kanban cards)
- **SWR** pour le fetch côté client
- **lucide-react** pour les icônes
- **zod** pour la validation des bodies API

Pas d'autres libs sans raison forte. Avant d'ajouter une dépendance, demande-toi si on peut faire sans.

## Modèle de données (15 modèles)

```
User            → email @unique, firstName/lastName/displayName, passwordHash.
                  displayName = le seul nom affiché (header, sidebar, acteur des révisions).
Session         → id = sha256(token) (le token ne vit qu'en cookie), currentWorkspaceId
                  pour le workspace actif, @@index([expiresAt]) pour la purge des expirées
Workspace       → conteneur partageable, l'autorité c'est Membership
Membership      → (userId, workspaceId, role: admin|editor|viewer), unique sur (userId, workspaceId).
                  Rôles APPLIQUÉS par toutes les routes (hasRole) — cf. « Rôles » ci-dessous.
Section         → conteneur dans la sidebar, type = "private"|"team", icon, appartient à un Workspace
Page            → arborescence (parentId), visibility dénormalisé depuis la section racine,
                  ownerId = créateur (autorité des pages privées), trashedAt = corbeille
PageVisit       → UPSERT sur unique (userId, pageId), pour la section "Récents"
Database        → liée 1-1 à une Page (pageId @unique). Une database EST une page.
                  templateId/recordSections = template source + squelette de sections estampé.
                  patchNotesPageId = page « Patch notes » (référence LIBRE, pas de relation Prisma).
DatabaseProperty → colonnes dynamiques (name, type, position, config JSON).
                  types : title|text|number|select|multiselect|date|checkbox|url|email|relation
Record          → lignes de la database (title, properties JSON indexé par property.id).
                  templateId/sectionsBody = corps SECTIONNÉ (sinon corps libre `content`).
                  sprintId = sprint d'affectation (vue backlog), null = backlog. onDelete SetNull.
                  createdBy (SetNull), coverUrl, trashedAt = corbeille.
RecordRevision  → piste d'audit d'un Record : une ligne par CHAMP changé (title | content |
                  sectionsBody | DatabaseProperty.id | RecordSection.id), actorId (SetNull),
                  before/after en JSON. Onglet « Historique » de la carte.
Sprint          → sprint d'une Database (vue backlog façon Jira). name, goal, startDate, endDate,
                  state (future|active|completed), position, releaseNotes (générées à la clôture).
                  Record.sprintId pointe dessus.
View            → type table|kanban|calendar|gallery|backlog, config JSON (filtres, tris, group-by,
                  columnWidths, createInUnassignedOnly ; backlog : pointsPropertyId/statusPropertyId/
                  epicPropertyId/doneStatusOptionId ; kanban scrum : sprintScope "active"|"all"|<sprintId>)
Template        → modèle réutilisable par workspace : columns + kanbanGroupProperty + sections [{id,label}]
                  (builtins : backlog? câble la vue Backlog du template scrum)
AppConfig       → réglages globaux de l'instance. Ligne UNIQUE id="app", uploadMaxMb.
                  Toujours via `lib/appConfig.ts` (upsert → jamais de ligne manquante).
```

### Conventions clés du modèle

- **Page.sectionId** : renseigné UNIQUEMENT sur les pages racines (parentId IS NULL). Pour les enfants, la section est héritée via la racine. Toujours passer par `lib/pages.ts > setPageSection()`.
- **Page.visibility** : dénormalisé depuis la section racine ("private" | "team"), synchronisé récursivement via `setPageSection()`.
- **Page.ownerId = autorité des pages privées** : une page `visibility="private"` n'est accessible QU'À son `ownerId`, même pour les autres membres du workspace. Règle centralisée dans `lib/workspace.ts > isPageAccessible()` et appliquée **en cascade** par TOUS les `check*Access` — sinon un membre lirait la database posée sur la page privée d'un autre. Ne réimplémente jamais ce test : appelle le helper.
- **Rôles (APPLIQUÉS partout via `hasRole`, hiérarchiques : admin ⊇ editor ⊇ viewer)** : **lecteur** = lecture seule TOTALE (aucune mutation, pas même ses pages privées) · **éditeur** = tout le contenu + mise à la corbeille/restore + organiser sections et templates (create/update) + clôture de sprint · **admin** = tout l'IRRÉVERSIBLE (DELETE database/property/view/sprint/section/template, `?permanent=1`, DELETE workspace) + gestion des membres + `PATCH /api/config`. **Écritures exemptées** (sinon un lecteur est cassé) : `POST pages/[id]/visit` (Récents), `POST workspaces/[id]/switch` (préférence de session), `POST /api/workspaces` (créer SON espace → il en devient admin), et `DELETE members/[userId]` **sur sa PROPRE membership** (quitter un espace — sinon un invité y est prisonnier ; le garde « dernier admin » s'applique quand même). Routes SANS contexte workspace : `POST /api/upload` = éditeur+ d'au moins un espace, `PATCH /api/config` = admin d'au moins un espace (`hasRoleInAnyWorkspace` — approximation v1 assumée, pas d'admin d'instance). ⚠️ Les gates vivent dans les handlers, JAMAIS dans le proxy (Vitest importe les handlers directement, le pont MCP passe le proxy sans cookie) — le méta-test de `tests/api/role-gates.test.ts` refuse tout handler mutant non déclaré. Côté client, le rôle arrive via `GET /api/workspaces` (champ `role`) → `useWorkspace().isViewer/isAdmin` ; un rôle inconnu (chargement) est traité lecteur, jamais éditeur ; le 403 serveur reste l'autorité, l'UI n'est que du confort.
- **Corbeille (soft delete)** : **seuls `Page` et `Record` ont un `trashedAt`** ; les 13 autres modèles n'en ont pas (supprimer une View / un Sprint / une Property / une Section est **définitif**). Trasher une page estampe **tout son sous-arbre** en transaction (`lib/trash.ts > trashPageSubtree`, restauration symétrique) : le soft delete ne cascade pas via les FK, il faut le propager à la main. Les `check*Access` renvoient **null** pour un élément trashé — l'option `includeTrashed` n'est là que pour le lifecycle corbeille (restaurer / purger). **Toute nouvelle lecture doit filtrer `trashedAt: null`.** Purge définitive après 30 j (`TRASH_PURGE_DAYS`), déclenchée **paresseusement** à l'ouverture de la corbeille — pas de cron en self-host.
- **Record.properties** : JSON indexé par `DatabaseProperty.id` (stable), JAMAIS par le nom de la propriété. Le nom est un label affichable qui peut changer.
- **Record.title** vs property "title" : la property de type `"title"` (créée automatiquement avec la database) correspond au champ SQL `Record.title`, PAS à une entrée dans `Record.properties`. Le composant Cell bifurque sur ce cas.
- **DatabaseProperty.type = "title"** : type spécial, un seul par database, créé auto, ne peut pas être supprimé ni dupliqué. Les garde-fous sont en place côté API.
- **Propriété `relation`** : la valeur d'un record est un `string[]` d'ids de `Record` appartenant à `config.targetDatabaseId`. Tout POST/PATCH de properties passe par `lib/relations.ts > validateRelationValues()` (→ **400** si un id n'existe pas dans la database cible ou y est en corbeille). Pas de backlink en v1 ; un id dont le record a été supprimé est un « lien mort » toléré à l'affichage.
- **Record.coverUrl** : le champ existe et `GalleryView` l'affiche, mais **aucune route ne permet de l'écrire** aujourd'hui (ni `POST /records`, ni `PATCH /records/[id]`) — seul `POST /api/records/[id]/duplicate` le recopie. Ne construis pas de feature en supposant qu'il est alimenté.
- **View.config** : remplacement TOTAL au PATCH (pas de merge). Le client envoie toujours le config complet.
- **Record.properties au PATCH** : MERGE via `mergeRecordProperties()`, pas écrasement. Une valeur `null` supprime la clé. ⚠️ En revanche `content` et `sectionsBody` sont en **remplacement TOTAL** : une mise à jour partielle du corps EFFACE les sections non réémises. Relis le corps existant avant d'écrire.
- **RecordRevision (historique)** : écrit **côté serveur**, dans la MÊME transaction que le `PATCH /api/records/[id]` — une ligne par champ **réellement** changé (diff calculé avant l'update par `lib/db.ts > diffRecordRevisions`, logique PURE et testée). **Coalescence 2 min** (`shouldCoalesceRevision` : même acteur + même champ → fusion dans la dernière ligne) pour absorber le spam d'autosave BlockNote. **Rétention indéfinie : pas de purge**, contrairement au `trashedAt`. Périmètre records uniquement (les pages ne sont pas versionnées).
- **Templates (modèles)** : un `Template` (par workspace) définit colonnes + regroupement kanban + sections de corps à libellés FIXES. Templates « fournis » (ticket, bug) en code (`lib/templates.ts`, id `builtin-*`, lecture seule) à côté des templates DB. `POST /api/databases { templateId }` scaffolde colonnes + kanban + estampe `Database.recordSections`. Un record d'une DB templatée a un **corps sectionné** (`Record.sectionsBody` = `[{id,label,content}]`, parse via `lib/db.ts > parseSectionsBody`) — libellés rendus HORS éditeur (non modifiables), un éditeur BlockNote par section. **Opt-in** : sans template, le record garde son corps libre (`content`). Le menu « modèle » du `RecordPanel` change le template par carte (indépendant du kanban).
- **Backlog (façon Jira)** : un 5e type de vue `backlog`. Les **sprints** sont un modèle Prisma `Sprint` (par database) ; un record y est rattaché via `Record.sprintId` (null = backlog). `onDelete: SetNull` → supprimer un sprint renvoie ses issues au backlog (non destructif). Les colonnes story points / statut / épic ne sont PAS un nouveau concept : ce sont des propriétés normales (number / select / select coloré), câblées dans `View.config` (`pointsPropertyId`, `statusPropertyId`, `epicPropertyId`, `doneStatusOptionId`) par le template fourni `builtin-scrum`. Sans câblage, la vue dégrade proprement (lanes par sprint, lignes titre seul). **Board scopé (Scrum)** : le kanban a un `View.config.sprintScope` (`"active"` = sprint en cours · `"all"` = toutes les issues · un id de sprint) ; le board scrum est scaffoldé `sprintScope:"active"` (nommé « Sprint actif »). Le statut est l'axe COMMUN (`statusPropertyId` backlog = `groupByPropertyId` board) → l'avancement se reflète des deux côtés. Le kanban ne fetch les sprints QUE si `sprintScope` est défini (kanban classique inchangé). **Un seul sprint `active`** par database — le check et l'update vivent dans la MÊME transaction (deux PATCH concurrents sinon → deux sprints actifs), le conflit remonte en **409**. `POST /api/databases/[id]/records` et `PATCH /api/records/[id]` acceptent `sprintId` (garde-fou : sprint de la même database, sinon 400). API sprints : `GET/POST /api/databases/[id]/sprints`, `PATCH/DELETE /api/sprints/[id]`. Accès via `checkSprintAccess` (`lib/workspace.ts`).
- **Clôture d'un sprint (transaction unique)** : `PATCH {state:"completed", moveIncompleteToBacklog, statusPropertyId, doneStatusOptionId}` fait, atomiquement : passage à `completed`, **renvoi des issues non terminées au backlog** (`status != doneStatusOptionId` → `sprintId=null`), génération de `Sprint.releaseNotes` (markdown, **une seule fois** : `releaseNotes` déjà rempli = re-clôture idempotente), puis **append d'un bloc daté à la page « Patch notes »** mappée par `Database.patchNotesPageId`. Garde-fous : réconciliation d'exhaustivité (toute issue listée doit être terminée, sinon **rollback + 422**), page au contenu JSON illisible → **rollback + 422** (on n'écrase jamais la page), pas de page mappée → clôture OK avec un flag `patchNotesAppend` explicite. `Sprint.releaseNotes` est en **lecture seule côté UI**. Démarrer/terminer dispo depuis le backlog ET le board.
- **Database.patchNotesPageId** : référence **LIBRE**, sans relation Prisma. La robustesse est assurée à l'écriture (le PATCH refuse une page d'un autre workspace ou inaccessible) ET à l'append (page existante, même workspace, non trashée, accessible à l'acteur — la visibility peut changer après le mapping). `null` = pas de mapping, ce n'est pas une erreur.
- **Position** : Float, gap-based ordering (gap de 1000) via `lib/positions.ts > nextPosition()` — models `databaseProperty`, `record`, `view`, `sprint`, **et eux seuls**. Passer le client de `$transaction` pour que le MAX(position) et le create soient atomiques. ⚠️ **`Page` n'utilise PAS `nextPosition`** : `lib/pages.ts > createPage()` a son propre calcul (`MAX + 1`, scopé à la section pour les racines). Ne mélange pas les deux systèmes. `setPageSection()` applique le **même** calcul, mais **seulement si le rattachement change vraiment** (nouveau parent ou nouvelle section) : la page déplacée arrive en dernière position de sa nouvelle fratrie, alors qu'un PATCH qui ne déplace rien laisse la position intacte — sinon le drag & drop de la sidebar (qui envoie `position` seul) serait contredit.
- **AppConfig** : ligne **singleton** (`id = "app"`). Toujours passer par `lib/appConfig.ts > getAppConfig()/setAppConfig()` (upsert → la ligne est créée à la volée avec ses défauts, jamais de `findUnique` qui renverrait null).
- **Prisma 7** génère les types avec suffixe `Model` (RecordModel, ViewModel...). `lib/db.ts` les aliase. Le type natif TS `Record` est shadowé → importer comme `import type { Record as DbRecord }`.

## Architecture

```
src/
├── proxy.ts                         # ⚠️ LE middleware (Next 16 a renommé middleware → proxy).
│                                    #   401 sur /api/* sans cookie + anti-CSRF (Origin cross-site → 403).
│                                    #   Laisse passer le pont MCP (x-mcp-secret + x-act-as-email).
├── app/
│   ├── layout.tsx                   # Racine : pose data-theme (cookie app-theme), monte
│   │                                #   DialogProvider > WorkspaceProvider > AppShell
│   ├── page.tsx                     # "/" → redirect /login si pas de session, sinon écran d'accueil
│   ├── login/ · register/           # page.tsx (Server) + LoginForm/RegisterForm (Client)
│   ├── settings/                    # SettingsPage.tsx — Profil · Membres (espace actif : liste,
│   │                                #   ajout par email, rôles — gestion admin) · Stockage (masqué
│   │                                #   aux non-admins) · Apparence
│   ├── templates/page.tsx           # Gestion des modèles (TemplatesManager)
│   ├── pages/[id]/page.tsx          # Server Component : charge Page, enregistre la visite,
│   │                                #   branche DatabaseShell (si database) OU EditorClient
│   ├── globals.css                  # Thèmes (data-theme), mapping --bn-colors-* de BlockNote
│   └── api/                         # 35 route handlers → voir « Conventions des routes API »
│       ├── auth/                    # PUBLIC : login/logout/register + oidc/login|callback
│       ├── workspaces/              # GET/POST, [id] DELETE (admin), [id]/switch POST
│       │   └── [id]/members/        # GET liste (tout membre), POST ajout par email (admin,
│       │       │                    #   lecteur par défaut, compte EXISTANT — pas d'email envoyé)
│       │       └── [userId]/        # PATCH rôle, DELETE retrait (admin ; quitter l'espace = soi-même)
│       │                            #   garde-fou transactionnel « dernier admin » → 409
│       ├── sections/                # GET/POST, [id] PATCH/DELETE (409 si dernière du type)
│       ├── pages/
│       │   ├── route.ts             # GET arbre (hors corbeille), POST create
│       │   ├── recent/route.ts      # GET 5 dernières visites (PageVisit)
│       │   └── [id]/                # route.ts (GET expose database:{id}, PATCH, DELETE → CORBEILLE),
│       │                            #   restore/ (page + sous-arbre), visit/ (upsert PageVisit)
│       ├── trash/route.ts           # GET corbeille du workspace ; purge > 30 j au passage
│       ├── search/route.ts          # GET pages + records (scopé workspace, hors corbeille)
│       ├── config/route.ts          # GET/PATCH réglages instance ; le GET purge les uploads orphelins
│       ├── upload/route.ts          # POST image multipart → { url } ; 413 trop gros / 415 type
│       ├── files/[name]/route.ts    # GET sert le fichier (OCTETS BRUTS, pas de JSON) ; session requise
│       ├── templates/               # route.ts GET/POST, [id] GET/PATCH/DELETE (builtins → 400)
│       ├── databases/
│       │   ├── route.ts             # POST create (+ scaffold colonnes/kanban/backlog depuis templateId)
│       │   └── [id]/
│       │       ├── route.ts         # GET, PATCH (recordTemplate, patchNotesPageId), DELETE
│       │       ├── properties/route.ts  # POST property (relation : cible dans le MÊME workspace)
│       │       ├── records/route.ts     # GET list (params optionnels filter/limit/offset/includeContent
│       │       │                        #   + X-Total-Count), POST record (corps sectionné, sprintId)
│       │       ├── sprints/route.ts     # GET list, POST sprint (vue backlog)
│       │       └── views/route.ts       # POST view
│       ├── properties/[id]/route.ts # PATCH (rename/options, type FIGÉ), DELETE (purge la clé des records)
│       ├── records/[id]/
│       │   ├── route.ts             # GET, PATCH (+ écrit les RecordRevision), DELETE → CORBEILLE (?permanent=1)
│       │   ├── duplicate/route.ts   # POST copie serveur atomique (titre « (copie) », props/corps/sprint)
│       │   ├── restore/route.ts     # POST restaure (409 si la page hôte est encore en corbeille)
│       │   └── revisions/route.ts   # GET historique des modifs
│       ├── sprints/[id]/route.ts    # PATCH (démarrer/terminer + notes de version + append Patch notes), DELETE
│       └── views/[id]/route.ts      # PATCH, DELETE (400 si c'est la dernière vue)
├── contexts/                        # Les 2 SEULS contextes React (pas de state global au-delà)
│   ├── WorkspaceContext.tsx         # workspaces, activeWorkspace, switchWorkspace()
│   └── DialogContext.tsx            # useDialog() → confirm()/alert() en Promise.
│                                    #   ⚠️ Remplace window.confirm : ne JAMAIS utiliser confirm() natif
├── components/
│   ├── AppShell.tsx                 # Sidebar + Header + SearchPalette ; EmptyWorkspaceScreen si 0 workspace
│   ├── Header.tsx · Breadcrumb.tsx  # Fil d'ariane (via buildBreadcrumb), recherche/réglages/avatar
│   ├── Sidebar.tsx                  # Sections, arborescence, Récents, DnD de pages
│   │                                #   ⚠️ PageTree.tsx n'existe plus : l'arbre est intégré ici
│   ├── SearchPalette.tsx            # Palette Cmd/Ctrl+K : pages + records, avec chemin d'accès
│   ├── TrashSection.tsx             # Corbeille dans la sidebar : restaurer / purger
│   ├── Editor.tsx                   # BlockNote page : autosave, upload d'images, liens @page,
│   │                                #   conversion en database
│   ├── EditorClient.tsx             # Wrapper dynamic({ssr:false}) — BlockNote ne rend pas au SSR
│   ├── WorkspaceSelector.tsx · EmptyWorkspaceScreen.tsx · EmojiPicker.tsx · VisitRecorder.tsx
│   ├── ui/Dialog.tsx                # Modale accessible (portal, focus trap, Échap) — pilotée par DialogContext
│   ├── templates/TemplatesManager.tsx
│   └── databases/
│       ├── DatabaseShell.tsx        # Tabs de views + toolbar (sort/filter/compteur) + branching de vue
│       ├── TableView.tsx            # Table (édition inline, DnD rows, resize colonnes)
│       ├── KanbanView.tsx           # Kanban (DnD cards, sprint-aware via config.sprintScope)
│       ├── CalendarView.tsx · GalleryView.tsx
│       ├── BacklogView.tsx          # Backlog Jira : lanes sprint/backlog, points, épics, démarrer/terminer
│       ├── RecordPanel.tsx          # Slide panel : onglets « Contenu » (corps libre OU sectionné)
│       │                            #   et « Historique » (révisions, fetch paresseux) + menu modèle
│       ├── Cell.tsx                 # Édition inline par type (+ SelectBadge, réutilisé ailleurs)
│       ├── BulkActionBar.tsx        # Barre flottante de sélection multiple (N PATCH optimistes)
│       ├── SelectCheckbox.tsx       # Case de multi-sélection ronde, partagée Table/Kanban
│       ├── CardActions.tsx          # Dupliquer / Supprimer au survol (Kanban + Backlog)
│       ├── PropertyPopover.tsx · AddPropertyModal.tsx · SortControls.tsx · FilterControls.tsx
│       └── portal.tsx               # Composant Portal partagé
└── lib/
    ├── prisma.ts                    # Singleton PrismaClient
    ├── session.ts                   # getSession(), createSession, hashToken (sha256), SESSION_COOKIE
    ├── oidc.ts                      # OIDC/Pocket ID : discovery, verifyIdToken, appOrigin,
    │                                #   flags oidcEnabled/legacyLoginEnabled/registrationEnabled,
    │                                #   normalizeEmail (trim+lowercase, utilisé aussi par le pont MCP)
    ├── rateLimit.ts                 # Rate-limit mémoire du login (IP+email) → 429
    ├── workspace.ts                 # getMembership, createWorkspaceWithDefaults, isPageAccessible,
    │                                #   check{Database,Property,Record,View,Sprint}Access,
    │                                #   hasRole/hasRoleInAnyWorkspace (gates de rôle),
    │                                #   updateMemberRole/removeMember (garde « dernier admin »)
    ├── positions.ts                 # nextPosition(model, where, client?) → MAX(position) + 1000
    ├── pages.ts                     # createPage, setPageSection (synchro récursive visibility),
    │                                #   appendReleaseNotesToPage, deleteSectionReassigningRoots
    ├── trash.ts                     # trash/restorePageSubtree, purgeExpiredTrash (30 j)
    ├── uploads.ts                   # Chemin, MIME, garde anti-traversée, purgeOrphanUploads
    ├── db.ts                        # Types (PropertyType, ViewConfig, ParsedRecord, RecordSection…),
    │                                #   parse*/serialize*, mergeRecordProperties, removePropertyKey,
    │                                #   stripRecordBody, diff/parse des révisions
    ├── relations.ts                 # validateRelationValues (intégrité des propriétés relation)
    ├── propertyConfig.ts            # validatePropertyConfig (zod), removedOptionIds,
    │                                #   findReferencedOptionIds (nettoyage d'options select supprimées)
    ├── propertyColors.ts            # SELECT_COLORS (palette des options select)
    ├── templates.ts                 # Templates fournis (builtin-scrum/ticket/bug), emptySectionsBody
    ├── tree.ts                      # buildTree, buildBreadcrumb, collectSubtreeIds,
    │                                #   toggleBranchCollapsed, searchResultPathSegments
    ├── avatar.ts · appConfig.ts     # Couleur/initiales d'avatar · config runtime (quota d'upload)
    └── client/                      # ⚠️ Client uniquement (jamais importé côté serveur)
        ├── viewFilters.ts           # applyFilters, applySorts, applyViewConfig, deriveSeedFromFilters
        ├── blocknoteSchema.tsx      # Schéma BlockNote partagé : inline content « pageLink » (@page)
        │                            #   + menu de suggestion. Importé par Editor ET RecordPanel
        ├── upload.ts                # uploadFile() branché sur BlockNote (coller/glisser une image)
        ├── kanban.ts                # Logique pure du kanban (ids DnD, valeur de groupe au drop…)
        ├── reorder.ts               # intermediatePosition() : position entre deux items au drop
        ├── debouncedSaver.ts        # createDebouncedSaver — le debounce d'autosave, testable
        ├── dialogController.ts      # Machine à états des dialogues (logique pure de DialogContext)
        ├── useThemeMode.ts          # light/dark déduit de la luminance de --bg (prop theme de BlockNote)
        └── useRecordDeepLink.ts     # Lien profond vers un record (?r=<id>)
```

**Conventions de lecture de cet arbre**

- La logique **pure et testable** est systématiquement extraite dans `lib/` (`client/kanban.ts`, `client/dialogController.ts`, `client/reorder.ts`, `propertyConfig.ts`…) pour être couverte par Vitest sans DOM. Avant d'écrire un helper dans un composant, vérifie qu'il n'est pas déjà là.
- `lib/client/**` ne doit **jamais** être importé depuis une route API ou un Server Component.
- Les deux éditeurs BlockNote (page et record) partagent `lib/client/blocknoteSchema.tsx` et `lib/client/upload.ts` : toute évolution de l'éditeur se fait là, pas en dupliquant dans `Editor.tsx` et `RecordPanel.tsx`.

### Signatures des helpers (à respecter au mot près)

```ts
// lib/positions.ts — arguments POSITIONNELS, pas un objet.
nextPosition(
  model: "databaseProperty" | "record" | "view" | "sprint",
  where: { databaseId: string },
  client?: PositionClient    // client de $transaction : rend atomiques le MAX(position)
): Promise<number>           // et le create qui suit. Défaut : le client global.

// lib/workspace.ts — 3e paramètre pour atteindre les éléments en corbeille.
checkDatabaseAccess(databaseId: string, userId: string, includeTrashed = false)
checkRecordAccess(recordId: string, userId: string, includeTrashed = false)
checkPropertyAccess(propertyId: string, userId: string)
checkViewAccess(viewId: string, userId: string)
checkSprintAccess(sprintId: string, userId: string)

// lib/workspace.ts — gates de rôle. hasRole est PUR (renvoie false, ne lève pas) ;
// il s'applique au membership renvoyé par les check*Access ou getMembership.
hasRole(membership: { role: string } | null | undefined, required: WorkspaceRole): boolean
hasRoleInAnyWorkspace(userId: string, required: WorkspaceRole): Promise<boolean>
// Unions non-levantes façon setPageSection, transactionnelles (count + write atomiques) :
updateMemberRole(workspaceId, targetUserId, role): Promise<{ ok: true; membership } | { ok: false; code: "not_found" | "last_admin" }>
removeMember(workspaceId, targetUserId): Promise<{ ok: true } | { ok: false; code: "not_found" | "last_admin" }>

// lib/pages.ts — setPageSection NE LÈVE PAS : elle renvoie une union à narrower.
createPage(input: CreatePageInput)   // objet : { title?, parentId?, workspaceId, ownerId, sectionId? }
setPageSection(pageId: string, input: SetPageSectionInput):
  Promise<{ ok: true; page } | { ok: false; code: "page_not_found" | … }>

// lib/client/viewFilters.ts — l'ordre des arguments compte (records, config, properties).
applyViewConfig(records: ParsedRecord[], config: ViewConfig, properties: ParsedDatabaseProperty[])
```

## Conventions des routes API

- **Auth** : `getSession()` → 401 si null. **Exception : `/api/auth/*` est public** (`src/proxy.ts > PUBLIC_PATHS`) — ces routes *créent* la session, elles ne peuvent pas la lire. Leur garde est un flag d'env (`LEGACY_LOGIN`, `REGISTRATION`, OIDC) → **403** si la fonctionnalité est désactivée, **429** sur rate-limit login.
- **Accès** : helpers `check*Access` de `lib/workspace.ts` → **404** si pas d'accès. Ils ne couvrent que les entités de database (`checkDatabaseAccess`, `checkPropertyAccess`, `checkRecordAccess`, `checkViewAccess`, `checkSprintAccess`). Pour **page / section / workspace / trash / search : pas de helper** (ne cherche pas un `checkPageAccess`, il n'existe pas) → `getMembership()` + contrôle de confidentialité (`isPageAccessible`, ou `visibility === "private" && ownerId !== user.id`), 404 également.
- **404, jamais 403 pour l'ACCÈS à une ressource** (ne pas leaker l'existence : non-membre ou page privée d'autrui → 404). Les 403 du projet sont fonctionnels : **rôle insuffisant** (`{ error: "Rôle insuffisant" }` — le membre voit déjà la ressource en lecture, l'action est refusée ; **ordre obligatoire : check d'accès → 404 PUIS check de rôle → 403**), fonctionnalité désactivée (`/api/auth/login|register`) et refus anti-CSRF du proxy (`Origin` cross-site sur une mutation).
- **Corbeille (soft delete)** : `DELETE /api/pages/[id]` et `DELETE /api/records/[id]` estampent `trashedAt` — ils ne suppriment PAS. `?permanent=1` = suppression définitive depuis la corbeille. Les `check*Access` masquent le trashé par défaut → passer `includeTrashed = true` (3e arg) pour le cycle de vie corbeille. Toutes les lectures (arbre, search, records, recent) filtrent `trashedAt: null`.
- **Rattachement inter-workspace** : une route qui reçoit un id de rattachement (`parentId`/`sectionId` de `POST /api/pages`) doit vérifier qu'il appartient bien au `workspaceId` contrôlé — le rôle est vérifié sur CE workspace, sinon on écrirait dans l'arborescence d'un espace où l'on n'est que lecteur. Même réflexe que `patchNotesPageId` et les propriétés `relation`.
- **Validation** : zod, schema en haut du fichier. Exceptions : `POST /api/upload` lit un `FormData` (pas de JSON), `/api/auth/*` et `POST /api/pages` valident à la main.
- **JSON fields** : JAMAIS de `JSON.parse/stringify` direct dans les routes → toujours les helpers `parse*/serialize*` de `lib/db.ts`. (Seul `templates/*` sérialise `columns`/`sections` à la main — pas de helper dédié pour `Template`.)
- **Réponse succès** : objet parsé direct (pas wrappé dans `{ data: ... }`). **201** sur les créations d'entités database (database, record, duplicate, property, view, sprint, template) ; les routes historiques (pages, sections, workspaces) répondent 200. Deux sorties non-JSON : `GET /api/files/[name]` renvoie des **octets bruts**, `/api/auth/oidc/*` renvoie des **redirections** (erreur → `/login?sso_error=<code>`).
- **Réponse erreur** : `{ error: "message" }` ou `{ error: "Validation failed", details: zodFlattenedErrors }`. Codes métier en usage : **409** (page déjà database, sprint déjà actif, email pris, dernière section, restore sous page trashée), **422** (clôture de sprint : réconciliation des issues, page « Patch notes » illisible), **413/415** (upload), **429** (login).
- **Position** : `nextPosition(model, where, tx)` — models `databaseProperty | record | view | sprint`. **Appeler DANS le `prisma.$transaction` de la création, avec le client `tx` en 3e argument** : hors transaction, deux créations concurrentes lisent le même `MAX(position)` et collisionnent.
- **Effets de bord sur GET** (self-host, pas de cron) : `GET /api/config` purge les uploads orphelins > 30 j, `GET /api/trash` purge la corbeille expirée > 30 j. **Acte SYSTÈME assumé** (décision 03/08) : la purge TTL se déclenche quel que soit le rôle de l'appelant, lecteur inclus — les 30 j sont consommés, le GET n'est que le déclencheur opportuniste.
- **Pas de filtres/tris côté serveur** : tous les records sont retournés (hors corbeille : `trashedAt: null`), le client filtre en JS via `applyViewConfig()`. **Exception assumée** — `GET /api/databases/[id]/records` accepte des params **optionnels** pour les consommateurs sans `applyViewConfig` : `filter` (JSON `ViewFilter[]`, appliqué via `applyFilters` — pas de réimplémentation), `limit` (1-200) / `offset` (total pré-pagination dans l'en-tête `X-Total-Count` ; le corps reste un **tableau nu**), `includeContent=false` (omet `content`/`sectionsBody` via `stripRecordBody`). **Sans aucun param, la réponse est identique à l'historique** → le front n'est pas impacté. ⚠️ Ces params ont été faits « pour le MCP » mais le MCP ne les utilise pas encore (`notes_tools.py > list_records` appelle la route nue).

## Conventions UI

- **Server Components par défaut**. `"use client"` uniquement si état, effets, ou event handlers.
- **Tailwind** : classes inline, pas de `@apply`, pas de CSS modules.
- **Fetch client** : SWR, clé = URL de l'API. Après mutation, `mutate(key)`.
- **Pas de state global** (Zustand, Redux). SWR + useState local suffisent.
- **Optimistic updates** partout : mutate le cache SWR avant le fetch, rollback en cas d'erreur.
- **Portals** : les dropdowns/popovers utilisent `createPortal` vers `document.body` (le `overflow` des conteneurs couperait sinon les éléments absolus).
- **Drag-and-drop** : PointerSensor avec `activationConstraint: { distance: 6 }` partout (sidebar, table, kanban).

## Autosave

L'éditeur BlockNote debounce 500-600ms sur `onChange` et envoie un PATCH. Même pattern dans RecordPanel pour le contenu des records. Ne touche pas à cette logique sans raison.

## Bugs connus

- **Écritures SQLite coupées par le watcher `next dev`** — symptôme historique : ECONNRESET côté serveur + NetworkError client au drag-and-drop d'une page vers le haut dans la sidebar, alors que la donnée était bien écrite en DB. Cause retenue : better-sqlite3 écrit `dev.db-wal` **dans le dossier projet**, watché par Next.js dev → Fast Refresh en plein PATCH.
  **Mitigation appliquée, non re-testée** : la DB de dev vit désormais HORS du repo (`DATABASE_URL` de ton `.env` local ; l'astuce est documentée dans `.env.example`) et le harnais E2E fait pareil (`tests/e2e-server.mjs` → `os.tmpdir()`). Traite donc ce point comme *mitigé*, pas comme *prouvé disparu*. **Si le symptôme réapparaît, vérifie d'abord que `DATABASE_URL` ne pointe pas dans le repo** avant de chercher ailleurs.
- **Environnement de dev** (note, pas un bug) : le développement se fait en **Windows natif**. L'ancienne entrée « Turbopack + WSL2 » (nouveaux fichiers non détectés sur les mounts `/mnt/c/...`) est **sans objet** dans cette configuration ; elle ne redeviendrait vraie que si le projet repassait sous WSL sur `/mnt/c` — auquel cas : travailler dans le FS natif WSL (`~/projects/...`).

## Thème (couleurs)

- **Un seul système** : attribut `data-theme` sur `<html>` (≈12 thèmes : light, sepia, rose, dark, midnight, ocean, forest, nord, tokyo, dracula, catppuccin, gruvbox), posé au SSR depuis le cookie `app-theme` (`app/layout.tsx`), piloté par **Settings → Apparence**. Chaque thème définit `--bg`, `--surface`, `--surface-hover`, `--surface-active`, `--border`, `--text`, `--text-muted`, `--accent` dans `globals.css`.
- **NE JAMAIS utiliser les classes Tailwind `dark:`** : il n'y a pas de `@custom-variant dark`, donc `dark:` suit le `prefers-color-scheme` de l'OS — pas le thème choisi. Styliser via `text-[var(--text)]`, `bg-[var(--surface)]`, etc.
- **BlockNote** suit le thème via la prop `theme={useThemeMode()}` (`lib/client/useThemeMode.ts`, déduit light/dark de la luminance de `--bg`) ; les variables `--bn-colors-*` sont mappées sur la palette du site dans `globals.css` (`html[data-theme] .bn-root`).
- **Curseur** : Tailwind v4 ne met plus `cursor:pointer` sur les `<button>` → règle de base globale dans `globals.css` (`button:not(:disabled)…`).

## Déploiement

- **CI** : `.github/workflows/ci.yml` — jobs `build` (Next + Prisma), `test` (Vitest unit/API) et `e2e` (Playwright). Un test rouge bloque la CI (condition DoD). **Déclencheurs** : au *push* sur `main`, `feat/**`, `fix/**`, `docs/**` et `chore/**` ; le `pull_request:` n'a aucun filtre et couvre donc **toutes** les branches. Une branche nommée hors de ces préfixes ne déclenche donc rien au push — sa CI n'arrive qu'à l'ouverture de la PR. Ne jamais conclure « CI verte » sans avoir vu un run.
- **CD** : `.github/workflows/deploy.yml` — sur push `main` (ou `workflow_dispatch`), SSH sur le Pi (secrets repo `SSH_HOST`/`SSH_USER`/`SSH_KEY`), `git reset --hard origin/main` + `docker compose up -d --build`, puis attend que le conteneur `gotyeah_notes` soit `healthy` (healthcheck node défini dans `docker-compose.yml`). ⚠️ **Un push sur `main` déclenche un déploiement réel**, à une exception près : `paths-ignore: ["**.md"]` — un push ne touchant QUE des `.md` ne déploie pas. Un commit mêlant doc et code déploie quand même.
- **Snapshot backup AVANT chaque MEP** (filet de sécurité) : le script SSH prend un snapshot SQLite via `sqlite3 .backup` (cohérent sous WAL) `--user 0:0` dans `/home/pi/backups/gotyeah-notes/`, + `PRAGMA integrity_check`. **Un échec du snapshot arrête le déploiement** (avant `docker compose up`). ⚠️ Ne PAS mettre d'étape best-effort dans le `script:` de `deploy.yml` : `appleboy/ssh-action` (`script_stop`) coupe la MEP au moindre code non nul, quelles que soient les gardes shell (`set +e`/`|| true`). Rotation des snapshots (7 j) + réplication restic hors-Pi = **cron dédié sur le Pi** (hors chemin critique, cf. README §Sauvegardes).
- Le schéma Prisma est appliqué au déploiement par le service one-shot `migrate` (`prisma db push`). Bascule vers `prisma migrate deploy` + baseline versionnée = PR **#23** (draft, rollout supervisé : `migrate resolve --applied 0_init` sur la prod avant le 1er `migrate deploy`).
- `postinstall` = `prisma generate` (jamais `db push` : aucune opération destructive à l'install).
- ⚠️ Le build Docker tourne **sur le Pi** (RAM-intensif sur arm64 → pics swap au déploiement). Voir *Reste à faire* (builder en CI).

### Sécurité (auth/API, lot livré 2026-07-11)

Instance exposée durcie — variables d'env associées (défauts sûrs, cf. `.env.example` / `docker-compose.yml`) :
- **`REGISTRATION`** (défaut `off`) : inscription publique par formulaire fermée. `on` pour rouvrir `POST /api/auth/register`. Découplée de `LEGACY_LOGIN` et de l'OIDC.
- **`MCP_ACT_AS_ALLOWLIST`** (défaut vide = comportement historique) : liste d'emails (séparés par virgule) que le pont MCP peut incarner ; hors liste → refus + log d'audit. Injectée au conteneur depuis la PR #38 (18/07/2026) — avant, elle était absente du bloc `environment:` et la garde ne s'appliquait pas.
- **Tokens de session hachés** (sha256) : `Session.id = hashToken(token)`, jamais le token en clair ; purge des expirées (`@@index([expiresAt])`). Le déploiement de ce changement déconnecte tout le monde une fois.
- **Login** : rate-limit mémoire (IP+email) → 429 ; anti-énumération (bcrypt factice sur email inconnu, même message/temps). Emails normalisés (`normalizeEmail` = trim+lowercase) sur register/login/act-as.
- **Headers** (`next.config.ts`) : `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, `Referrer-Policy`. **Anti-CSRF** (`src/proxy.ts`) : une mutation `/api/*` avec `Origin` cross-site est refusée (403) ; GET, same-origin et pont MCP passent.

### Variables d'environnement

Toutes les variables réellement lues (`process.env`). Source de vérité : `.env.example` (local) + bloc `environment:` de `docker-compose.yml` (conteneur). ⚠️ Le compose n'utilise **pas** `env_file` : une variable absente de son bloc `environment:` **n'atteint jamais le conteneur**, même posée dans le `.env` du Pi.

| Variable | Lue dans | Défaut | Si absente |
|---|---|---|---|
| `DATABASE_URL` | `lib/prisma.ts` | `file:./prisma/dev.db` | OK en conteneur (fixée par le compose) ; requise en local pour le CLI Prisma |
| `OIDC_ISSUER` / `_CLIENT_ID` / `_CLIENT_SECRET` / `_REDIRECT_URI` | `lib/oidc.ts` | `""` | Bouton OIDC masqué (`oidcEnabled()` exige les **4**) — dégradation propre, pas d'erreur |
| `OIDC_ALLOW_SIGNUP` | `lib/oidc.ts` | `"true"` | Provisioning auto au 1er login OIDC actif |
| `OIDC_BUTTON_LABEL` | `lib/oidc.ts` | `"Se connecter avec GotYeah"` | Libellé par défaut |
| `LEGACY_LOGIN` | `lib/oidc.ts` | `"on"` | Login email/mot de passe actif (break-glass) |
| `REGISTRATION` | `lib/oidc.ts` | `"off"` | Inscription publique fermée (défaut sûr) |
| `MCP_SHARED_SECRET` | `lib/session.ts` | vide | Pont MCP act-as **désactivé** (aucune surface ajoutée) |
| `MCP_ACT_AS_ALLOWLIST` | `lib/session.ts` | vide | N'importe quel User existant est incarnable |
| `UPLOAD_DIR` | `lib/uploads.ts` | `<cwd>/data/uploads` | En conteneur, doit valoir `/data/uploads` (volume) — sinon images perdues au rebuild |

- ⚠️ **Leçon de la PR #38** : `MCP_ACT_AS_ALLOWLIST` a été **inerte en prod** pendant une semaine — lue par le code et documentée comme livrée, mais absente du bloc `environment:`. Une garde de sécurité qu'on croit active et qui ne l'est pas est pire que pas de garde. Réflexe : toute nouvelle variable lue par `src/` doit être ajoutée AU MÊME MOMENT dans `.env.example` **et** dans `docker-compose.yml`.
- `NODE_ENV` (flag `secure` des cookies) est posé par Next et le Dockerfile — ne pas le définir à la main. `E2E_PORT`, `PORT` et `CI` ne servent qu'aux tests.
- ⚠️ **`AUTH_SECRET` n'est lue nulle part dans `src/`.** Elle n'existe que comme placeholder dans `ci.yml`, `vitest.config.ts` et `tests/e2e-server.mjs` (vestige d'un design d'auth abandonné). Ce n'est pas une variable de configuration : elle n'a aucun effet.

## Intégration MCP (outils notes_*)

- Les outils MCP de gotyeah-notes vivent dans le dépôt **`gotyeah-mcp`** (`gotyeah-mcp/mcp_remote/notes_tools.py`), **greffés sur le hub MCP Sonar** (et **pas** un serveur séparé) : on réutilise son OAuth fédéré à l'IdP **Pocket ID** déjà branché dans claude.ai (volonté : ne pas dupliquer l'auth). ⚠️ Le code MCP a été **consolidé de `gotyeah_sonar` vers `gotyeah-mcp`** (commit `6f80180`, 2026-07-01) : ne plus toucher `gotyeah_sonar` pour les outils `notes_*`.
- **Pont de confiance** : `lib/session.ts > getSession()` accepte, à défaut de cookie valide, un appel du MCP via `X-MCP-Secret` (== env `MCP_SHARED_SECRET`, comparaison constant-time) + `X-Act-As-Email` → mappé sur un **User existant** (email normalisé trim+lowercase). Entièrement **OFF tant que `MCP_SHARED_SECRET` est vide** → aucune surface ajoutée par défaut. L'auth web cookie/password est inchangée. **Allowlist optionnelle `MCP_ACT_AS_ALLOWLIST`** (emails séparés par virgule) : si définie, seuls ces emails sont incarnables (sinon refus) ; chaque incarnation est journalisée (`console.info('[mcp-act-as]…')`).
- ⚠️ **`src/proxy.ts` est le middleware** (Next 16 a renommé `middleware` → `proxy`). Il s'exécute AVANT les routes et 401-ait tout `/api/*` sans cookie : il **laisse passer** les appels portant `x-mcp-secret` + `x-act-as-email` (la validation autoritaire reste dans `session.ts`). Toute future auth par en-têtes doit aussi être whitelistée là.

### Les 49 outils `notes_*` (état du code, `remote.py`)

> La surface est décrite entité par entité dans **`gotyeah-mcp/mcp_remote/notes_entities.py`** (table `list/get/create/update/delete/restore`), avec la **raison** de chaque trou volontaire. Un outil non déclaré fait échouer `tests/test_notes_entities.py` : c'est la table, pas cette liste, qui fait foi.

- **Espaces (3)** : `notes_list_workspaces`, `notes_get_workspace`, `notes_create_workspace` (renvoie le workspace **avec ses sections par défaut**, pour enchaîner sans re-lister). ⚠️ **`delete_workspace` n'est pas exposé et ne le sera pas** (décision du 2026-07-30) : `DELETE /api/workspaces/[id]` cascade sans garde de vacuité — la suppression d'un espace se fait dans l'interface web. Renommer un workspace n'existe nulle part.
- **Pages / sections (11)** : `notes_list_pages`, `notes_get_page`, `notes_create_page`, `notes_update_page`, `notes_move_page`, `notes_delete_page`, `notes_search`, `notes_list_sections`, `notes_create_section`, `notes_update_section`, `notes_delete_section`.
  - `notes_move_page` change le SEUL rattachement (`parent_id` → sous-page · `section_id` → racine d'une section, l'un met l'autre à null) : ni recopie du `content`, ni suppression/recréation. Fournir les deux, ou aucun des deux, est refusé **avant** l'appel HTTP.
  - `notes_delete_section` expose la sémantique existante **sans ajout** : aucune page supprimée, les racines sont réaffectées à une autre section du même type. La réponse énumère la réaffectation (combien de pages, vers quelle section) — **observée** après coup, pas recalculée : dupliquer la règle de repli dans l'adaptateur serait du métier hors couche, et un mensonge le jour où elle changerait. Le 409 « dernière section de ce type » est traduit en consigne actionnable.
- **Corbeille (3)** : `notes_list_trash`, `notes_restore_page`, `notes_restore_record`. Sans eux, un agent croyait ses suppressions définitives — voir la note sur les descriptions ci-dessous.
- **Databases / propriétés / records / vues (20)** : `notes_get_database`, `notes_create_database`, `notes_delete_database`, `notes_set_record_template`, `notes_set_patch_notes_page`, `notes_create_property`, `notes_update_property`, `notes_add_select_option`, `notes_update_select_option`, `notes_remove_select_option`, `notes_delete_property`, `notes_list_records`, `notes_get_record`, `notes_create_record`, `notes_duplicate_record`, `notes_update_record`, `notes_delete_record`, `notes_list_record_revisions`, `notes_create_view`, `notes_update_view`, `notes_delete_view`. Une database EST une page → `notes_get_page` renvoie `database: {id}`. Les records se manipulent **par NOM** de propriété (traduit en ids + options select via le schéma, côté `notes_tools.py`).
  - `notes_update_property` ne fait que **renommer / réordonner** la colonne. Les options select se manipulent à part : `notes_add_select_option` (**idempotent**, add-only), `notes_update_select_option` (renommer / recolorer / réordonner — **l'id de l'option est conservé**, donc aucune carte n'est réécrite) et `notes_remove_select_option` (le serveur refuse si l'option est encore référencée par une carte ou une vue backlog ; le 400 est traduit). Changer le **type** d'une propriété est refusé par l'API (`400 type cannot be changed`) — c'est voulu, pas un manque.
- **Templates / modèles (8)** : `notes_list_templates`, `notes_create_template`, `notes_update_template`, `notes_delete_template`, `notes_create_database_from_template` (depuis n'importe quel template), `notes_create_ticket_database` / `notes_create_bug_database` (raccourcis builtins), `notes_set_record_template` (modèle de corps LIBRE d'une database). Les templates fournis (`builtin-*`) sont en **lecture seule** : `update`/`delete` refusent avant l'appel HTTP. ⚠️ `notes_update_template` remplace la liste de `sections` en ENTIER et regénère un id pour toute section sans `id` → repasser les ids existants (via `notes_list_templates`), sinon les cartes déjà sectionnées se décrochent.
- **Sprints / backlog (4)** : `notes_list_sprints`, `notes_create_sprint`, `notes_update_sprint` (state `active`=démarrer / `completed`=terminer ; avec `database_id` → renvoie les issues non terminées au backlog), `notes_delete_sprint`. Affecter une issue à un sprint : param `sprint` (par NOM, ou `"backlog"`) de `notes_create_record` / `notes_update_record`.

⚠️ **Réversibilité : ce que les descriptions doivent dire.** Côté notes, **seules `Page` et `Record` ont un `trashedAt`** : `notes_delete_page` / `notes_delete_record` mettent à la **corbeille** (restaurable 30 j), tout le reste est **définitif**. Les descriptions de ces deux outils annonçaient « Irréversible » — c'était faux, et un mensonge de description est pire qu'un outil manquant : le trou se voit, pas le mensonge. Corrigé le 2026-07-30, en même temps que `notes_delete_view` / `notes_delete_sprint` qui, eux, se **taisaient** sur une suppression pourtant définitive. Règle : toute description de suppression dit où va l'objet et comment le récupérer, ou qu'il n'y a pas de retour.

⚠️ **Le MCP ne couvre toujours pas toute l'API.** Sans outil dédié à ce jour : upload d'images (`/api/upload`, `/api/files/[name]` — **préalable bloquant** : aucune route notes ne supprime un fichier, il ne faut donc pas exposer l'upload avant de l'avoir construite), purge définitive de la corbeille (`?permanent=1`, volontairement hors MCP), config d'instance (`/api/config`), suppression et renommage de workspace. Ne conclus pas « la fonctionnalité n'existe pas » parce qu'aucun outil `notes_*` ne l'expose — et vérifie d'abord `notes_entities.py`, qui dit lesquels manquent **exprès**.

- **Activation** (sur le Pi) : même secret dans les deux `.env` — `MCP_SHARED_SECRET` ici, `NOTES_API_BASE_URL=http://gotyeah_notes:3000` + `NOTES_MCP_SECRET` côté MCP (dépôt `gotyeah-mcp` ; les deux conteneurs sont sur le réseau `nginx-proxy-manager_default`) — puis `docker compose up -d` et rafraîchir le connecteur claude.ai. **✅ Actif en prod (2026-06-29)** ; l'email du User a été aligné sur le gmail (= email IdP).
- **Déploiement du MCP** : `gotyeah-mcp` est à jour sur `main` (dernier lot : `notes_add_select_option`, PR #3 mergée le 2026-07-17) et le connecteur claude.ai a été rafraîchi. Après tout ajout d'outil : push `gotyeah-mcp` sur `main` **puis** rafraîchir le connecteur dans claude.ai — sans ce rafraîchissement, le nouvel outil reste invisible côté client.
- Variables d'env : voir `.env.example`.

## Reste à faire

> L'historique git est la source de vérité de ce qui a été livré. Cette liste ne sert qu'à
> (a) éviter de refaire un lot déjà fait, (b) tracer ce qui reste. Si une ligne te semble
> en contradiction avec le code, **crois le code** et corrige la ligne.

### Livré (repères — détail dans `git log`)

- [x] ~~**Pont MCP + MCP v2/v3 (databases, records, templates, sprints, options select)**~~ : 2026-06-29 → 2026-07-17. 37 outils `notes_*` côté `gotyeah-mcp`, déployés, connecteur rafraîchi (49 depuis le lot CRUD du 2026-07-30). Voir *Intégration MCP*.
- [x] ~~**Système de modèles (templates)**~~ : 2026-06-30. Modèle `Template` (workspace), page `/templates`, corps sectionné à libellés fixes, scaffold `POST /api/databases {templateId}`.
- [x] ~~**Backlog façon Jira + cohabitation Board/Sprint**~~ : 2026-06-30. Vue `backlog`, modèle `Sprint`, kanban « sprint-aware » (`sprintScope`), un seul sprint actif (409), clôture renvoyant les issues non terminées au backlog.
- [x] ~~**Auth OIDC (Pocket ID) + `LEGACY_LOGIN`**~~ : 2026-07-02 (`0cee15f`, `33d47a7`). Connexion OIDC à côté du formulaire ; `LEGACY_LOGIN=off` = « comptes GotYeah uniquement ».
- [x] ~~**Corbeille (soft delete) + upload d'images local**~~ : 2026-07-10 (`e386d7c`, `4f2c08c`). `/api/trash`, `/api/records/[id]/restore`, purge auto 30 j ; `/api/upload` + `/api/files/[name]`, purge des orphelins 30 j.
- [x] ~~**Type de propriété « relation »**~~ : 2026-07-10 (`23a69f3`). Types, API et filtres.
- [x] ~~**Lot durcissement sécurité**~~ : 2026-07-11. Voir *Déploiement > Sécurité*. Inclut le **match email insensible à la casse** (`normalizeEmail` + `scripts/normalize-emails.mjs`).
- [x] ~~**Lot Discovery / éditeur / vues**~~ : 2026-07-16 → 2026-07-18. Liens internes `@page` (`5f8d38c`), duplication serveur atomique (`2cc0e48`), sélection multiple + actions groupées (`ca74c3b`), RecordPanel redimensionnable (`0e41983`), réordonnancement des onglets de vues (`a572d3e`), chemin des homonymes dans Cmd+K (`b2a6aa2`), repli récursif de la sidebar (`48666bb`), édition inline sur les cartes kanban (`1eb86a1`).
- [x] ~~**Historique des modifications d'un record**~~ : 2026-07-17 (`17c05d4`). Modèle `RecordRevision`, `GET /api/records/[id]/revisions`, onglet dédié dans le `RecordPanel`.
- [x] ~~**Notes de version (patch notes) de sprint**~~ : 2026-07-16/17 (`a919329`, `e00579a`, `a9e7927`). Générées à la clôture, auto-appendées à la page « Patch notes », affichage lecture seule dans le backlog.

### Reste

- [ ] **Builds hors Pi** : le build Docker tourne toujours **sur le Pi** (`deploy.yml` → `docker compose up -d --build`), RAM-intensif sur arm64. Cible : builder l'image en CI (`ci.yml` n'a aujourd'hui aucun job Docker) + `docker pull` au déploiement.
- [x] ~~**`MCP_ACT_AS_ALLOWLIST` absente du `docker-compose.yml`**~~ : fait (18/07/2026, PR #38). Reste à la **renseigner** dans le `.env` du Pi pour que la garde s'applique réellement (vide = tout User existant reste incarnable).
- [x] ~~**MCP — édition fine des options select**~~ : fait (2026-07-30). `notes_update_select_option` (renommer / recolorer / réordonner) + `notes_remove_select_option` (refus serveur si l'option est encore référencée, traduit en consigne).
- [x] ~~**MCP — trous de la matrice CRUD (corbeille, sections, workspaces)**~~ : fait (2026-07-30). 12 outils ajoutés (49 au total), descriptions de suppression corrigées, table d'entités + test anti-régression (`notes_entities.py`). ⚠️ **Pas encore déployé ni rafraîchi côté connecteur claude.ai.**
- [ ] **`View.config.createInUnassignedOnly` sans UI** : le flag existe (`lib/db.ts`) et est respecté par le kanban (`KanbanView.tsx`), mais **aucun écran ne l'écrit** — il faut éditer le `config` de la vue à la main. À câbler dans les réglages de vue si on le garde.
- [ ] **Dupliquer — phase B** : `POST /api/records/[id]/duplicate` (phase A) n'est câblé que dans **KanbanView** et **BacklogView**. Reste à l'exposer dans TableView / GalleryView / CalendarView.
- [ ] **Migrations Prisma versionnées** : le déploiement applique encore `prisma db push` (pas de dossier `prisma/migrations/`). Bascule vers `migrate deploy` + baseline = PR **#23** (draft).
- [x] ~~**CI aveugle sur `fix/**`, `docs/**`, `chore/**`**~~ : fait (18/07/2026, PR #39). `ci.yml` déclenche désormais au push sur `main`, `feat/**`, `fix/**`, `docs/**` et `chore/**`.
- [ ] (optionnel) UI Settings « Jetons d'accès » si un jour on veut un PAT en complément de l'IdP.

## Process de travail (Dev Loop)

Le process ne vit **pas** dans ce dépôt. Sa référence est la page **Dev Loop** du workspace notes (id `cmrci2y9i000b01nnmkel8m61`) — « document lu en premier par toute session IA » — complétée par le **Guide du process** (`cmrcjyk8w003w01nn3b0pkk7y`). Ce qui suit en est le strict nécessaire pour travailler dans ce repo ; en cas de doute, la page Dev Loop fait foi. Règle mère : **les notes font foi, pas la conversation** — ce qui n'est écrit ni dans une fiche ni dans un ticket n'existe pas.

### La boucle

Idée → fiche **Discovery** (inbox globale tous projets, `cmrci44xz000c01nnbg5iumkc`) cadrée par l'IA → **✅ Validée** par Gautier (go n°1) → l'IA crée le ticket dans le **📦 Board du projet** (ici database `cmri206zi009r01juyyyly8he`) → dev sur une branche → PR → merge `main` = **déploiement réel en production** (mécanique : cf. *Déploiement*). Les retours post-MEP réalimentent Discovery ou le Backlog.

**8 statuts** : Backlog · Cadrage · Prêt · En dev · Review / Tests · Recette préprod · À MEP · Terminé.

- **Réservés à Gautier** — « statuts de confirmation », l'IA n'y fait **JAMAIS** entrer une carte : **Validée** (Discovery), **Prêt**, **À MEP**, **Terminé**. Y entrer = sa signature.
- **Permis à l'IA** : `Backlog → Cadrage` (**sur ordre explicite uniquement** — l'IA ne s'auto-saisit jamais d'un ticket), `Prêt → En dev`, puis `En dev → Review / Tests → Recette préprod` en autonomie, **sous condition DoD** : CI verte, chaque critère d'acceptation couvert par un test, self-review du diff faite, section 🧾 Recette du ticket remplie (manipulation → résultat attendu), Cahier de tests à jour (cf. *Socle de test*). CI rouge → l'IA reboucle en dev, seule.
- **Fin de session ou blocage** : mettre à jour la section 🤝 État courant de la carte, passer `Main à = Gautier`, s'arrêter.
- **Ne jamais rien supprimer** (carte, fiche) : les statuts « Abandonnée » / « Obsolète » existent pour ça.

### Zone réservée : 🗣️ Notes de Gautier

Chaque carte se termine par une section **« 🗣️ Notes de Gautier »** (décisions, contraintes, détails à ne pas oublier). L'IA la **lit en priorité** à chaque session sur la carte, en intègre le contenu dans les bonnes sections, et **n'y écrit JAMAIS**. Si elle manque sur une carte ancienne, l'IA l'ajoute vide.

⚠️ **Piège technique** : le corps d'un record se réécrit en **remplacement TOTAL** (`content` comme `sectionsBody` — seules les `properties` sont mergées, cf. *Conventions clés du modèle*). Une mise à jour partielle qui ne réémet pas la section **efface les notes de Gautier**. Toujours relire le corps existant et réémettre 🗣️ Notes de Gautier à l'identique.

### Tiering de risque T1/T2/T3 — posé au schéma, PAS actif

Classement par **rayon d'impact**, décidé le 2026-07-17 : **T3** = auth, paiement, migration ou suppression de données, irréversible, sécurité (quelle que soit la taille) · **T1** = UI, copie, doc, ajout isolé, zéro surface données/sécurité · **T2** = tout le reste. Intention cible : T1 = auto-merge / deploy sans recette.

⚠️ **État vérifié au 2026-07-18 — l'exception T1 est INACTIVE, ne t'en réclame pas.** Le tiering n'existe qu'au **schéma** : la propriété `Risque` (select T1/T2/T3) est bien sur le board, tout comme l'option de statut « Déployé T1 / à contrôler » — mais **aucun ticket n'est qualifié (0/27)** et aucune règle par tier n'est écrite. Les deux tickets qui la porteraient (« Propriété Risque … + circuits par tier », « DoR à géométrie variable ») sont **au Backlog**, non cadrés.

**La règle qui s'applique aujourd'hui, sans exception : jamais de push sur `main` sans go explicite de Gautier**, parce qu'un push sur `main` déclenche un déploiement réel en production (seuls les pushes ne touchant **que** des `.md` en sont exemptés — `deploy.yml`, `paths-ignore`). Unique dérogation accordée à ce jour : l'**auto-merge des petits correctifs low-risk** (retours de recette, tweaks UI sans surface données ni sécurité), une fois la **CI verte**. Le go explicite reste requis pour l'auth, les données, les migrations, le schéma Prisma, la sécurité et tout changement de taille.

### Discipline git

- **Toujours `git push` la branche AVANT `gh pr create`.** `gh` ouvre la PR depuis l'état **distant** : l'oublier produit une PR amputée des commits locaux — c'est arrivé le 2026-07-16, et la prod est partie incomplète.
- Branche par ticket, PR systématique. Pas de commit direct sur `main`.

## Ce qu'il NE faut PAS faire

- Pas de migration vers Postgres tant que SQLite suffit.
- Pas de framework CSS autre que Tailwind.
- Pas de state management global.
- Pas de tRPC, GraphQL. Des `fetch` sur des routes Next.js.
- Pas de `any` en TypeScript. Utiliser `unknown` + narrowing. **Unique exception tolérée aujourd'hui** : le `initialContent: … as any` passé à `useCreateBlockNote({ schema: pageLinkSchema, … })` — 3 occurrences (`Editor.tsx`, `RecordPanel.tsx` ×2), toutes annotées `eslint-disable-next-line`, dues au typage de `initialContent` avec un schéma BlockNote custom. N'en ajoute pas d'autre, et ne prends pas ces 3 lignes pour une autorisation générale.
- Pas de commentaires inutiles. Les commentaires expliquent le *pourquoi*, jamais le *quoi*.

## Commandes

```bash
npm ci --legacy-peer-deps   # ⚠️ OBLIGATOIRE : conflit de peer-deps connu
                            #   (@blocknote/mantine veut @mantine/core@^8, le projet est en v9).
                            #   Le lockfile ET l'install locale en dépendent — un `npm ci` nu échoue.
npm run dev          # dev server. Next 16 utilise Turbopack PAR DÉFAUT (inutile d'ajouter --turbo) ;
                     #   `npx next dev --webpack` pour repasser à webpack en cas de doute sur le bundler.
npm run build        # build prod
npm start            # sert le build prod. ⚠️ En NODE_ENV=production le cookie de session est `secure`
                     #   → invisible sur http://localhost : pour tester l'auth en local, reste sur `npm run dev`.
npm run db:push      # applique le schema Prisma à la DB (pas de migrations versionnées)
npm run db:studio    # UI Prisma pour inspecter la DB
npm test             # tests unitaires + API (Vitest, DB SQLite jetable)
npm run test:watch   # idem, en mode watch
npm run test:e2e     # tests E2E (Playwright, next dev sur DB jetable hors projet)
npx tsc --noEmit     # typecheck — il n'y a PAS de script `lint`/`typecheck`, ni de linter configuré
                     #   (aucun ESLint/Biome/Prettier dans le repo). La CI vérifie via `npm run build`.
```

- `postinstall` = `prisma generate` (jamais `db push` : aucune opération destructive à l'install). Après un changement de `schema.prisma` : `npx prisma generate` puis `npm run db:push`.
- `node scripts/normalize-emails.mjs` : migration one-shot des emails en trim+lowercase (détecte et refuse les collisions de casse). Déjà passée en prod le 2026-07-11 — à ne rejouer que sur une base non normalisée.

## Socle de test

- **Vitest** (`npm test`) : unitaires (`tests/unit/`) + API (`tests/api/`, import direct des Route Handlers, DB SQLite jetable `tests/.tmp/vitest.db` via `tests/setup/global-setup.ts`, auth mockée par `vi.mock("@/lib/session")`, seed via `tests/helpers/seed.ts`). Alias `@/` résolu par `vite-tsconfig-paths`.
- **Playwright** (`npm run test:e2e`, tests dans `e2e/`) : `tests/e2e-server.mjs` lance `next dev` (et non `next start` : le cookie de session est `secure` en prod → invisible sur http) sur une DB jetable **hors projet** (`os.tmpdir`, évite le watcher WAL).
- Toute évolution d'un test E2E doit être reflétée dans la database **Cahier de tests** (règle DoD).

## Règles pour Claude Code

1. **Lis le code existant avant d'éditer.** Ne réinvente pas une fonction qui existe dans `lib/`.
2. **Petits changements cohérents.** Une feature = une série de modifications logiques. Ne touche pas 12 fichiers pour une micro-modif.
3. **Propose avant de casser.** Si tu dois changer un contrat (schéma DB, forme d'une API route), explique pourquoi et attends validation.
4. **TypeScript strict.** Pas de `any`.
5. **Si tu hésites sur un choix, demande.** Mieux vaut une question qu'une refacto à défaire.
6. **Teste tes modifications.** Lance les curl ou les vérifications manuelles et donne les résultats. Ne dis pas juste "à tester".
7. **Utilise les helpers existants.** `parse*/serialize*` de `lib/db.ts`, `check*Access` de `lib/workspace.ts`, `nextPosition` de `lib/positions.ts`, `applyViewConfig` de `lib/client/viewFilters.ts`, `validateRelationValues` de `lib/relations.ts`, `trash*/purge*` de `lib/trash.ts`. Ne réimplémente pas ces logiques — et vérifie leur signature exacte dans *Architecture > Signatures des helpers* avant de les appeler.
8. **zod v4** : utiliser `z.record(z.string(), z.unknown())` et non `z.record(z.unknown())` (le premier arg est la clé, pas la valeur).