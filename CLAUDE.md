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

## Modèle de données (10 modèles)

```
User            → auth basique (email, passwordHash, displayName)
Session         → avec currentWorkspaceId pour le workspace actif
Workspace       → conteneur partageable, l'autorité c'est Membership
Membership      → (userId, workspaceId, role: admin|editor|viewer), unique sur (userId, workspaceId)
Section         → conteneur dans la sidebar, type = "private"|"team", appartient à un Workspace
Page            → arborescence (parentId), visibility dénormalisé depuis la section racine
PageVisit       → UPSERT sur unique (userId, pageId), pour la section "Récents"
Database        → liée 1-1 à une Page (pageId @unique). Une database EST une page.
DatabaseProperty → colonnes dynamiques (name, type, position, config JSON)
Record          → lignes de la database (title, properties JSON indexé par property.id)
View            → type table|kanban|calendar|gallery, config JSON (filtres, tris, group-by, columnWidths)
```

### Conventions clés du modèle

- **Page.sectionId** : renseigné UNIQUEMENT sur les pages racines (parentId IS NULL). Pour les enfants, la section est héritée via la racine. Toujours passer par `lib/pages.ts > setPageSection()`.
- **Page.visibility** : dénormalisé depuis la section racine ("private" | "team"), synchronisé récursivement via `setPageSection()`.
- **Record.properties** : JSON indexé par `DatabaseProperty.id` (stable), JAMAIS par le nom de la propriété. Le nom est un label affichable qui peut changer.
- **Record.title** vs property "title" : la property de type `"title"` (créée automatiquement avec la database) correspond au champ SQL `Record.title`, PAS à une entrée dans `Record.properties`. Le composant Cell bifurque sur ce cas.
- **DatabaseProperty.type = "title"** : type spécial, un seul par database, créé auto, ne peut pas être supprimé ni dupliqué. Les garde-fous sont en place côté API.
- **View.config** : remplacement TOTAL au PATCH (pas de merge). Le client envoie toujours le config complet.
- **Record.properties au PATCH** : MERGE via `mergeRecordProperties()`, pas écrasement. Une valeur `null` supprime la clé.
- **Position** : Float, gap-based ordering (gap de 1000). Helpers dans `lib/positions.ts > nextPosition()`.
- **Prisma 7** génère les types avec suffixe `Model` (RecordModel, ViewModel...). `lib/db.ts` les aliase. Le type natif TS `Record` est shadowé → importer comme `import type { Record as DbRecord }`.

## Architecture

```
src/
├── app/
│   ├── layout.tsx
│   ├── page.tsx
│   ├── pages/[id]/page.tsx          # Server Component : charge Page + détecte Database
│   └── api/
│       ├── pages/...                # CRUD pages
│       ├── databases/
│       │   └── [id]/
│       │       ├── route.ts         # GET, DELETE database
│       │       ├── properties/route.ts  # POST property
│       │       ├── records/route.ts     # GET list, POST record
│       │       └── views/route.ts       # POST view
│       ├── properties/[id]/route.ts # PATCH, DELETE property
│       ├── records/[id]/route.ts    # GET, PATCH, DELETE record
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
│       ├── RecordPanel.tsx          # Slide panel détail d'un record (propriétés + BlockNote)
│       ├── Cell.tsx                 # Édition inline par type (title, text, number, select, etc.)
│       ├── PropertyPopover.tsx      # Popover header colonne (rename, options select, supprimer)
│       ├── AddPropertyModal.tsx     # Modal création de colonne
│       ├── SortControls.tsx         # UI de configuration des tris
│       ├── FilterControls.tsx       # UI de configuration des filtres
│       └── portal.tsx               # Composant Portal partagé
└── lib/
    ├── prisma.ts                    # Singleton PrismaClient
    ├── session.ts                   # getSession() → user authentifié ou null
    ├── workspace.ts                 # getMembership, checkDatabaseAccess, checkPropertyAccess, checkRecordAccess, checkViewAccess
    ├── positions.ts                 # nextPosition({ model, where }) → MAX(position) + 1000
    ├── pages.ts                     # createPage, setPageSection (synchro récursive visibility)
    ├── db.ts                        # Types TS (PropertyType, PropertyConfig, ViewConfig, ParsedRecord, etc.)
    │                                # Parse/serialize helpers (parseDatabaseProperty, serializeRecord, etc.)
    │                                # mergeRecordProperties, removePropertyKey
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
- **Outils** : `notes_list_workspaces`, `notes_list_pages`, `notes_get_page`, `notes_create_page`, `notes_update_page`, `notes_delete_page`, `notes_search`, `notes_list_sections`, `notes_create_section`.
- **Activation** (sur le Pi) : même secret dans les deux `.env` — `MCP_SHARED_SECRET` ici, `NOTES_API_BASE_URL=http://gotyeah_notes:3000` + `NOTES_MCP_SECRET` côté Sonar (les deux conteneurs sont sur le réseau `nginx-proxy-manager_default`) — puis `docker compose up -d` et rafraîchir le connecteur claude.ai.
- Variables d'env : voir `.env.example`.

## Reste à faire

- [ ] **Activer le MCP** : poser les secrets dans les `.env` du Pi (notes + Sonar), `docker compose up -d`, rafraîchir le connecteur claude.ai. *(code déjà déployé, dormant)*
- [ ] **MCP v2 — databases/records** : outils pour créer/éditer databases, properties, records, views (compléter « tout faire »).
- [ ] **Match email IdP→User insensible à la casse** : actuellement exact (SQLite ne supporte pas `mode: "insensitive"`). À traiter si la casse diffère entre Pocket ID et le compte.
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