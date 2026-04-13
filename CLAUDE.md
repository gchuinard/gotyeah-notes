# CLAUDE.md

Ce fichier cadre le travail de Claude Code sur ce projet. Lis-le avant toute modification.

## Contexte projet

**notion-perso** est une application web de documentation personnelle self-hosted, mono-utilisateur, sans authentification. L'objectif est de stocker et organiser des notes dans une hiérarchie de pages, avec un éditeur de blocs à la Notion.

Ce n'est **pas** un produit SaaS. C'est un outil perso. Les choix techniques doivent rester simples, pragmatiques, et éviter toute sur-ingénierie.

## Stack

- **Next.js 15** (App Router, Server Components par défaut)
- **TypeScript** strict
- **Tailwind CSS** pour le style
- **Prisma + SQLite** (fichier `prisma/dev.db`)
- **BlockNote** (`@blocknote/react` + `@blocknote/mantine`) pour l'éditeur
- **dnd-kit** pour le drag & drop
- **SWR** pour le fetch côté client
- **lucide-react** pour les icônes

Pas d'autres libs sans raison forte. Avant d'ajouter une dépendance, demande-toi si on peut faire sans.

## Architecture

```
src/
├── app/
│   ├── layout.tsx                # Sidebar + main
│   ├── page.tsx                  # Redirect vers 1ère page
│   ├── pages/[id]/page.tsx       # Vue page (Server Component qui lit via Prisma)
│   └── api/
│       ├── pages/route.ts        # GET (liste flat), POST (créer)
│       └── pages/[id]/route.ts   # GET, PATCH, DELETE
├── components/
│   ├── Sidebar.tsx               # Arbo + actions (client)
│   ├── PageTree.tsx              # Nœud récursif
│   └── Editor.tsx                # BlockNote + autosave (client)
└── lib/
    ├── prisma.ts                 # Singleton PrismaClient
    └── tree.ts                   # buildTree(flat) → arbre
```

## Modèle de données

Une seule table `Page` avec liste d'adjacence :

```prisma
model Page {
  id        String   @id @default(cuid())
  title     String   @default("Sans titre")
  content   String   @default("[]")    // JSON blocks BlockNote
  icon      String?
  parentId  String?
  parent    Page?    @relation("PageTree", fields: [parentId], references: [id], onDelete: Cascade)
  children  Page[]   @relation("PageTree")
  position  Float    @default(0)
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  @@index([parentId])
}
```

**Règles** :
- `position` est un float pour pouvoir insérer entre deux voisins sans renuméroter (ex: entre 2.0 et 3.0 → 2.5).
- `onDelete: Cascade` : supprimer une page supprime récursivement ses enfants. C'est voulu.
- L'arbre est reconstruit côté client dans `lib/tree.ts` à partir de la liste flat.

## Conventions de code

- **Server Components par défaut**. N'utilise `"use client"` que si tu as besoin d'état, d'effets, ou d'event handlers.
- **API routes** : toujours whitelister les champs en PATCH. Jamais `data: body` tel quel.
- **Fetch côté client** : toujours via SWR, clé = URL. Après mutation, `mutate("/api/pages")` ou clé concernée.
- **Tailwind** : classes inline, pas de `@apply`. Pas de CSS modules.
- **Pas de state global** (Zustand, Redux, etc.). SWR + useState local suffisent.
- **Nommage** : composants en PascalCase, fichiers en kebab-case sauf composants (PascalCase.tsx).

## Autosave : comment ça marche

L'éditeur debounce 600ms sur `onChange` et envoie un `PATCH /api/pages/[id]`. Un petit indicateur "Enregistrement… / Enregistré ✓" informe l'utilisateur. Ne touche pas à cette logique sans raison — elle est simple et elle marche.

Si tu ajoutes des champs éditables (icon, cover, etc.), passe-les dans la même fonction `scheduleSave` plutôt que d'en créer une deuxième.

## Ce qu'il NE faut PAS faire

- Pas d'authentification. Mono-utilisateur, point.
- Pas de websockets / temps réel / collaboration. Single user.
- Pas de migration vers Postgres tant que SQLite suffit. Et SQLite suffit jusqu'à plusieurs dizaines de milliers de pages.
- Pas d'ORM autre que Prisma.
- Pas de framework CSS autre que Tailwind.
- Pas de state management global. Vraiment.
- Pas de tRPC, GraphQL, REST elaboré. Des `fetch` sur des routes Next.js, c'est tout.
- Pas de tests unitaires sur les composants UI. Tests d'intégration sur les routes API si nécessaire, en Vitest.

## Commandes

```bash
npm run dev          # dev server
npm run build        # build prod
npm run db:push      # applique le schema Prisma à la DB
npm run db:studio    # UI Prisma pour inspecter la DB
```

## Roadmap & priorités

**V1 (doit marcher)** :
- [x] Hiérarchie de pages (create, delete, nav)
- [x] Éditeur BlockNote avec autosave
- [ ] Drag & drop pour réorganiser (dnd-kit, dans Sidebar)
- [ ] Rename inline dans la sidebar (double-clic)

**V2 (nice to have)** :
- [ ] Icônes/emojis par page
- [ ] Recherche full-text (SQLite FTS5)
- [ ] Export markdown d'une page ou d'une branche
- [ ] Favoris / pages épinglées
- [ ] Dark mode

**Jamais, sauf demande explicite** :
- Multi-user / auth
- Sync cloud
- Apps mobiles natives

## Règles pour Claude Code

1. **Lis le code existant avant d'éditer.** Ne réinvente pas une fonction qui existe déjà dans `lib/`.
2. **Petites PRs mentales.** Une feature = une série de changements cohérents. Ne touche pas 12 fichiers pour une micro-modif.
3. **Propose avant de casser.** Si tu dois changer un contrat (schéma DB, forme d'une API route), explique pourquoi et attends validation.
4. **Pas de commentaires inutiles.** Le code doit être lisible. Les commentaires expliquent le *pourquoi*, jamais le *quoi*.
5. **TypeScript strict.** Pas de `any`. Utilise `unknown` + narrowing si le type est incertain.
6. **Si tu hésites sur un choix, demande.** Mieux vaut une question qu'une refacto à undo.