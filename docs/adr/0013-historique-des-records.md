# 0013 : Historique des records par révision de champ

- Date : 2026-07-17
- Référence : commit `17c05d4`, PR #33
- Statut : acceptée

## Contexte
Les records n'avaient aucune piste d'audit : rien ne disait qui avait changé quoi, ni quand.
L'autosave BlockNote envoie un PATCH à chaque pause de frappe : une ligne par requête noierait l'historique.

## Décision
`PATCH /api/records/[id]` écrit, dans la transaction même de l'update, une `RecordRevision` par champ réellement changé (`title`, `content`, `sectionsBody`, id de propriété ou de section), avec l'acteur et `before`/`after` en JSON.
Le diff est calculé avant l'update par `diffRecordRevisions`, logique pure et testée.
Même acteur et même champ à moins de 2 min : la dernière ligne est fusionnée (`shouldCoalesceRevision`).

## Conséquences
L'onglet « Historique » du RecordPanel lit `GET /api/records/[id]/revisions`. La rétention est indéfinie, sans purge, et les pages ne sont pas versionnées.
Revers de la coalescence : la ligne fusionnée garde le `before` d'origine et prend le dernier `after`, donc un aller-retour du même acteur en moins de 2 min tient dans une seule ligne et l'état intermédiaire n'est conservé nulle part.
