# CLAUDE.md

Ce fichier cadre le travail de Claude Code sur ce projet. Lis-le avant toute modification.

## Contexte projet

**gotyeah-notes** est un clone de Notion self-hosted. Multi-workspace, multi-membres avec rôles, pages organisées en arborescence, databases avec vues multiples (table, kanban, calendar, gallery), drag-and-drop, éditeur de blocs BlockNote.

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

## Modèle de données (13 modèles)

```
User            → auth basique (email, passwordHash, displayName)
Session         → avec currentWorkspaceId pour le workspace actif
Workspace       → conteneur partageable, l'autorité c'est Membership
Membership      → (userId, workspaceId, role: admin|editor|viewer), unique sur (userId, workspaceId)
Section         → conteneur dans la sidebar, type = "private"|"team", appartient à un Workspace
Page            → arborescence (parentId), visibility dénormalisé depuis la section racine
PageVisit       → UPSERT sur unique (userId, pageId), pour la section "Récents"
Database        → liée 1-1 à une Page (pageId @unique). Une database EST une page.
                  templateId/recordSections = template source + squelette de sections estampé.
DatabaseProperty → colonnes dynamiques (name, type, position, config JSON)
Record          → lignes de la database (title, properties JSON indexé par property.id).
                  templateId/sectionsBody = corps SECTIONNÉ (sinon corps libre `content`).
                  sprintId = sprint d'affectation (vue backlog), null = backlog. onDelete SetNull.
View            → type table|kanban|calendar|gallery|backlog, config JSON (filtres, tris, group-by,
                  columnWidths ; backlog : pointsPropertyId/statusPropertyId/epicPropertyId/doneStatusOptionId)
Template        → modèle réutilisable par workspace : columns + kanbanGroupProperty + sections [{id,label}]
                  (builtins : backlog? câble la vue Backlog du template scrum)
Sprint          → sprint d'une Database (vue backlog façon Jira). name, goal, startDate, endDate,
                  state (future|active|completed), position. Record.sprintId pointe dessus.
```

### Conventions clés du modèle

- **Page.sectionId** : renseigné UNIQUEMENT sur les pages racines (parentId IS NULL). Pour les enfants, la section est héritée via la racine. Toujours passer par `lib/pages.ts > setPageSection()`.
- **Page.visibility** : dénormalisé depuis la section racine ("private" | "team"), synchronisé récursivement via `setPageSection()`.
- **Record.properties** : JSON indexé par `DatabaseProperty.id` (stable), JAMAIS par le nom de la propriété. Le nom est un label affichable qui peut changer.
- **Record.title** vs property "title" : la property de type `"title"` (créée automatiquement avec la database) correspond au champ SQL `Record.title`, PAS à une entrée dans `Record.properties`. Le composant Cell bifurque sur ce cas.
- **DatabaseProperty.type = "title"** : type spécial, un seul par database, créé auto, ne peut pas être supprimé ni dupliqué. Les garde-fous sont en place côté API.
- **View.config** : remplacement TOTAL au PATCH (pas de merge). Le client envoie toujours le config complet.
- **Record.properties au PATCH** : MERGE via `mergeRecordProperties()`, pas écrasement. Une valeur `null` supprime la clé.
- **Templates (modèles)** : un `Template` (par workspace) définit colonnes + regroupement kanban + sections de corps à libellés FIXES. Templates « fournis » (ticket, bug) en code (`lib/templates.ts`, id `builtin-*`, lecture seule) à côté des templates DB. `POST /api/databases { templateId }` scaffolde colonnes + kanban + estampe `Database.recordSections`. Un record d'une DB templatée a un **corps sectionné** (`Record.sectionsBody` = `[{id,label,content}]`, parse via `lib/db.ts > parseSectionsBody`) — libellés rendus HORS éditeur (non modifiables), un éditeur BlockNote par section. **Opt-in** : sans template, le record garde son corps libre (`content`). Le menu « modèle » du `RecordPanel` change le template par carte (indépendant du kanban).
- **Backlog (façon Jira)** : un 5e type de vue `backlog`. Les **sprints** sont un modèle Prisma `Sprint` (par database) ; un record y est rattaché via `Record.sprintId` (null = backlog). `onDelete: SetNull` → supprimer un sprint renvoie ses issues au backlog (non destructif). Les colonnes story points / statut / épic ne sont PAS un nouveau concept : ce sont des propriétés normales (number / select / select coloré), câblées dans `View.config` (`pointsPropertyId`, `statusPropertyId`, `epicPropertyId`, `doneStatusOptionId`) par le template fourni `builtin-scrum`. Sans câblage, la vue dégrade proprement (lanes par sprint, lignes titre seul). **Terminer un sprint** = `state="completed"` (archivage simple : les issues gardent leur `sprintId`, le sprint sort du board) — pas de migration forcée des issues inachevées. `POST /api/databases/[id]/records` et `PATCH /api/records/[id]` acceptent `sprintId` (garde-fou : le sprint doit appartenir à la même database, sinon 400). API sprints : `GET/POST /api/databases/[id]/sprints`, `PATCH/DELETE /api/sprints/[id]` (le PATCH porte les transitions démarrer/terminer). Accès via `checkSprintAccess` (`lib/workspace.ts`).
- **Position** : Float, gap-based ordering (gap de 1000). Helpers dans `lib/positions.ts > nextPosition()` (models : databaseProperty, record, view, sprint).
- **Prisma 7** génère les types avec suffixe `Model` (RecordModel, ViewModel...). `lib/db.ts` les aliase. Le type natif TS `Record` est shadowé → importer comme `import type { Record as DbRecord }`.

