# 0012 : Rotation et réplication des sauvegardes hors du déploiement

- Date : 2026-07-11
- Référence : commits `5dfefad` (PR #22), `cf710c5` (PR #24), `d240b25` (PR #25) et `8256218` (PR #27)
- Statut : acceptée (motif d'origine caduc depuis 0047, décision maintenue)

## Contexte
Le filet pré-MEP (PR #22) prenait un snapshot SQLite vérifié, puis enchaînait dans le même script la rotation à 7 j et une réplication restic optionnelle.
Le déploiement échouait juste après « Snapshot OK » : `appleboy/ssh-action` (`script_stop`) arrêtait la MEP au moindre code non nul, malgré `set +e` et `|| true` dans le shell distant (PR #25, sans effet).

## Décision
Le chemin critique de MEP se limite au snapshot bloquant (`sqlite3 .backup` puis `PRAGMA integrity_check` ; un échec arrête avant `docker compose up`), à la reconstruction et au healthcheck.
La rotation des snapshots et la réplication restic passent dans un cron dédié sur le Pi, hors du déploiement.

## Conséquences
Depuis le 2026-09-25, le script tourne sur le Pi en bash sous `set -euo pipefail` (`deploy/pi-deploy.sh`), où `|| true` est respecté : le motif `script_stop` ne vaut plus, et le chemin critique reste minimal par choix.
Coût : ce qui sort du déploiement n'est plus vérifié par lui. Jusqu'au 2026-08-07, la rotation n'avait jamais été posée et notes manquait au backup quotidien (0033).
