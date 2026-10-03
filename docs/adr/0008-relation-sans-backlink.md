# 0008 : Propriété relation validée, sans backlink

- Date : 2026-07-10
- Référence : commit `23a69f3`, livré par la PR #12 (la PR dédiée #11 a été fermée)
- Statut : acceptée

## Contexte
Lier une carte à une carte d'une autre database ne se faisait qu'avec des propriétés texte remplies d'URL, sans intégrité ; le Dev Loop lui-même contournait ainsi.
`Record.properties` étant un JSON libre, l'API aurait accepté n'importe quel id.

## Décision
Le type `relation` stocke un `string[]` d'ids de `Record` de `config.targetDatabaseId`, cible qui doit exister, être accessible et vivre dans le même espace (sinon 400 à la création de la colonne).
Tout POST ou PATCH de propriétés passe par `validateRelationValues` (`lib/relations.ts`) : un id absent de la database cible ou en corbeille donne 400. Pas de backlink en v1 ; un lien mort est toléré à l'affichage, jamais une 500.

## Conséquences
Les filtres et tris traitent la relation comme un multiselect (par id, tri par nombre de liens).
Les tranches UI prévues au même ticket (création de la colonne, cellule avec titres et sélecteur) n'ont pas été livrées : aucun composant ne connaît ce type, qui ne se crée et ne se lit que par l'API.
