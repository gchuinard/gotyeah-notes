# 0011 : Durcissement de l'instance exposée

- Date : 2026-07-11
- Référence : commits `974a16f` (PR #19), `022c4db` (PR #20) et `da6ffeb` (PR #21), arrivés sur main par la PR #26
- Statut : acceptée

## Contexte
L'instance est publique. Le lot « Durcissement auth, sessions & API » partait de ces constats : token de session stocké en clair (`Session.id = token`), inscription rouverte par `LEGACY_LOGIN`, énumération d'emails par le temps de réponse, aucun rate-limit, emails non normalisés.
Côté API : ni en-têtes de sécurité, ni protection CSRF, et le pont MCP pouvait incarner n'importe quel User existant.

## Décision
Sessions : seul `sha256(token)` est stocké, le token clair ne vit qu'en cookie httpOnly, les expirées sont purgées. Login : `REGISTRATION` (défaut `off`) découple l'inscription, rate-limit mémoire IP+email (429 avant bcrypt), bcrypt factice sur email inconnu, `normalizeEmail` à l'écriture et à la lecture.
API : `X-Frame-Options: DENY`, `nosniff` et `Referrer-Policy` sur toute réponse ; le proxy refuse en 403 une mutation `/api/*` dont l'`Origin` est cross-site ; `MCP_ACT_AS_ALLOWLIST` borne les incarnations, journalisées `[mcp-act-as]`.

## Conséquences
Le passage au hachage a déconnecté tout le monde une fois, coût assumé au cadrage. L'allowlist vide garde le comportement historique : la garde est restée inerte jusqu'au 2026-08-05 (0025).
Limites connues : le rate-limit vit en mémoire et repart de zéro à chaque redéploiement, et sa clé IP lit le premier élément de `X-Forwarded-For`, fourni par le client (fiche F1).