## Architecture

```
src/
├── app/
│   ├── layout.tsx
│   ├── page.tsx
│   ├── pages/[id]/page.tsx          # Server Component : charge Page + détecte Database
│   ├── templates/page.tsx          # Page de gestion des modèles (TemplatesManager)
│   └── api/
│       ├── pages/...                # CRUD pages (GET /api/pages/[id] expose database:{id})
│       ├── templates/
│       │   ├── route.ts            # GET liste (fournis + workspace), POST create
│       │   └── [id]/route.ts       # GET, PATCH, DELETE (builtins en lecture seule)
│       ├── databases/
│       │   ├── route.ts            # POST create (+ scaffold depuis templateId)
│       │   └── [id]/
│       │       ├── route.ts         # GET, PATCH (recordTemplate), DELETE database
│       │       ├── properties/route.ts  # POST property
│       │       ├── records/route.ts     # GET list, POST record (estampe le corps sectionné, accepte sprintId)
│       │       ├── sprints/route.ts      # GET list, POST sprint (vue backlog)
│       │       └── views/route.ts       # POST view
│       ├── properties/[id]/route.ts # PATCH, DELETE property
│       ├── records/[id]/route.ts    # GET, PATCH (dont sectionsBody/templateId/sprintId), DELETE
│       ├── sprints/[id]/route.ts    # PATCH (rename/dates/état démarrer-terminer), DELETE sprint
│       └── views/[id]/route.ts      # PATCH, DELETE view
├── components/
│   ├── Sidebar.tsx
│   ├── PageTree.tsx
│   ├── Editor.tsx                   # BlockNote + autosave + bouton "Convertir en database"
│   └── databases/
│       ├── DatabaseShell.tsx        # Tabs de views + toolbar (sort/filter/compteur) + branching vers la bonne vue
│       ├── TableView.tsx            # Vue table complète (édition inline, DnD rows, resize colonnes)
│       ├── KanbanView.tsx           # Vue kanban (DnD cards, menu ⋯, renommage colonnes)
│       ├── CalendarView.tsx         # Vue calendrier mensuel
│       ├── GalleryView.tsx          # Vue grille de cartes
│       ├── BacklogView.tsx          # Vue backlog (Jira) : lanes sprint + backlog, DnD, panneau épics, points, démarrer/terminer
│       ├── RecordPanel.tsx          # Slide panel record : props + corps libre OU sectionné + menu modèle par carte
│       ├── Cell.tsx                 # Édition inline par type (title, text, number, select, etc.)
│       ├── PropertyPopover.tsx      # Popover header colonne (rename, options select, supprimer)
│       ├── AddPropertyModal.tsx     # Modal création de colonne
│       ├── SortControls.tsx         # UI de configuration des tris
│       ├── FilterControls.tsx       # UI de configuration des filtres
│       └── portal.tsx               # Composant Portal partagé
│   └── templates/
│       └── TemplatesManager.tsx     # Liste + éditeur de modèles (colonnes, sections, kanban)
└── lib/
    ├── prisma.ts                    # Singleton PrismaClient
    ├── session.ts                   # getSession() → user authentifié ou null
    ├── workspace.ts                 # getMembership, checkDatabaseAccess, checkPropertyAccess, checkRecordAccess, checkViewAccess, checkSprintAccess
    ├── positions.ts                 # nextPosition({ model, where }) → MAX(position) + 1000
    ├── pages.ts                     # createPage, setPageSection (synchro récursive visibility)
    ├── db.ts                        # Types TS (PropertyType, PropertyConfig, ViewConfig, ParsedRecord, RecordSection…)
    │                                # Parse/serialize helpers (parseDatabaseProperty, serializeRecord, parseSectionsBody…)
    │                                # mergeRecordProperties, removePropertyKey
    ├── templates.ts                 # Templates fournis (builtin-scrum/ticket/bug), BacklogConfig, résolution, emptySectionsBody
    ├── tree.ts                      # buildTree(flat) → arbre pour la sidebar
    └── client/
        └── viewFilters.ts           # applyFilters, applySorts, applyViewConfig (côté client uniquement)
```

