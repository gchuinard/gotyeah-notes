# 0024 : Migrations Prisma versionnées, 0_init figée

- Date : 2026-08-05
- Référence : PR #23, ouverte le 2026-07-11 (`97744d8`, écrit ce jour-là, rebasé le 2026-08-04) et laissée en brouillon jusqu'à la baseline de la prod, fusionnée le 2026-08-05 (`f08125a`) après `455f08a`, `ba7b5ed` et `e6de9ec`
- Statut : acceptée

## Contexte
La prod appliquait le schéma par `prisma db push`, qui peut inférer des `DROP`.
Passer aux migrations sur une base existante exigeait une baseline décrivant la prod telle qu'elle est, marquée appliquée sans être jouée ; or `migrate deploy` ne rejoue jamais une migration appliquée et ne revérifie pas son checksum.

## Décision
Le service one-shot `migrate` du compose lance `prisma migrate deploy` ; toute évolution du schéma passe par une nouvelle migration (`prisma migrate dev --name …`), jamais par `db push` en prod.
La baseline `0_init`, régénérée depuis le schéma courant, a été comparée à la prod (`migrate diff --from-config-datasource`, snapshot pris avant) puis marquée appliquée (`migrate resolve --applied 0_init`), avant le merge.

## Conséquences
`0_init` est figée : la modifier donnerait un déploiement vert sur un schéma incomplet. Deux jobs CI le gardent, `migrations` (schéma et migrations en phase) et `baseline-figee`.
Le workflow `baseline-prisma.yml`, prévu pour une re-baseline, n'a jamais servi et a été supprimé le 2026-09-25 (`58670c0`) : une re-baseline se fait à la main (README §Migrations).
`db push` ne sert plus qu'aux bases locales jetables.
