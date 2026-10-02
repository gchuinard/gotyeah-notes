# 0046 : Post-mortem : le HEAD git du Pi ment pour gotyeah-mcp

- Date : 2026-08-09
- Référence : commit `373669c` (PR #76), qui corrige la consigne dans CLAUDE.md ; le constat a été fait sur le Pi, hors de git
- Statut : acceptée

## Contexte
CLAUDE.md disait de vérifier un déploiement sur le Pi, par le HEAD du dépôt. Or `gotyeah-mcp` se déploie par rsync, qui exclut `.git` : le `.git` de `/home/pi/sites/gotyeah-mcp` est le reliquat d'un ancien clone, dont la référence n'avance jamais.
Le 09/08, ce HEAD annonçait `fb687dc` (commit de `gotyeah-mcp` du 05/08) et `git show HEAD:mcp_remote/remote.py` comptait 50 outils, quand le fichier sur disque en portait 52 et que le conteneur les servait ; `git status` y liste en permanence des fichiers suivis « modifiés ».

## Décision
Pour `gotyeah-mcp`, ce qui fait foi est le code dans le conteneur (`docker exec gotyeah_mcp sh -lc 'grep -oE "def (notes_[a-z_]+)" /app/mcp_remote/remote.py | sort -u | wc -l'`), ni le dépôt du Pi, ni la liste d'outils du client, qui reflète le cache de claude.ai.
La règle n'est pas « le HEAD ment » mais « vérifier au bon endroit selon le mode de déploiement » : notes, déployé par `git reset --hard` sur le commit testé, garde un HEAD fiable.

## Conséquences
Un HEAD périmé qui a l'air d'une source de vérité est pire qu'une absence de source : c'est le mode de panne de 0025, une garde qu'on croit active, appliqué à la vérification elle-même.
Même pour notes, le HEAD est le dernier commit dont le déploiement a démarré, pas forcément celui qui tourne (doctrine `deploiement`).
Après un ajout d'outil, l'ordre reste : push sur `main` de `gotyeah-mcp`, redéploiement du conteneur, puis rafraîchissement du connecteur claude.ai (doctrine `mcp`).