## Conventions des routes API

- **Auth** : `getSession()` → 401 si null
- **Accès** : check via les helpers `check*Access` de `lib/workspace.ts` → **404** si pas d'accès (jamais 403, pour ne pas leaker l'existence)
- **Validation** : zod, schema en haut du fichier
- **JSON fields** : JAMAIS de `JSON.parse/stringify` direct dans les routes → toujours les helpers `parse*/serialize*` de `lib/db.ts`
- **Réponse succès** : objet parsé direct (pas wrappé dans `{ data: ... }`)
- **Réponse erreur** : `{ error: "message" }` ou `{ error: "Validation failed", details: zodFlattenedErrors }`
- **Position** : automatique via `nextPosition()` pour properties/records/views
- **Pas de filtres/tris côté serveur** : tous les records sont retournés, le client filtre en JS via `applyViewConfig()`

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

- **Drag-and-drop sidebar vers le haut** : ECONNRESET côté serveur + NetworkError client quand on remonte une page. La donnée est sauvée en DB. Hypothèse : better-sqlite3 écrit dans `prisma/dev.db-wal` qui est watché par Next.js dev → Fast Refresh en plein PATCH. Solution probable : déplacer la DB hors du dossier projet ou ignorer `prisma/*.db*` dans le watcher.
- **Turbopack + WSL2** : les nouveaux fichiers ne sont pas détectés sur les mounts `/mnt/c/...`. Nécessite un restart de `next dev` à chaque ajout de fichier. Solution : déplacer le projet dans le FS natif WSL (`~/projects/...`).

## Thème (couleurs)

- **Un seul système** : attribut `data-theme` sur `<html>` (≈12 thèmes : light, sepia, rose, dark, midnight, ocean, forest, nord, tokyo, dracula, catppuccin, gruvbox), posé au SSR depuis le cookie `app-theme` (`app/layout.tsx`), piloté par **Settings → Apparence**. Chaque thème définit `--bg`, `--surface`, `--surface-hover`, `--surface-active`, `--border`, `--text`, `--text-muted`, `--accent` dans `globals.css`.
- **NE JAMAIS utiliser les classes Tailwind `dark:`** : il n'y a pas de `@custom-variant dark`, donc `dark:` suit le `prefers-color-scheme` de l'OS — pas le thème choisi. Styliser via `text-[var(--text)]`, `bg-[var(--surface)]`, etc.
- **BlockNote** suit le thème via la prop `theme={useThemeMode()}` (`lib/client/useThemeMode.ts`, déduit light/dark de la luminance de `--bg`) ; les variables `--bn-colors-*` sont mappées sur la palette du site dans `globals.css` (`html[data-theme] .bn-root`).
- **Curseur** : Tailwind v4 ne met plus `cursor:pointer` sur les `<button>` → règle de base globale dans `globals.css` (`button:not(:disabled)…`).

