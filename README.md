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
