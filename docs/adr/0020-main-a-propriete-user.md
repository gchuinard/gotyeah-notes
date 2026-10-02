# 0020 : « Main à » devient une propriété user

- Date : 2026-08-05
- Référence : commit `92568a3` (PR #48) ; côté hub, résolution des assignés par nom, commit `7d55e6e` (PR gotyeah-mcp #6)
- Statut : acceptée

## Contexte
« Main à », qui dit à qui revient une carte dans le Dev Loop, était un select aux options Gautier et IA, répété sur chaque database qui le portait.
L'API refuse tout changement de type de propriété (400), et supprimer une colonne est définitif : `DatabaseProperty` n'a pas de corbeille.

## Décision
« Main à » devient une propriété `user` adossée aux membres, sur toutes les databases qui le portent et pas seulement le Board (choix de Gautier, 05/08).
`scripts/migrate-main-a-to-user.mjs` crée la colonne neuve, backfille les valeurs, recâble les vues et supprime l'ancienne, en une seule transaction, avec essai à blanc par défaut.

## Conséquences
L'assignation passe par les membres : le MCP résout un assigné par displayName, email ou userId, adossé à `notes_list_members`.
Au passage, les vues « Ton go » portaient l'opérateur `is`, hors `FilterOperator`, que `applyFilters` ignore : elles ne filtraient rien, et la migration les a normalisées en `contains`.
Les `RecordRevision` gardent les anciens ids d'option. Le script sert de modèle à tout changement de type de propriété.
