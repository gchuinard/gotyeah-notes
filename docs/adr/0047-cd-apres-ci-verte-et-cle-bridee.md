# 0047 : Déployer après une CI verte, avec une clé bridée côté Pi

- Date : 2026-09-25
- Référence : commits `64b1fc7` (déclenchement) et `2b05e60` (clé dédiée), sans PR retrouvée dans git ; empreinte de l'hôte exigée depuis `42dba5e` (2026-09-24)
- Statut : acceptée

## Contexte
Jusqu'au 25/09, `deploy.yml` partait au push sur `main`, en parallèle de la CI, sur `origin/main` (avec `paths-ignore: ["**.md"]`) : un commit aux tests rouges partait en production.
`SSH_KEY` était une clé sans restriction sur le compte `pi`, root de fait sur le Pi, et les étapes partaient dans le `script:` d'`appleboy/ssh-action`, dont `script_stop` coupait la mise en production au moindre code non nul.

## Décision
`deploy.yml` part sur `workflow_run` après un run CI réussi d'un push sur `main`, jamais d'une PR, et installe le commit testé ; `workflow_dispatch` ne part que de `main` et exige un run CI vert sur le commit.
`SSH_KEY` devient une clé propre au dépôt, que `authorized_keys` force sur `/usr/local/sbin/gotyeah-deploy notes` : le workflow n'envoie que `deploy <sha>`, le Pi fait le `git fetch`, vérifie que ce commit est encore la pointe de `main`, puis exécute `deploy/pi-deploy.sh` lu dans le commit cible.
Le script reprend les étapes sans changement de comportement, dont la garde « seuls des `.md` ont changé, pas de reconstruction » qui remplace `paths-ignore`.

## Conséquences
Tout merge sur `main` à CI verte est un déploiement réel (invariant 1 du CLAUDE.md) ; si `main` a avancé depuis le commit testé, rien n'est fait, et la prod ne recule jamais.
Une clé volée ne peut plus que redéployer `main` ; `script_stop` et `envs` sont retirés, car l'action ajoutait des lignes à la commande, que le Pi refuserait.
`baseline-prisma.yml`, qui envoyait son propre script avec la même clé, ne pouvait plus rien exécuter : il a été supprimé le même jour sur décision du propriétaire (`58670c0`).