## Déploiement

- **CI** : `.github/workflows/ci.yml` (build Next + Prisma) sur push/PR.
- **CD** : `.github/workflows/deploy.yml` — sur push `main` (ou `workflow_dispatch`), SSH sur le Pi (secrets repo `SSH_HOST`/`SSH_USER`/`SSH_KEY`), `git reset --hard origin/main` + `docker compose up -d --build`, puis attend que le conteneur `gotyeah_notes` soit `healthy` (healthcheck node défini dans `docker-compose.yml`). ⚠️ **Tout push sur `main` déclenche un déploiement réel.**
- Le schéma Prisma est appliqué au déploiement par le service one-shot `migrate` (`prisma db push`).
- ⚠️ Le build Docker tourne **sur le Pi** (RAM-intensif sur arm64 → pics swap au déploiement). Voir *Reste à faire* (builder en CI).

## Intégration MCP (outils notes_*)

- Les outils MCP de gotyeah-notes sont **greffés sur le MCP distant Sonar** (`gotyeah_sonar/mcp_remote/`), **pas** un serveur séparé : on réutilise son OAuth fédéré à l'IdP **Pocket ID** déjà branché dans claude.ai (volonté : ne pas dupliquer l'auth).
- **Pont de confiance** : `lib/session.ts > getSession()` accepte, à défaut de cookie valide, un appel du MCP via `X-MCP-Secret` (== env `MCP_SHARED_SECRET`, comparaison constant-time) + `X-Act-As-Email` → mappé sur un **User existant** (match email exact). Entièrement **OFF tant que `MCP_SHARED_SECRET` est vide** → aucune surface ajoutée par défaut. L'auth web cookie/password est inchangée.
- ⚠️ **`src/proxy.ts` est le middleware** (Next 16 a renommé `middleware` → `proxy`). Il s'exécute AVANT les routes et 401-ait tout `/api/*` sans cookie : il **laisse passer** les appels portant `x-mcp-secret` + `x-act-as-email` (la validation autoritaire reste dans `session.ts`). Toute future auth par en-têtes doit aussi être whitelistée là.
- **Outils — pages/sections** : `notes_list_workspaces`, `notes_list_pages`, `notes_get_page`, `notes_create_page`, `notes_update_page`, `notes_delete_page`, `notes_search`, `notes_list_sections`, `notes_create_section`.
- **Outils — databases (v2)** : `notes_get_database`, `notes_create_database`, `notes_delete_database`, `notes_create_property`, `notes_update_property`, `notes_delete_property`, `notes_list_records`, `notes_get_record`, `notes_create_record`, `notes_update_record`, `notes_delete_record`, `notes_create_view`, `notes_update_view`, `notes_delete_view`. Une database EST une page → `notes_get_page` renvoie `database: {id}`. Les records se manipulent **par NOM** de propriété (traduit en ids + options select via le schéma, côté `gotyeah_sonar/mcp_remote/notes_tools.py`).
- **Outils — templates** : `notes_list_templates`, `notes_create_database_from_template` (depuis n'importe quel template), `notes_create_ticket_database` / `notes_create_bug_database` (raccourcis builtins), `notes_set_record_template` (modèle de corps LIBRE d'une database).
- **Activation** (sur le Pi) : même secret dans les deux `.env` — `MCP_SHARED_SECRET` ici, `NOTES_API_BASE_URL=http://gotyeah_notes:3000` + `NOTES_MCP_SECRET` côté Sonar (les deux conteneurs sont sur le réseau `nginx-proxy-manager_default`) — puis `docker compose up -d` et rafraîchir le connecteur claude.ai. **✅ Actif en prod (2026-06-29)** ; l'email du User a été aligné sur le gmail (= email IdP) car le match est exact.
- Variables d'env : voir `.env.example`.

## Reste à faire

