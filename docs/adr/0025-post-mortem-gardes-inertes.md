# 0025 : Post-mortem : trois formes de garde inerte

- Date : 2026-08-05
- Référence : PR #38 (commit `d82edc2`, 2026-07-18), PR #49 (commit `7b6ba1d`), commit `a2a0ff4` (PR #53, défaut du compose) ; la valeur de l'allowlist, posée dans le `.env` du Pi le 05/08, n'est pas dans git
- Statut : acceptée

## Contexte
`MCP_ACT_AS_ALLOWLIST`, livrée le 11/07, n'a exclu personne avant le 05/08 : absente du bloc `environment:` du compose pendant une semaine (corrigé par la PR #38), puis injectée mais vide dix-huit jours de plus, si bien que tout User existant restait incarnable.
Le 05/08, la PR #49 trouve `isPageAccessible(page, userId, isService = false)` câblé dans 14 appels sur 16 : les deux routes oubliées de `app/api/databases/` rendaient le compte de service muet, CI verte, et c'est un usage réel qui l'a révélé, pas un test.
Le même jour, passer `OIDC_ALLOW_SIGNUP` à `false` dans le compose s'avère sans effet tant que la variable reste figée dans le `.env` du Pi : `${VAR:-défaut}` ne joue qu'en son absence.

## Décision
Toute variable lue par `src/` entre au même moment dans `.env.example` et dans le bloc `environment:` de `docker-compose.yml`, et une garde n'est déclarée livrée qu'après lecture de sa valeur dans le conteneur (`docker exec … printenv VAR`), jamais dans le fichier du dépôt.
`tests/api/service-account.test.ts` vérifie l'arité des appels à `isPageAccessible` (3 arguments) et à `pageVisibilityFilter` (2), en plus de l'absence de test de confidentialité réécrit à la main.

## Conséquences
Une garde qu'on croit active et qui ne l'est pas est pire que pas de garde : le diff est vert, seule la valeur manque, et rien ne le signale.
Le durcissement de `OIDC_ALLOW_SIGNUP` exige une édition manuelle du `.env` du Pi, que le dépôt ne permet pas de vérifier.
La leçon a dicté le défaut d'`IDP_ADMIN_EMAILS` (vide vaut personne, 0029), et le même mode de panne a été retrouvé sur les sauvegardes (0033).
