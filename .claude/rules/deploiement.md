---
paths:
  - "{Dockerfile,docker-compose.yml,.dockerignore,.env.example,.npmrc,next.config.ts,package.json}"
  - "{.github,deploy,scripts}/**/*"
  - "prisma/migrations/**/*"
---

# Le déploiement et l'exploitation : invariants

- Tout merge sur `main` à CI verte déploie : jamais de push ni de merge sur `main` sans le go de Gautier ; « CI verte » et « déployé » ne s'annoncent que sur un run vu (`gh run view`) dont le log est lu.
- `deploy.yml` ne part qu'après un run CI réussi d'un push sur `main` et installe le commit testé ; ne pas ajouter `script_stop` ni `envs` à l'action SSH (le Pi refuserait la commande) ; actions épinglées par SHA.
- Les étapes vivent dans `deploy/pi-deploy.sh` (lu dans le commit cible, `set -euo pipefail`) : garde `.md` (seuls des `.md` changés, rien n'est reconstruit), snapshot SQLite vérifié avant tout `docker compose up` ; rotation et réplication restent hors du chemin critique.
- Une migration appliquée ne se modifie jamais (`0_init` figée) ; toute évolution de `schema.prisma` = une nouvelle migration ; la prod applique `prisma migrate deploy`, jamais `db push`.
- Une variable d'env lue par `src/` entre, dans le même commit, dans `.env.example` et dans le bloc `environment:` du compose (pas d'`env_file`) ; une garde n'est livrée qu'après lecture de sa valeur dans le conteneur (`docker exec gotyeah_notes printenv`), jamais dans le dépôt.
- `app` ne publie aucun port ; son healthcheck est `fetch('http://127.0.0.1:3000/')`, état que lit `pi-deploy.sh` ; un réglage du Pi se versionne dans le compose, car le `git reset --hard` du déploiement efface toute modification à la main (seul le `.env` survit).
- Scripts d'exploitation : SQL direct par `better-sqlite3`, jamais le client Prisma généré ; horodatage `prismaNow()`, jamais `CURRENT_TIMESTAMP` ; essai à blanc par défaut, `--execute` pour écrire ; lancés par `docker compose run --rm --entrypoint sh migrate`, jamais `docker exec gotyeah_notes`.
- `.npmrc` (`legacy-peer-deps=true`) ne se supprime pas ; renommer le projet compose ou le volume `gotyeah-db` met à jour `backup-daily.sh` dans le même geste, sinon la sauvegarde de notes s'arrête sans erreur.

Détail et gardes : `docs/doctrine/deploiement.md`.