- [x] ~~**Activer le MCP**~~ : fait (2026-06-29). Secrets posés sur le Pi, pont actif, connecteur claude.ai rafraîchi.
- [x] ~~**MCP v2 — databases/records**~~ : fait (2026-06-29). 14 outils `notes_*` (databases, properties, records, views) côté Sonar, records par nom. Voir section *Intégration MCP*.
- [x] ~~**Système de modèles (templates)**~~ : fait (2026-06-30). Modèle `Template` (workspace), page `/templates`, corps sectionné à libellés fixes, menu de template par carte, scaffold `POST /api/databases {templateId}`. ticket/bug = templates fournis. Outils MCP templates côté Sonar.
- [x] ~~**Backlog (façon Jira)**~~ : fait (2026-06-30). 5e type de vue `backlog` (`BacklogView.tsx`), modèle Prisma `Sprint` + `Record.sprintId` (onDelete SetNull), API sprints (`/api/databases/[id]/sprints`, `/api/sprints/[id]`), template fourni `builtin-scrum` (Sprint absent du template — c'est un modèle, les points/épic/statut sont des colonnes câblées dans `View.config`). Panneau épics (select coloré), DnD issues entre sprints/backlog, story points par sprint, démarrer/terminer un sprint (terminer = archivage simple). Testé e2e back/API (19 assertions). **Front à valider dans le navigateur.**
- [ ] **MCP — sprints (côté Sonar)** : `notes_create_database_from_template('builtin-scrum')` marche déjà (builtin listé par `notes_list_templates`). Manque côté `gotyeah_sonar/mcp_remote/notes_tools.py` : outils `notes_list_sprints` / `notes_create_sprint` / `notes_update_sprint` (démarrer/terminer) / `notes_delete_sprint`, et `sprintId`/`sprint` (par NOM) dans create/update_record. Hors de CE repo.
- [ ] **Match email IdP→User insensible à la casse** : actuellement exact (SQLite ne supporte pas `mode: "insensitive"`). À traiter si la casse diffère entre Pocket ID et le compte.
- [ ] **MCP v3 (optionnel)** : `update_property` ne gère que rename/position (changer type/options d'un select casserait les records). Édition des options select par nom à ajouter si besoin.
- [ ] **Builds hors Pi** : déplacer le build Docker en CI (GitHub Actions) + `docker pull` au déploiement, pour supprimer les pics RAM/swap au déploiement.
- [ ] (optionnel) UI Settings « Jetons d'accès » si un jour on veut un PAT en complément de l'IdP.

## Ce qu'il NE faut PAS faire

- Pas de migration vers Postgres tant que SQLite suffit.
- Pas de framework CSS autre que Tailwind.
- Pas de state management global.
- Pas de tRPC, GraphQL. Des `fetch` sur des routes Next.js.
- Pas de `any` en TypeScript. Utiliser `unknown` + narrowing.
- Pas de commentaires inutiles. Les commentaires expliquent le *pourquoi*, jamais le *quoi*.

## Commandes

```bash
npm run dev          # dev server (ajouter --turbo pour Turbopack)
npm run build        # build prod
npm run db:push      # applique le schema Prisma à la DB
npm run db:studio    # UI Prisma pour inspecter la DB
```

## Règles pour Claude Code

1. **Lis le code existant avant d'éditer.** Ne réinvente pas une fonction qui existe dans `lib/`.
2. **Petits changements cohérents.** Une feature = une série de modifications logiques. Ne touche pas 12 fichiers pour une micro-modif.
3. **Propose avant de casser.** Si tu dois changer un contrat (schéma DB, forme d'une API route), explique pourquoi et attends validation.
4. **TypeScript strict.** Pas de `any`.
5. **Si tu hésites sur un choix, demande.** Mieux vaut une question qu'une refacto à défaire.
6. **Teste tes modifications.** Lance les curl ou les vérifications manuelles et donne les résultats. Ne dis pas juste "à tester".
7. **Utilise les helpers existants.** `parse*/serialize*` de `lib/db.ts`, `check*Access` de `lib/workspace.ts`, `nextPosition` de `lib/positions.ts`, `applyViewConfig` de `lib/client/viewFilters.ts`. Ne réimplémente pas ces logiques.
8. **zod v4** : utiliser `z.record(z.string(), z.unknown())` et non `z.record(z.unknown())` (le premier arg est la clé, pas la valeur).