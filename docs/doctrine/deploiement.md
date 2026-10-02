# Doctrine : Déploiement et exploitation

Périmètre : CI et CD (`.github/workflows/`, `deploy/pi-deploy.sh`), image et conteneurs (`Dockerfile`, `docker-compose.yml`), migrations Prisma, sauvegardes, variables d'environnement, en-têtes globaux (`next.config.ts`), dépendances (`package.json`, `.npmrc`), scripts d'exploitation (`scripts/`), poste de développement.
Invariants courts : `.claude/rules/deploiement.md` · Décisions datées : `docs/adr/`

## CI (`.github/workflows/ci.yml`)

- Jobs, tous en Node 24 : `build` (`prisma generate` puis `npm run build`, qui sert aussi de contrôle de types), `migrations`, `baseline-figee`, `test` (Vitest) et `e2e` (Playwright). Aucun job ne construit l'image Docker : une erreur du `Dockerfile` ne se voit qu'au déploiement, sur le Pi.
- Déclencheurs : push sur `main`, `feat/**`, `fix/**`, `docs/**` et `chore/**`, plus `pull_request` sans filtre. Une branche nommée hors de ces préfixes n'a de CI qu'à l'ouverture de sa PR.
- « CI verte » s'annonce sur un run vu (`gh run list --branch <branche>`, `gh run view <id>`), jamais sur la foi d'un push.
- `e2e` tourne sur `ubuntu-24.04`, pas `ubuntu-latest` : `playwright install --with-deps` installe des paquets apt dont les noms changent d'une version d'Ubuntu à l'autre. Monter cette version est une décision, pas une mise à jour de routine.
- Le `AUTH_SECRET` du bloc `env:` est un placeholder sans effet (voir « Variables d'environnement »).

## CD (`.github/workflows/deploy.yml`, puis le Pi)

- Déclencheur : `workflow_run` après un run CI réussi dont l'événement est un push sur `main`. Le run CI d'une PR ne déploie jamais, même venu d'un fork dont la branche s'appelle `main`. `workflow_dispatch` ne part que de `main` et exige un run CI réussi sur le commit (`gh run list … --status success`). Le commit déployé est celui que la CI a testé (`DEPLOY_SHA`) (ADR 0047).
- Tout merge sur `main` à CI verte est donc une mise en production : le go de Gautier est requis (CLAUDE.md, invariant 1).
- Secrets : `SSH_HOST`, `SSH_USER`, `SSH_KEY`, `SSH_HOST_FINGERPRINT`. Si `SSH_KEY` ou `SSH_HOST_FINGERPRINT` est vide, le job échoue avant toute connexion : sans empreinte, `appleboy/ssh-action` accepterait n'importe quel hôte. L'action est épinglée par SHA.
- `SSH_KEY` est une clé propre à ce dépôt, que `authorized_keys` force sur `/usr/local/sbin/gotyeah-deploy notes` (script du Pi qui appartient à root, hors de ce dépôt). Le workflow n'envoie que `deploy <sha40>`. Le Pi n'accepte de cette clé que `deploy` (qui déploie `origin/main`), `deploy <sha40>` et le dépôt de résultats Allure (`mkdir -p …`, `rsync --server …`, délégué à `estey-allure-depot`) ; tout le reste est refusé et journalisé (`logger -t gotyeah-deploy`). Ne pas ajouter `script_stop` ni `envs` à l'action : ils ajouteraient des lignes à la commande, que le Pi refuserait (ADR 0047).
- `gotyeah-deploy` prend un verrou par projet (attente jusqu'à 15 min, d'où `command_timeout: 20m`), fait `git fetch`, sort en succès sans rien faire si `origin/main` n'est plus le commit demandé (« main a avancé » : la prod ne recule jamais, le commit suivant part après sa propre CI), puis exécute `deploy/pi-deploy.sh` lu dans le commit cible, avec `CIBLE` (commit à déployer) et `AVANT` (`HEAD` du Pi avant ce déploiement).
- Les étapes vivent dans `deploy/pi-deploy.sh`, en bash sous `set -euo pipefail` : `git reset --hard "$CIBLE"`, garde `.md`, snapshot vérifié, `docker compose up -d --build`, attente de l'état `healthy` (environ 2 min). Pour changer le déploiement, on modifie ce script ; il s'applique dès le commit qui le modifie.
- Garde `.md` : si seuls des fichiers `.md` ont changé entre `AVANT` et `CIBLE`, le script sort après le reset, sans snapshot ni reconstruction. Un commit qui mêle doc et code déploie. Redéployer le même commit va toujours au bout.
- Un run Deploy vert ne prouve pas qu'une image a été reconstruite : « main a avancé… » et « Seuls des fichiers .md ont changé » sortent en succès. Lire le log du run avant d'annoncer « déployé ».
- Pas de retour arrière automatique. Un échec de build survient avant tout remplacement de conteneur : la prod reste sur l'image précédente. Un échec du service `migrate` fait échouer `docker compose up`. Une app qui n'est pas `healthy` à temps fait sortir le script en erreur, après les 200 dernières lignes de `docker logs`. Revenir en arrière se fait à la main, depuis le snapshot pré-MEP (voir « Sauvegardes »).
- Après un déploiement en échec, le `HEAD` du Pi vaut déjà `CIBLE` alors que l'image en service est plus ancienne ou malsaine. Réparer en redéployant le même commit (relancer le run, ou `workflow_dispatch` sur `main`) : `AVANT = CIBLE`, le script va au bout. Le commit suivant ne répare rien s'il ne touche que des `.md`, puisque la garde compare au `HEAD` déjà avancé. Non testé.
- Un `npm ci` en `ECONNRESET` pendant le build sur le Pi est une coupure réseau transitoire : relancer le run (`gh run rerun <id> --failed`) sans changer le code.
- Où vérifier : pour notes, le `HEAD` de `/home/pi/sites/gotyeah-notes` est le dernier commit dont le déploiement a démarré, pas forcément celui qui tourne ; l'état du conteneur se lit par `docker inspect gotyeah_notes`. `gotyeah-mcp` se déploie par rsync, son `HEAD` ne fait jamais foi : doctrine `mcp` (ADR 0046).

## Image et conteneurs

- `Dockerfile`, trois étapes sur `node:24-bookworm-slim` : `deps` (`python3 make g++` pour compiler l'addon natif de better-sqlite3 sur arm64, puis `npm ci`), `builder` (`prisma generate`, `npm run build`), `runner` (sortie `standalone`, utilisateur `nextjs` uid 1001). Le runner recopie `better-sqlite3`, `@prisma/adapter-better-sqlite3` et `generated/` : le tracing de Next peut manquer le binaire natif et le client généré hors de `node_modules`.
- `next.config.ts` : `output: "standalone"` et `serverExternalPackages: ["better-sqlite3", "@prisma/adapter-better-sqlite3"]`.
- Compose (projet `gotyeah-notes`) : le service one-shot `migrate` (image de l'étape `builder`, `npx prisma migrate deploy`) tourne d'abord ; `app` (conteneur `gotyeah_notes`) ne démarre que s'il a réussi (`service_completed_successfully`). Les deux montent le volume `gotyeah-db` sur `/data`, qui porte la base (`/data/dev.db`) et les fichiers (`/data/uploads`).
- `app` ne publie aucun port : Nginx Proxy Manager le joint en `gotyeah_notes:3000` sur le réseau externe `nginx-proxy-manager_default`.
- Healthcheck : `fetch('http://127.0.0.1:3000/')`, sain si le statut est inférieur à 500 (la redirection vers `/login` compte). C'est l'état que lit `pi-deploy.sh`.
- Le build tourne sur le Pi (arm64, gourmand en RAM, pics de swap pendant le déploiement). `mem_limit: 640m` est versionné dans `docker-compose.yml` : le `git reset --hard` du déploiement suivant efface toute modification faite à la main sur un fichier suivi du Pi, donc un réglage se versionne. Seul le `.env` du Pi, ignoré par git, survit au reset.
- Nginx Proxy Manager plafonne le corps des requêtes à 25 Mo (`client_max_body_size`, `/data/nginx/custom/server_proxy.conf` du conteneur `npm`, réglage commun à tous les sites du Pi). Au-delà, nginx répond lui-même 413, avant l'application. `PATCH /api/config` accepte un `uploadMaxMb` jusqu'à 200 : un quota supérieur à 25 est sans effet. Vérifier : `docker exec npm grep client_max_body_size /data/nginx/custom/server_proxy.conf`. Quota applicatif : doctrine `uploads`.

## Migrations Prisma

- La prod applique `prisma migrate deploy` (service `migrate`) à chaque déploiement : seules les migrations versionnées de `prisma/migrations/` non encore appliquées sont jouées. Jamais de `db push` sur la prod : il peut inférer des `DROP` (ADR 0024).
- Toute évolution de `schema.prisma` est une nouvelle migration : `npx prisma generate` (client) et `npx prisma migrate dev --name <intitulé>` (migration). `npm run db:push` ne sert qu'à une base locale jetable. Garde : job CI `migrations` (`prisma migrate diff --from-migrations prisma/migrations --to-schema prisma/schema.prisma --exit-code`), qui échoue si le schéma a bougé sans migration.
- Une migration appliquée ne se modifie jamais : `migrate deploy` ne la rejoue pas et ne revérifie pas son checksum, donc la modifier donne un déploiement vert sur un schéma incomplet, l'erreur n'apparaissant qu'à la première requête. Garde : job CI `baseline-figee`, qui ne couvre que `prisma/migrations/0_init/migration.sql` ; les autres migrations appliquées ne sont gardées par rien.
- `postinstall` lance `prisma generate`, jamais `db push` : une installation ne touche aucune base.
- Vitest (`tests/setup/global-setup.ts`) et l'E2E (`tests/e2e-server.mjs`) créent leur base par `db push` : un test vert ne prouve pas qu'une migration est jouable. Seul le job `migrations` construit le schéma à partir des fichiers de migration, et sur une base vide : une migration qui échoue sur des données existantes ne se voit qu'au déploiement.
- Comparer une base réelle aux migrations : `npx prisma migrate diff --from-config-datasource --to-migrations prisma/migrations --exit-code` (0 = identiques, 2 = dérive). En Prisma 7, `--from-url` n'existe plus : la commande affiche son aide et sort en 1. Sur le Pi : `docker compose run --rm --entrypoint sh migrate -c '<commande>'`.
- Re-baseline (environnement né d'un `db push`, sans historique de migration) : à la main en SSH, procédure de README §Migrations (snapshot, `migrate diff`, puis `migrate resolve --applied 0_init` seulement si le diff sort en 0). La prod est déjà baselinée : ne pas la rejouer.

## Sauvegardes

- Snapshot avant chaque MEP (`deploy/pi-deploy.sh`) : `sqlite3 .backup` (jamais `cp`, qui n'est pas cohérent sous WAL), lancé dans l'image `keinos/sqlite3` en `--user 0:0` (le dossier cible appartient à `pi`, l'image tourne en non-root), du volume `*_gotyeah-db` (résolu par suffixe, jamais par le préfixe du projet) vers `/home/pi/backups/gotyeah-notes/dev-<horodatage>.db`, puis `PRAGMA integrity_check` qui doit rendre `ok`. Tout échec arrête le déploiement avant `docker compose up` : pas de MEP sans snapshot vérifié.
- Ce snapshot ne copie que la base, pas `/data/uploads`, et il vit sur le même disque que la base : seul, il ne protège pas d'une perte du Pi (ADR 0033).
- Le chemin critique reste minimal : rotation et réplication vivent dans des crons du Pi, pas dans `pi-deploy.sh`. Sous `set -euo pipefail`, un `|| true` y serait respecté ; la contrainte ancienne de `script_stop` ne vaut plus, le choix demeure (ADR 0012).
- Sauvegarde quotidienne : `/opt/backup/backup-daily.sh` (crontab root, hors de ce dépôt) fait un `.backup` de `/var/lib/docker/volumes/gotyeah-notes_gotyeah-db/_data/dev.db` (`SQLITE_NOTES`, fonction `sqlite_backup`), inclut `…/_data/uploads` dans `RESTIC_PATHS`, puis lance `restic backup` et `restic forget --prune` (ADR 0033).
- Ces deux chemins sont écrits en dur. `sqlite_backup` saute un fichier absent en journalisant « (absent, ignoré) », et un chemin manquant de `RESTIC_PATHS` n'a pas fait échouer la sauvegarde (constaté sur le Pi) : renommer le projet compose (`name: gotyeah-notes`) ou le volume `gotyeah-db` arrête la sauvegarde de notes sans erreur. Un tel renommage met à jour `backup-daily.sh` dans le même geste, puis se vérifie par `restic ls <id>`.
- `uploads/` n'est dans les snapshots restic que depuis le 07/08/2026 : un fichier perdu avant cette date n'est récupérable nulle part.
- Rotation des snapshots pré-MEP : crontab de `pi`, 5h30, `find /home/pi/backups/gotyeah-notes -name 'dev-*.db' -mtime +7 -delete`. Ces snapshots ne sont pas dans `RESTIC_PATHS` : ils restent locaux.
- Restaurer depuis un snapshot pré-MEP : procédure de README §Sauvegardes (« Restauration ») : app arrêtée, copie du fichier dans le volume, suppression de `dev.db-wal` et `dev.db-shm`, redémarrage. Cette commande est fausse telle quelle, donc jamais exercée avec succès : elle lance `keinos/sqlite3` sans `--user 0:0`, or l'image tourne en uid 100 et le volume appartient à `1001:1001` (dossier en 755, `dev.db` en 644), donc la copie échoue. Passer `--user 0:0`, comme `pi-deploy.sh`.
- Restaurer depuis restic (dépôt décrit dans `/etc/backup/restic.env`, en root) : le dump vit sous `<dossier mktemp>/sqlite/gotyeah-notes.db`, un chemin qui change à chaque nuit ; le retrouver par `restic ls <id> | grep sqlite`, le restaurer dans un dossier temporaire, puis `PRAGMA integrity_check`. La restauration du dump de la base a été exercée avec succès ; celle des uploads jamais.
- README §Sauvegardes est en retard : il présente rotation et réplication comme « à mettre en place ». L'état réel est celui décrit ici.

## Variables d'environnement

- Source de vérité : `.env.example` (local) et le bloc `environment:` de `docker-compose.yml` (conteneur). Le compose n'a pas d'`env_file` : une variable absente de ce bloc n'atteint jamais le conteneur, même posée dans le `.env` du Pi.
- Une variable lue par `src/` entre, dans le même commit, dans `.env.example` et dans le bloc `environment:` (CLAUDE.md, invariant 16). Non testé ; liste des variables lues : `grep -rhoE 'process\.env\.[A-Z_]+|env\("[A-Z_]+"' src | sort -u`.
- Une garde n'est livrée qu'après lecture de sa valeur dans le conteneur, jamais dans un fichier du dépôt : `docker exec gotyeah_notes printenv VAR`, ou pour un secret `docker exec gotyeah_notes sh -c 'test -n "$VAR" && echo posée'`, sans l'afficher. Une garde devient inerte de trois façons : variable absente du bloc `environment:`, présente mais vide, ou défaut du compose masqué par le `.env` du Pi (ADR 0025).
- `${VAR:-défaut}` ne joue que si la variable est absente du `.env` du Pi : changer un défaut du compose ne change rien pour une variable figée dans ce fichier. Après tout changement de défaut, relire la valeur dans le conteneur. Cas connu : `OIDC_ALLOW_SIGNUP` (doctrine `auth-invitations`).

| Variable | Lue dans | Défaut du code | Compose | Vide ou absente |
|---|---|---|---|---|
| `DATABASE_URL` | `lib/prisma.ts`, `prisma.config.ts` (CLI) | `file:./prisma/dev.db` | `file:/data/dev.db`, en dur | Requise en local pour le CLI Prisma ; à placer hors du dépôt (voir « Poste de développement ») |
| `OIDC_ISSUER`, `OIDC_CLIENT_ID`, `OIDC_CLIENT_SECRET`, `OIDC_REDIRECT_URI` | `lib/oidc.ts` (`OIDC_ISSUER` aussi par `lib/keycloak.ts`) | `""` | `""` | `oidcEnabled()` exige les quatre ; sinon bouton masqué et `/api/auth/oidc/*` redirige vers `/login?sso_error=disabled`. `OIDC_REDIRECT_URI` donne aussi l'origine publique (`appOrigin()`) |
| `OIDC_ALLOW_SIGNUP` | `lib/oidc.ts` | `"true"` | `"false"` | Défauts divergents à dessein : le code reste permissif pour un self-host sans invitations, le conteneur est durci. À `"false"`, seule une invitation vivante crée un compte |
| `OIDC_BUTTON_LABEL` | `lib/oidc.ts` | `"Authentification unique (SSO)"` | `"Se connecter avec GotYeah"` | Libellé du bouton OIDC |
| `LEGACY_LOGIN` | `lib/oidc.ts` | `"on"` | `"on"` | Login par mot de passe (secours). `off` en production |
| `REGISTRATION` | `lib/oidc.ts` | `"off"` | `"off"` | `on` rouvre `POST /api/auth/register` |
| `MAGIC_LINK` | `lib/magicLink.ts` | `"on"` | `"on"` | `off` : 403 sur `POST /api/auth/magic`, `/login?magic_error=disabled` sur `/api/auth/magic/consume`, 404 sur `/api/invitations/claim`, ce qui ferme aussi l'acceptation d'une invitation par qui n'a pas de compte. `POST …/members` émet quand même un jeton (doctrine `auth-invitations`). Non testé |
| `BREVO_API_KEY` | `lib/mailer.ts` | vide | vide | Envoi désactivé : les invitations sont créées, personne n'est prévenu, l'écran Membres le dit |
| `MAIL_FROM`, `MAIL_FROM_NAME` | `lib/mailer.ts` | `notes@localhost`, `GotYeah Notes` | vide (donc le défaut du code), `GotYeah Notes` | Expéditeur ; il doit être vérifié côté Brevo, sinon l'API répond 400 et rien ne part |
| `APP_BASE_URL` | `lib/mailer.ts` | vide, repli sur `appOrigin()` | vide | Origine des liens d'email, jamais dérivée de l'en-tête `Host`. Garde : `tests/unit/mailer.test.ts` |
| `KEYCLOAK_ADMIN_CLIENT_ID`, `KEYCLOAK_ADMIN_CLIENT_SECRET` | `lib/keycloak.ts` | vide | vide | Comptes SSO désactivés : `configured: false`, aucun bouton, `POST …/idp` répond 409. Sans effet sur l'invitation. Client dédié au realm applicatif, `manage-users` et `view-users` seulement |
| `IDP_ADMIN_EMAILS` | `lib/keycloak.ts` | vide | vide | Vide = personne : `POST …/idp` répond 403 et l'écran n'affiche aucun bouton. Autorité d'instance, parce que le rôle admin d'un espace est auto-attribuable (doctrine `auth-invitations`). Garde : `tests/api/idp-accounts.test.ts` |
| `KEYCLOAK_INTERNAL_URL` | `lib/keycloak.ts` | vide, repli sur la base d'`OIDC_ISSUER` (ce qui précède `/realms/`) | vide | `http://login-keycloak:8080` en prod, car `/admin/*` public est derrière Cloudflare Access (302). Seule la base change : le realm vient toujours d'`OIDC_ISSUER` |
| `MCP_SHARED_SECRET` | `lib/session.ts` | vide | vide | Pont MCP désactivé |
| `MCP_ACT_AS_ALLOWLIST` | `lib/session.ts` | vide | vide | Tout User existant est incarnable (doctrine `mcp`) |
| `UPLOAD_DIR` | `lib/uploads.ts` | `<cwd>/data/uploads` | `/data/uploads`, en dur | Hors du volume, les fichiers seraient perdus au rebuild (doctrine `uploads`) |

- Les durées de vie et délais de purge sont des constantes de code, pas des variables : `INVITATION_TTL_DAYS`, `MAGIC_LINK_TTL_MINUTES`, `INVITE_LINK_TTL_MINUTES`, `TRASH_PURGE_DAYS`, `UPLOAD_PURGE_DAYS`, `NOTIFICATION_PURGE_DAYS`.
- `NODE_ENV` vaut `production` par le Dockerfile et le compose, `development` sous `next dev` ; en `production`, il rend le cookie de session `secure`. `PORT` (3000) et `HOSTNAME` (0.0.0.0) sont posés par le Dockerfile et lus par `server.js`. Aucun des trois ne va dans le `.env`.
- Tests seulement : `E2E_PORT` (`playwright.config.ts`, défaut 3100), `PORT` (`tests/e2e-server.mjs`) et `CI` (reprises et rapport Playwright, pas de réutilisation d'un serveur ouvert).
- `vitest.config.ts` et `tests/e2e-server.mjs` vident `BREVO_API_KEY` et `KEYCLOAK_ADMIN_CLIENT_*` (Vitest aussi `MCP_SHARED_SECRET`) : un test n'envoie aucun email et ne crée aucun compte IdP, même sur un poste qui a de vraies clés. Garder ces lignes.
- `AUTH_SECRET` n'est lue nulle part dans `src/` : ce n'est qu'un placeholder dans `ci.yml`, `vitest.config.ts` et `tests/e2e-server.mjs`, sans effet.

## En-têtes de sécurité

- `next.config.ts` pose sur toutes les réponses `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff` et `Referrer-Policy: strict-origin-when-cross-origin` (ADR 0011). Non testé.
- Il n'y a pas de CSP globale. `nosniff` n'empêche pas d'exécuter un SVG servi sous son type déclaré : les fichiers téléversés portent leur propre CSP (`FILE_CSP`), doctrine `uploads`. L'anti-CSRF par `Origin` vit dans `src/proxy.ts` : doctrine `api`.

## Dépendances et installation

- `npm ci` sans option : `.npmrc`, versionné et copié par le Dockerfile, pose `legacy-peer-deps=true`, car `@blocknote/mantine` déclare un peer `@mantine/core@^8` alors que le projet est en v9. Sans `.npmrc`, `npm ci` échoue en `ERESOLVE` : ne pas le supprimer.
- Preuve : `npm ci --ignore-scripts` sur `package.json` et `package-lock.json` échoue en `ERESOLVE` sans `.npmrc` et installe avec. Ce run ne couvre ni la compilation native de better-sqlite3 ni `prisma generate` (scripts désactivés) : le job `build` de la CI les couvre. Les jobs CI passent encore `--legacy-peer-deps`, redondant avec `.npmrc` ; le `npm ci` nu, scripts compris, ne tourne que dans le Dockerfile, au build sur le Pi.
- Dépendances hors de la liste courte du CLAUDE.md, avec leur raison : `@emoji-mart/data` et `@emoji-mart/react` (sélecteur d'emoji), `@mantine/core` et `@mantine/hooks` v9 (requis par BlockNote), `jose` (OIDC), `bcryptjs` (login de secours), `better-sqlite3` et `@prisma/adapter-better-sqlite3` (driver SQLite de Prisma 7), `dotenv` (lu par `prisma.config.ts`).
- `overrides` de `package.json` : la raison de chaque entrée est dans README §Overrides npm, faute de commentaire possible en JSON ; chacune se retire quand le paquet qui la tire n'en a plus besoin.

## Scripts d'exploitation

- SQL direct via `better-sqlite3`, jamais le client Prisma généré : le client (`provider "prisma-client"`) est du TypeScript aux imports sans extension, que le résolveur ESM de Node refuse.
- Horodatage : `prismaNow()`, jamais `CURRENT_TIMESTAMP`. Prisma stocke un `DateTime` SQLite en texte ISO-8601 (`2026-08-08T11:02:42.575+00:00`) comparé lexicographiquement ; `CURRENT_TIMESTAMP` écrit un espace à la place du `T`, et la ligne devient la plus ancienne de sa journée. Or `firstWorkspaceId` (`lib/session.ts`) prend la membership la plus ancienne comme espace courant d'une identité sans `currentWorkspaceId` : l'espace par défaut du compte de service changerait sans erreur. Garde : `tests/api/create-service-account.test.ts` (describe « prismaNow »).
- `cuid()`, `dbPathFromUrl()` et `prismaNow()` s'importent de `scripts/create-service-account.mjs`, comme le font les autres scripts ; ne pas les réécrire.
- Sur le Pi : `docker compose run --rm --entrypoint sh migrate -c "node scripts/<script>.mjs …"`, depuis `/home/pi/sites/gotyeah-notes`. Jamais `docker exec gotyeah_notes` : l'image `runner` n'a ni `scripts/` ni les dépendances complètes. L'image `migrate` porte les scripts du dernier déploiement.
- Un nouveau script suit le patron des modèles : essai à blanc par défaut et `--execute` pour écrire (sauf s'il est idempotent, comme `create-service-account.mjs`), une seule transaction, logique pure exportée et testée.
  - `scripts/create-service-account.mjs` : idempotent (relancé, il remet en état sans doublon), une transaction. Garde : `tests/api/create-service-account.test.ts`.
  - `scripts/backfill-service-memberships.mjs` : essai à blanc sans `--execute`, une transaction ; le plan chiffre ce que le rattachement ouvre (pages privées par espace, et de qui), à lire avant `--execute`, car un compte de service rattaché lit le privé de tous les membres de l'espace, pas seulement de qui lance la commande. Garde : `tests/api/backfill-service-memberships.test.ts`.
  - `scripts/migrate-main-a-to-user.mjs` : changement de type d'une propriété, que l'API refuse (colonne neuve, recopie des valeurs, recâblage des vues, suppression de l'ancienne), essai à blanc sans `--execute`, une transaction avec vérification des comptes avant commit. Garde : `tests/api/migrate-main-a.test.ts`.
- `scripts/normalize-emails.mjs` est inexécutable : il importe `../generated/prisma/client.js`, qui n'existe pas. Il n'a plus vocation à être rejoué ; ce n'est pas un modèle.

## Poste de développement

- Le développement se fait en Windows natif. Sous WSL, travailler dans le système de fichiers Linux (`~/…`), jamais sur `/mnt/c`, où Turbopack ne voit pas les nouveaux fichiers.
- La base de dev vit hors du dépôt : `DATABASE_URL` du `.env` local pointe hors du dossier projet. Le défaut proposé par `.env.example` (`file:./dev.db`) est dans le dépôt : le changer. Dans le dépôt, le fichier `-wal` de better-sqlite3, écrit dans le dossier surveillé par `next dev`, déclenche un Fast Refresh en plein PATCH : ECONNRESET côté serveur, NetworkError côté client, alors que la donnée est écrite. L'E2E suit la même règle (`os.tmpdir()`, `tests/e2e-server.mjs`) (ADR 0006).
- Statut : mitigé, pas prouvé disparu. Si le symptôme réapparaît (typiquement au glisser-déposer d'une page dans la barre latérale), vérifier d'abord que `DATABASE_URL` ne pointe pas dans le dépôt.
