# 0002 : Outils notes_* greffés sur le hub MCP

- Date : 2026-06-26
- Référence : commits `302d7a4` (pont de confiance) et `465e4e4` (décision documentée) le 2026-06-26 ; activation en production le 2026-06-29 (`d55d1e3`) ; extraction dans le dépôt `gotyeah-mcp` par ses commits `8a6144f` (2026-06-30) puis `6f80180` (2026-07-01), absents de ce dépôt-ci
- Statut : acceptée

## Contexte
Il fallait exposer notes à claude.ai sous forme d'outils MCP, pour qu'une session IA lise et écrive les boards.
Le MCP distant de Sonar était déjà branché dans claude.ai avec un OAuth fédéré à l'IdP (Pocket ID à l'époque, Keycloak aujourd'hui) : un serveur séparé aurait dupliqué cette auth.

## Décision
Les outils `notes_*` sont greffés sur ce hub MCP, pas sur un serveur à eux ; leur code vit dans `gotyeah-mcp` (`mcp_remote/notes_tools.py`) depuis l'extraction hors de Sonar, jamais dans `gotyeah_sonar`.
Ils appellent l'API notes par un pont de confiance : `X-MCP-Secret`, comparé en temps constant à `MCP_SHARED_SECRET`, et `X-Act-As-Email`, mappé sur un User existant ; tant que le secret est vide, le pont est éteint.

## Conséquences
Notes ne refait aucune auth pour le MCP, mais `src/proxy.ts` doit laisser passer les requêtes qui portent ces deux en-têtes (oubli corrigé par `d55d1e3`), la validation restant dans `lib/session.ts`.
Le pont est une surface d'incarnation : elle est bornée ensuite par `MCP_ACT_AS_ALLOWLIST` et journalisée (0011), garde restée inerte jusqu'au 2026-08-05 (0025).
