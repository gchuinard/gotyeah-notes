---
paths:
  - "src/lib/{uploads,appConfig,client/upload}.ts"
  - "src/app/api/{upload,files,attachments,config}/**/*"
  - "src/app/api/records/*/attachments/**/*"
  - "src/components/databases/RecordAttachments.tsx"
---

# Les fichiers téléversés : invariants

- Nom sur disque `<uuid>.<ext>`, extension tirée du MIME, jamais du nom d'origine ; `isSafeUploadName` protège de la traversée de chemin au service comme à la purge.
- `ALLOWED` (images, `POST /api/upload`) et `ATTACHMENT_TYPES` (pièces jointes) restent deux listes séparées : un nouveau type de document s'ajoute à `ATTACHMENT_TYPES`, et le SVG n'y figure pas.
- Toute réponse qui sert un fichier téléversé porte `FILE_CSP` et `Cross-Origin-Resource-Policy: same-origin` (par `fileResponseHeaders` ou explicitement) ; on neutralise par l'en-tête, jamais en nettoyant les octets.
- L'accès à une pièce jointe passe par la carte (`checkRecordAccess`), jamais par le nom de fichier ; `fileName` ne sort dans aucune réponse ; `GET /api/attachments/[id]` streame et répond `Cache-Control: no-store`.
- Aucune route ne supprime un fichier : seule `purgeOrphanUploads` fait un `unlink` ; retirer une pièce jointe, dupliquer ou supprimer une carte ne touchent qu'aux lignes.
- Toute nouvelle colonne qui cite un fichier s'ajoute à la purge ; un `fileName` stocké nu s'ajoute directement, jamais par `extractUploadRefs` ; la purge ne filtre pas `trashedAt`, exception voulue à l'invariant 6.
- `uploadMaxMb` est le seul plafond (images et pièces jointes), lu et écrit par `getAppConfig()` et `setAppConfig()`, jamais par `findUnique` ; dépassement = 413, type refusé = 415 ; le fichier s'écrit avant sa ligne.

Détail et gardes : `docs/doctrine/uploads.md`.
