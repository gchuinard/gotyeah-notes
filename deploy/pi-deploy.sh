#!/bin/bash
# Déploiement de Notes sur le Pi. Ce script ne se lance pas à la main : il est
# exécuté par /usr/local/sbin/gotyeah-deploy (commande forcée de la clé
# SSH_KEY dans authorized_keys), depuis /home/pi/sites/gotyeah-notes, après un git fetch.
# Variables reçues : CIBLE (commit à déployer), AVANT (commit en place).
# Le script est lu dans le commit CIBLE : le modifier sur main suffit.
#
# Jusqu'au 25/09/2026, ces étapes vivaient dans le « script: » de
# .github/workflows/deploy.yml, envoyé tel quel par appleboy/ssh-action avec une clé
# sans restriction. Elles sont reprises sans changement de comportement. Seul le
# contrôle « main a-t-il avancé depuis le commit testé ? » a quitté ce script :
# gotyeah-deploy le fait avant de le lancer (« deploy <sha> »), avec le même message.
set -euo pipefail

# Version en ligne avant ce déploiement (EN_LIGNE dans l'ancien workflow).
EN_LIGNE=$AVANT
git reset --hard "$CIBLE"

# Reprend l'ancien « paths-ignore: **.md » du déclencheur push : si seuls des .md ont
# changé depuis la version en ligne, rien à reconstruire (le build sur le Pi est
# lourd). Un redéploiement du même commit, lui, va au bout.
HORS_MD=$(git diff --name-only "$EN_LIGNE" "$CIBLE" -- ':(exclude)*.md')
if [ "$EN_LIGNE" != "$CIBLE" ] && [ -z "$HORS_MD" ]; then
  echo "Seuls des fichiers .md ont changé : pas de reconstruction."
  exit 0
fi

# Filet de sécurité : SNAPSHOT de la DB SQLite AVANT tout déploiement.
# sqlite3 .backup (pas cp) : cohérent même sous WAL et écritures concurrentes.
# Un échec ARRÊTE le déploiement (set -e) : jamais de MEP sans backup vérifié.
BACKUP_DIR=/home/pi/backups/gotyeah-notes
STAMP=$(date +%Y%m%d-%H%M%S)
mkdir -p "$BACKUP_DIR"
# Résout le volume réel (<projet>_gotyeah-db) sans coder en dur le préfixe de projet :
# une divergence de nom bloquerait sinon TOUS les déploiements.
DB_VOL=$(docker volume ls -q | grep -E '(^|_)gotyeah-db$' | head -1)
[ -n "$DB_VOL" ] || { echo "Volume gotyeah-db introuvable : abandon."; exit 1; }
# --user 0:0 : le dossier de backup appartient à l'utilisateur hôte (pi) ; l'image
# keinos tourne en non-root et ne pouvait pas y écrire (« cannot open »). root lit le
# volume (world-readable) ET écrit dans le dossier hôte (bypass DAC).
docker run --rm --user 0:0 \
  -v "$DB_VOL":/data:ro \
  -v "$BACKUP_DIR":/backup \
  keinos/sqlite3:latest \
  sqlite3 /data/dev.db ".backup '/backup/dev-$STAMP.db'"
# Vérification d'intégrité du snapshot (grep -q échoue, set -e arrête le déploiement).
docker run --rm --user 0:0 -v "$BACKUP_DIR":/backup keinos/sqlite3:latest \
  sh -c "sqlite3 /backup/dev-$STAMP.db 'PRAGMA integrity_check' | grep -q '^ok$'"
echo "Snapshot OK: $BACKUP_DIR/dev-$STAMP.db"
# Rotation des snapshots (7 j) et réplication hors du Pi (restic) : cron dédié sur le
# Pi, HORS du chemin critique de MEP (README « Sauvegardes »). Seul le snapshot vérifié
# ci-dessus bloque une MEP. Jusqu'au 25/09/2026, la raison donnée était aussi que
# appleboy/ssh-action (script_stop) coupait la MEP au moindre code non nul : elle ne
# vaut plus ici (bash, set -e, un « || true » est respecté), le choix reste le même.

# Le service one-shot « migrate » (prisma migrate deploy) tourne avant « app »
# (depends_on: service_completed_successfully dans docker-compose.yml).
docker compose up -d --build
for _ in $(seq 1 60); do
  health=$(docker inspect --format '{{.State.Health.Status}}' gotyeah_notes 2>/dev/null || echo missing)
  if [ "$health" = "healthy" ]; then
    echo "App healthy."
    exit 0
  fi
  echo "Waiting for app to be healthy (health=$health)..."
  sleep 2
done
echo "App did not become healthy in time."
docker logs --tail 200 gotyeah_notes || true
exit 1
