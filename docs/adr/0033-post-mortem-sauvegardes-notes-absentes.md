# 0033 : Post-mortem : les sauvegardes de notes n'existaient pas

- Date : 2026-08-07
- Référence : commit `08045ce` (PR #64) ; la réparation elle-même a eu lieu sur le Pi, hors dépôt
- Statut : acceptée

## Contexte
La doctrine affirmait « rotation des snapshots (7 j) + réplication restic hors-Pi = cron dédié sur le Pi ». Vérifiées le 07/08, les deux moitiés étaient fausses : aucun cron ne purgeait `/home/pi/backups/gotyeah-notes/` (40 snapshots depuis le 11/07), et notes n'apparaissait nulle part dans `/opt/backup/backup-daily.sh`, ni sa base ni ses uploads.
Le seul filet était le snapshot pré-MEP, sur le même NVMe que la base, alors que le backup quotidien couvrait les autres projets du Pi.

## Décision
`backup-daily.sh` porte `SQLITE_NOTES` et `sqlite_backup` (un `.backup` cohérent à chaud, jamais un `cp`), et `uploads/` entre dans `RESTIC_PATHS`, dossier créé au passage car un chemin absent casserait le script sous `set -euo pipefail`.
Un cron de rotation tourne à 5h30, et la présence de la base dans le dépôt restic a été vérifiée sur le snapshot du 07/08.

## Conséquences
Une ligne de doctrine décrivait une intention, jamais un état : c'est le mode de panne des gardes inertes (0025), appliqué à la sauvegarde elle-même. Une affirmation sur la production se vérifie sur la machine.
À cette date, la restauration n'avait jamais été essayée : une sauvegarde non restaurée n'est pas une sauvegarde.
