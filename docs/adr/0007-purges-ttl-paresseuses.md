# 0007 : Purges TTL paresseuses, sans cron

- Date : 2026-07-10
- Référence : commits `e386d7c` (corbeille, PR #16) et `4f2c08c` (uploads orphelins, PR #17) ; « acte système quel que soit le rôle » décidé le 2026-08-03 avec les gates de rôle (`5e2f1f8`), documenté par `cf58003`
- Statut : acceptée

## Contexte
L'instance est auto-hébergée sur un Pi, sans ordonnanceur : rien ne déclenche une purge à heure fixe.
Or la corbeille et les fichiers téléversés orphelins doivent disparaître après 30 j, et d'autres délais ont suivi (invitations à 7 j, notifications à 90 j).

## Décision
Chaque purge se déclenche à l'usage, par la lecture qui en a besoin : `GET /api/trash` (`TRASH_PURGE_DAYS`), `GET /api/config` (`UPLOAD_PURGE_DAYS`), le claim d'invitation pour les invitations expirées, `GET /api/notifications` (la liste, jamais le compteur) pour `NOTIFICATION_PURGE_DAYS`.
Le filtre de lecture reste l'autorité, la purge n'est que du ménage ; et c'est un acte système, déclenché quel que soit le rôle de l'appelant, lecteur compris, puisque le délai est déjà consommé.

## Conséquences
Pas de cron à maintenir, mais une purge n'a lieu que si l'écran concerné est ouvert : sans visite de Réglages → Stockage, onglet réservé aux admins d'au moins un espace, aucun orphelin n'est supprimé.
`purgeExpiredTrash` porte sur toute l'instance, pas sur l'espace consulté ; l'échec de la purge des orphelins ou des notifications est avalé, et la lecture répond quand même.
