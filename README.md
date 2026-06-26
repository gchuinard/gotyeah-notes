# gotyeah-notes

Application web de documentation personnelle self-hosted, inspirée de Notion.

## Stack

- Next.js 16 (App Router) + TypeScript
- Tailwind CSS v4
- Prisma 7 + SQLite
- BlockNote (éditeur de blocs)
- dnd-kit (drag & drop)
- SWR

## Lancer le projet

```bash
npm install
npm run db:push
npm run dev
```

## Commandes

```bash
npm run dev       # serveur de développement
npm run build     # build de production
npm run db:push   # synchroniser le schéma Prisma
npm run db:studio # UI Prisma pour inspecter la DB
```

## Configuration

Copier `.env.example` en `.env` :

```bash
cp .env.example .env
```

- `DATABASE_URL` — connexion SQLite (dev local uniquement ; en conteneur, fixée par le compose).
- `MCP_SHARED_SECRET` — secret du pont MCP (voir ci-dessous). Vide = désactivé.

## Déploiement

Conteneurisé (Docker Compose) derrière Nginx Proxy Manager. Déploiement continu via
`.github/workflows/deploy.yml` : **tout push sur `main`** déclenche un déploiement SSH sur
le serveur (`git reset --hard` + `docker compose up -d --build`) avec attente du healthcheck.
Le schéma Prisma est appliqué automatiquement par le service one-shot `migrate`.

## Intégration MCP

Les outils MCP `notes_*` (gérer pages, sections, recherche… depuis Claude) sont **greffés sur
le serveur MCP distant Sonar** et réutilisent son auth OIDC (Pocket ID) — pas de serveur séparé.
L'API accepte un appel de confiance du MCP (`X-MCP-Secret` + `X-Act-As-Email`), désactivé tant
que `MCP_SHARED_SECRET` est vide. Détails, outils et roadmap : voir `CLAUDE.md`.
