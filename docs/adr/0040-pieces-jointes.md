# 0040 : Pièces jointes servies par la carte, retrait définitif

- Date : 2026-08-09
- Référence : commit `d6fec93` (PR #74) ; le retrait définitif est une décision de Gautier, datée du 08/08 par l'ancien CLAUDE.md
- Statut : acceptée

## Contexte
Déposer un document sur une carte heurtait deux mécanismes : `POST /api/upload`, image seule, dont les fichiers sont servis par `/api/files/[name]`, qui ne vérifie qu'une session et n'est scopé à aucun espace, et `purgeOrphanUploads`, qui ne lisait que les corps et aurait supprimé au bout de 30 j tout fichier cité par une nouvelle table.
Une corbeille n'aurait rien protégé : la purge se règle sur l'âge du fichier, pas sur la date de retrait, donc un document ancien détaché par erreur partirait au passage suivant.

## Décision
`RecordAttachment` référence un fichier sur disque (`fileName`, `name` d'origine), avec sa propre liste `ATTACHMENT_TYPES`, séparée d'`ALLOWED`, et une route scopée par la carte : `checkRecordAccess`, `Cache-Control: no-store`, `filename*=UTF-8''`, téléchargement en flux.
La purge ajoute `fileName` directement à l'ensemble des noms cités, jamais via `extractUploadRefs`, dont la regex rendrait un ensemble vide ; elle a été écrite et testée avant les routes.
Pas de `trashedAt` : le retrait supprime la ligne, jamais le fichier, et la duplication d'une carte recopie les lignes en partageant le fichier, la purge faisant le comptage de références.

## Conséquences
Perdre l'accès à la carte ferme le document ; un PDF glissé dans le corps d'une page échoue toujours en 415, coût assumé pour ne pas ouvrir les documents aux éditeurs BlockNote.
Un seul plafond, `AppConfig.uploadMaxMb`, partagé avec les images, sous le plafond de 25 Mo du proxy nginx.
Exception connue : ce retrait irréversible est ouvert à l'éditeur (fiche « Rôle requis pour retirer une pièce jointe ») ; le glisser-déposer et la trace dans l'Historique restent à faire (fiche « Glisser-déposer et trace dans l'Historique des pièces jointes »).
