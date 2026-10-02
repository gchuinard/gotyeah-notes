# 0009 : Filtrage côté client, params optionnels sur GET records

- Date : 2026-07-10
- Référence : commit `d5b4309`, livré par la PR #12 (la PR dédiée #8 a été fermée) ; le filtrage client date du premier commit applicatif `26fead6`
- Statut : acceptée

## Contexte
Une database renvoie toutes ses cartes, et chaque vue filtre et trie en JS par `applyViewConfig()`.
Le MCP n'a pas ce client : `notes_list_records` rapatriait tous les records, corps BlockNote compris (plus de 68 000 caractères sur la Discovery), intenable pour une session IA.

## Décision
Le filtrage reste côté client. Exception assumée : `GET /api/databases/[id]/records` accepte des params optionnels, `filter` (`ViewFilter[]` appliqué par l'`applyFilters` partagé, sans réimplémentation), `limit` (1-200) et `offset` (total dans `X-Total-Count`, corps toujours en tableau nu), `includeContent=false` (via `stripRecordBody`).
Sans aucun param, le corps de la réponse est identique à l'historique : le front n'est pas touché.

## Conséquences
C'est l'unique import de `lib/client` côté serveur, toléré parce que `lib/client/viewFilters.ts` est pur et n'importe que `lib/db` ; le sortir de `lib/client` est l'objet de la fiche F8.
Le MCP n'utilise toujours pas ces params (`list_records` appelle la route nue, vérifié le 2026-09-29) : le gain visé n'est pas encore réalisé.
