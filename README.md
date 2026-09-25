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
  (Playwright). Un test rouge bloque la CI (condition DoD). Au *push*, elle tourne sur
  `main`, `feat/**`, `fix/**`, `docs/**` et `chore/**` (depuis la PR #39) ; l'événement
  `pull_request` n'a aucun filtre et couvre donc **toutes** les branches. ⚠️ Une branche
  nommée hors de ces préfixes ne déclenche rien au push : sa CI n'arrive qu'à la PR.

## Overrides npm

`package.json` ne peut pas porter de commentaire : la raison de chaque entrée de
`overrides` est donc ici. Chacune est limitée au paquet qui tire la dépendance, et
se retire quand ce paquet publie une version qui n'en a plus besoin.

- `@blocknote/core` → `uuid` `^11.1.1` : BlockNote 0.48 déclare `uuid@^8`, touché par
  GHSA-w5hq-g745-h8pq (livré dans le bundle de l'éditeur). BlockNote n'appelle que
  `v4()`, dont l'API n'a pas changé entre 8 et 11. À retirer en montant BlockNote
  (0.55 ne dépend plus de `uuid`).
- `@prisma/dev` → `@hono/node-server` `^1.19.15` et `prisma` → `mysql2` `^3.22.0` :
  le CLI Prisma 7.7 épingle des versions exactes vulnérables. Ni l'un ni l'autre
  ne sert ici (le premier pour `prisma dev`, le second pour Prisma Studio sur une
  base MySQL), mais le CLI est présent dans l'image `migrate` (étape `builder`).
  À retirer quand Prisma les monte lui-même.

## Configuration

Copier `.env.example` en `.env` :

```bash
cp .env.example .env
```

- `DATABASE_URL` — connexion SQLite (dev local uniquement ; en conteneur, fixée par le compose).
- `MCP_SHARED_SECRET` — secret du pont MCP (voir ci-dessous). Vide = désactivé.

## Déploiement

Conteneurisé (Docker Compose) derrière Nginx Proxy Manager. Déploiement continu via
`.github/workflows/deploy.yml` : **un push sur `main` dont la CI réussit** déclenche un
déploiement SSH sur le serveur (`git reset --hard` sur le commit testé + `docker compose up -d --build`)
avec attente du healthcheck. Jusqu'au 25/09/2026, le déploiement partait dès le push, en
parallèle de la CI : un commit aux tests rouges partait donc aussi en production.

Depuis le 25/09/2026, la clé SSH du workflow (secret `SSH_KEY`) est propre à ce dépôt : sur
le Pi, `authorized_keys` la force sur `/usr/local/sbin/gotyeah-deploy notes`. Le workflow
n'envoie que `deploy <commit testé>` ; le Pi fait le `git fetch`, puis lance
`deploy/pi-deploy.sh` **lu dans ce commit**, qui porte toutes les étapes. Elles vivaient
jusque-là dans le `script:` de `deploy.yml`, envoyé avec une clé sans restriction (root de
fait sur le Pi). Pour changer le déploiement, c'est donc `deploy/pi-deploy.sh` qu'on modifie.
Si seuls des `.md` ont changé depuis la version en ligne, `deploy/pi-deploy.sh` s'arrête sans
reconstruire (rôle tenu auparavant par un `paths-ignore: ["**.md"]` sur le push ; un commit
mêlant doc et code déploie toujours). Si `main` a avancé depuis le commit testé,
`gotyeah-deploy` ne fait rien : le commit suivant sera déployé après sa propre CI.
Le schéma Prisma est appliqué par le service one-shot `migrate` via **`prisma migrate deploy`**
(migrations versionnées, jamais de `db push` en prod).

### Migrations

Le schéma est géré par des **migrations versionnées** (`prisma/migrations/`). Le service
`migrate` applique `prisma migrate deploy` à chaque déploiement : il ne joue que les
migrations non encore appliquées, et **ne fait jamais de `db push`** (qui pourrait inférer
des `DROP` destructifs).

- **Créer une migration** (dev) : modifier `prisma/schema.prisma`, puis
  `npx prisma migrate dev --name <intitulé>`. La CI (job *Migrations*) échoue si un
  `schema.prisma` est modifié sans migration correspondante.
- **Baseline** — ✅ **FAITE en production le 2026-08-05** (`Migration 0_init marked as
  applied.`, puis `No pending migrations to apply.`). Ne pas rejouer : la procédure
  ci-dessous n'est conservée que pour un futur environnement repartant d'un `db push`.
  La base de prod avait été créée
  historiquement par `db push`, sans historique de migration. Avant le tout premier
  `migrate deploy`, il faut la « baseliner » **une seule fois** (marque `0_init` comme
  déjà appliqué, sans le rejouer). Jusqu'au 25/09/2026, ce README conseillait de passer
  par le workflow dédié `.github/workflows/baseline-prisma.yml` (`workflow_dispatch`,
  saisie de confirmation obligatoire : snapshot SQLite, `resolve`, puis vérification
  qu'il ne reste aucune migration en attente). ⚠️ **Il ne peut plus servir** : sa clé
  `SSH_KEY` est désormais forcée côté Pi sur le seul déploiement, qui refuse son script
  sans rien exécuter. Il n'a d'ailleurs jamais été lancé (la baseline de la prod a été
  faite à la main). Reste la procédure manuelle en SSH, avec un accès shell au Pi :
  ```bash
  cd /home/pi/sites/gotyeah-notes
  git fetch && git checkout feat/prisma-migrations   # amène les fichiers de migration
  docker compose build migrate

  # 1. Snapshot de sécurité : la commande n'est pas ailleurs dans ce README,
  #    elle est reprise telle quelle de deploy/pi-deploy.sh (avant le 25/09/2026,
  #    du script de .github/workflows/deploy.yml).
  BACKUP_DIR=/home/pi/backups/gotyeah-notes; STAMP=$(date +%Y%m%d-%H%M%S); mkdir -p "$BACKUP_DIR"
  DB_VOL=$(docker volume ls -q | grep -E '(^|_)gotyeah-db$' | head -1)
  docker run --rm --user 0:0 -v "$DB_VOL":/data:ro -v "$BACKUP_DIR":/backup     keinos/sqlite3:latest sqlite3 /data/dev.db ".backup '/backup/pre-baseline-$STAMP.db'"

  # 2. La base correspond-elle VRAIMENT à 0_init ? (0 = oui, 2 = elle a dérivé)
  docker compose run --rm --entrypoint sh migrate -c     'npx prisma migrate diff --from-config-datasource --to-migrations prisma/migrations --exit-code'

  # 3. Seulement si l'étape 2 sort en 0 :
  docker compose run --rm --entrypoint sh migrate -c "npx prisma migrate resolve --applied 0_init"
  docker compose run --rm migrate                    # migrate deploy → « No pending migrations »
  ```
  Une fois cette baseline faite, la branche peut être mergée sur `main` : les
  déploiements suivants appliquent seulement les **nouvelles** migrations.
- ⚠️ **`0_init` est FIGÉE après la baseline.** Une migration marquée appliquée
  n'est jamais rejouée par `migrate deploy`, qui ne revérifie pas son checksum :
  la modifier produirait un déploiement vert sur un schéma incomplet, et l'erreur
  n'apparaîtrait qu'à la première requête touchant la colonne absente. Toute
  évolution du schéma passe par une **nouvelle** migration. Le job CI
  *Baseline figée* refuse toute modification de ce fichier.

### Sauvegardes

Le déploiement prend un **snapshot de la DB SQLite AVANT chaque MEP** (étape de
`deploy/pi-deploy.sh`, dans `deploy.yml` jusqu'au 25/09/2026). Le snapshot utilise `sqlite3 .backup` (et non `cp`) → copie cohérente
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
  > La rotation et la réplication ne sont **volontairement pas** dans le déploiement
  > (`deploy/pi-deploy.sh`) : il se limite au snapshot bloquant + la MEP. Jusqu'au
  > 25/09/2026, la raison donnée ici était que le client SSH (`appleboy/ssh-action`,
  > `script_stop`) arrêtait la MEP au moindre code non nul, quelles que soient les
  > gardes shell. Elle ne vaut plus : le script tourne désormais sur le Pi en bash sous
  > `set -euo pipefail`, où un `|| true` est respecté. Le choix de garder le chemin
  > critique minimal, lui, demeure.
- **Restauration** :
  ```bash
  cd /home/pi/sites/gotyeah-notes
  docker compose stop app                       # libère la DB
  BK=/home/pi/backups/gotyeah-notes/dev-<horodatage>.db
  docker run --rm -v gotyeah-notes_gotyeah-db:/data -v /home/pi/backups/gotyeah-notes:/backup \
    keinos/sqlite3:latest sh -c "cp /backup/$(basename "$BK") /data/dev.db && rm -f /data/dev.db-wal /data/dev.db-shm"
  docker compose up -d app
  ```

**Réplication hors-Pi (recommandée, à mettre en place à la main).** Il n'y a **aucune**
étape de réplication dans le déploiement : elle a été retirée de `deploy.yml` (commit
`8256218`) pour la même raison que la rotation, `appleboy/ssh-action` (`script_stop`)
arrêtant alors la MEP au moindre code de retour non nul. Cette raison ne vaut plus depuis
le 25/09/2026 (voir ci-dessus), mais le déploiement se limite toujours au snapshot bloquant.

Pour répliquer les snapshots hors du Pi, ajouter un **cron dédié** (hors du chemin
critique de déploiement), par exemple avec restic :

```bash
# /home/pi/.gotyeah-backup.env (jamais commité)
export RESTIC_REPOSITORY="…"                          # ex. sftp:autre-machine:/backups/gotyeah ou s3:…
export RESTIC_PASSWORD_FILE="/home/pi/.restic-pass"
```

```bash
# /etc/cron.daily/gotyeah-backup-replicate (chmod +x), après un `restic init` initial
. /home/pi/.gotyeah-backup.env
restic backup /home/pi/backups/gotyeah-notes
restic forget --keep-daily 7 --prune
```

Tant que ce cron n'est pas en place, la seule protection est le **snapshot local vérifié**
pris avant chaque MEP (ci-dessus) — qui ne survit pas à la perte du Pi.

## Intégration MCP

Les outils MCP `notes_*` (gérer pages, sections, databases, records, modèles… depuis Claude) sont
**greffés sur le serveur MCP distant Sonar** et réutilisent son auth OIDC (Keycloak) — pas de serveur séparé.
L'API accepte un appel de confiance du MCP (`X-MCP-Secret` + `X-Act-As-Email`), désactivé tant
que `MCP_SHARED_SECRET` est vide. Détails, outils et roadmap : voir `CLAUDE.md`.
