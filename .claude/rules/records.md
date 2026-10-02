---
paths:
  - "src/app/api/{records,properties,templates,databases}/**/*"
  - "src/lib/{relations,assignees,propertyConfig,templates}.ts"
  - "src/components/databases/{RecordPanel,RecordComments,Cell,BulkActionBar}.tsx"
  - "src/components/Editor.tsx"
  - "src/lib/client/debouncedSaver.ts"
---

# Les cartes : invariants

- `Record.properties` est indexé par `DatabaseProperty.id`, jamais par le nom ; `title` n'est pas une clé de `properties` (champ SQL) ; au PATCH, `properties` est fusionné (`null` retire la clé), `content` et `sectionsBody` sont remplacés en entier.
- `isMultiValueType` (`multiselect`, `user`) décide entre scalaire et tableau : écrire une chaîne dans un champ tableau corrompt la carte sans erreur de compilation.
- Les valeurs `relation` et `user` passent par `validateRelationValues` et `validateUserValues` (400, rien d'écrit), la seconde sur le patch entrant, jamais sur le résultat du merge ; une écriture UI qui réémet le tableau passe par `withoutUnknownIds`.
- Le type d'une propriété est figé ; `PATCH /api/properties/[id]` remplace `config` en entier (sauf une clé `rules` absente, qui reporte l'existant) ; retirer une option encore référencée = 400 ; supprimer une propriété retire sa clé de tous les records dans la même transaction.
- `PATCH /api/records/[id]`, dans l'ordre : zod, accès, rôle, `relation` et `user`, sprint, diff des révisions, règles de transition, puis une seule transaction (carte, révisions, notifications) ; un refus n'écrit ni carte ni révision.
- Révisions : une ligne par champ réellement changé, coalescence de 2 min (`shouldCoalesceRevision`), jamais de purge. Commentaires : append-only (ni PATCH ni DELETE), texte brut de 1 à 4000 caractères, `displayName` sans email, aucune notification.
- Autosave : ne pas y toucher sans raison ; toute écriture réconcilie le cache SWR, corps compris (un éditeur périmé détruit le corps) ; `keepalive: true`, flush au démontage et sur `pagehide`.

Détail et gardes : `docs/doctrine/records.md`.
