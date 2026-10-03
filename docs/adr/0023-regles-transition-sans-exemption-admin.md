# 0023 : Règles de transition par option, sans exemption admin

- Date : 2026-08-05
- Référence : commit `3d754f4`, PR #51 ; porte manquante à la création fermée par `4a19506` (PR #71, 2026-08-08)
- Statut : acceptée

## Contexte
Il fallait pouvoir réserver la pose de certaines options d'une colonne select à des rôles ou à des personnes nommées.
Les boards de production n'avaient aucune règle et ne devaient pas bouger ; restait à décider si un admin pouvait passer outre.

## Décision
Une règle stockée dans `DatabaseProperty.config.rules` dit « pour poser cette option, il faut l'un de ces rôles ou être l'une de ces personnes » ; l'absence de règle vaut permission.
Pas d'exemption admin (décision de Gautier, 05/08) : un admin bloqué ne contourne pas la règle, il la modifie, et lui seul peut écrire la clé `rules`.

## Conséquences
L'échappatoire est explicite, écrite dans le config et réversible, là où une exemption serait invisible.
Trois portes appliquent les règles côté serveur (création et duplication d'un record, et son PATCH, qui ne compte que les transitions réelles) ; l'écriture de `rules` est gatée admin au PATCH, sur la différence, et depuis le 08/08 à la création, sur la présence.
Une option citée par une règle devient non supprimable, et une clé `rules` absente d'un PATCH reporte l'existant.
