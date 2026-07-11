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
npm test          # tests unitaires + API (Vitest)
npm run test:e2e  # tests end-to-end (Playwright)
```

## Tests

- **Unitaires + API** : Vitest (`npm test`). Les tests API importent les Route
  Handlers et tournent contre une **DB SQLite jetable** (`tests/.tmp/vitest.db`,
  créée par `tests/setup/global-setup.ts`) — jamais la `dev.db`. L'auth est mockée
  (`vi.mock("@/lib/session")`) ; le seed des données passe par `tests/helpers/seed.ts`.
- **E2E** : Playwright (`npm run test:e2e`). `tests/e2e-server.mjs` démarre `next dev`
  sur une DB jetable **hors du dossier projet** (le cookie de session n'est `secure`
  qu'en production ; en dev il circule sur `http://localhost`).
- **CI** : `.github/workflows/ci.yml` exécute `build`, `test` (Vitest) et `e2e`
  (Playwright) sur chaque push/PR. Un test rouge bloque la CI (condition DoD).

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

### Sauvegardes

Le déploiement prend un **snapshot de la DB SQLite AVANT chaque MEP** (étape dans
`deploy.yml`). Le snapshot utilise `sqlite3 .backup` (et non `cp`) → copie cohérente
même sous WAL / écritures concurrentes, puis un `PRAGMA integrity_check`. **Un échec
du snapshot ou de son contrôle d'intégrité arrête le déploiement** : jamais de mise en
production sans sauvegarde vérifiée.

- **Emplacement** : `/home/pi/backups/gotyeah-notes/dev-<horodatage>.db` sur le Pi,
  **hors** du volume applicatif `gotyeah-db`.
- **Rotation** : à planifier via un **cron dédié** sur le Pi (hors du chemin critique de
  déploiement). Ex. quotidien :
  ```bash
  # /etc/cron.daily/gotyeah-backup-rotate (chmod +x)
  find /home/pi/backups/gotyeah-notes -name 'dev-*.db' -mtime +7 -delete
  ```
  > La rotation et la réplication ne sont **volontairement pas** dans `deploy.yml` :
  > le client SSH (`appleboy/ssh-action`, `script_stop`) arrête la MEP au moindre code
  > non nul, quelles que soient les gardes shell. Le déploiement se limite donc au
  > snapshot bloquant + la MEP.
- **Restauration** :
  ```bash
  cd /home/pi/sites/gotyeah-notes
  docker compose stop app                       # libère la DB
  BK=/home/pi/backups/gotyeah-notes/dev-<horodatage>.db
  docker run --rm -v gotyeah-notes_gotyeah-db:/data -v /home/pi/backups/gotyeah-notes:/backup \
    keinos/sqlite3:latest sh -c "cp /backup/$(basename "$BK") /data/dev.db && rm -f /data/dev.db-wal /data/dev.db-shm"
  docker compose up -d app
  ```

**Réplication hors-Pi (optionnelle, recommandée).** L'étape restic ne s'active que si
un dépôt est configuré — sinon elle est ignorée sans bloquer. Pour l'activer, créer sur
le Pi `/home/pi/.gotyeah-backup.env` (jamais commité) :

```bash
export RESTIC_REPOSITORY="…"          # ex. sftp:autre-machine:/backups/gotyeah  ou  s3:…
export RESTIC_PASSWORD_FILE="/home/pi/.restic-pass"   # mot de passe du dépôt restic
```

puis `restic init` une fois. Les déploiements suivants répliquent le snapshot
(`--keep-daily 7`). La réplication hors-Pi est **non bloquante** (le snapshot local
protège déjà) — un échec est signalé dans les logs de déploiement sans stopper la MEP.

## Intégration MCP

Les outils MCP `notes_*` (gérer pages, sections, databases, records, modèles… depuis Claude) sont
**greffés sur le serveur MCP distant Sonar** et réutilisent son auth OIDC (Pocket ID) — pas de serveur séparé.
L'API accepte un appel de confiance du MCP (`X-MCP-Secret` + `X-Act-As-Email`), désactivé tant
que `MCP_SHARED_SECRET` est vide. Détails, outils et roadmap : voir `CLAUDE.md`.
