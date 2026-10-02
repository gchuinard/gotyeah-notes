# Doctrine : Uploads et pièces jointes

Périmètre : les fichiers téléversés sur le disque de l'instance. Images des éditeurs BlockNote (`POST /api/upload`, `GET /api/files/[name]`), pièces jointes des cartes (`RecordAttachment`), en-têtes des fichiers servis, purge des orphelins, quota d'upload (`AppConfig`, `/api/config`), `UPLOAD_DIR`.
Invariants courts : `.claude/rules/uploads.md` · Décisions datées : `docs/adr/`

## Fichiers

- `src/lib/uploads.ts` : `uploadsDir()`, `ALLOWED` et `extForType` (images), `ATTACHMENT_TYPES` et `attachmentExtForType` (pièces jointes), `isSafeUploadName`, `mimeForName`, `INLINE_SAFE`, `FILE_CSP`, `fileResponseHeaders`, `extractUploadRefs`, `purgeOrphanUploads`, `UPLOAD_PURGE_DAYS`.
- `src/lib/appConfig.ts` : `getAppConfig()`, `setAppConfig()`.
- Routes (`src/app/api/`) : `upload/` (POST), `files/[name]/` (GET), `records/[id]/attachments/` (GET, POST), `attachments/[id]/` (GET, DELETE), `config/` (GET, PATCH).
- `src/components/databases/RecordAttachments.tsx` : bloc « Documents » de l'onglet Contenu du RecordPanel, sous le corps.
- `src/lib/client/upload.ts` : `uploadFile()`, passé aux trois instances BlockNote (page, corps libre d'une carte, éditeur par section), qui le partagent au lieu de le dupliquer (doctrine `ui`).
- Tests : `tests/api/upload.test.ts`, `tests/api/files-headers.test.ts`, `tests/api/attachments.test.ts`, `tests/api/purge-attachments.test.ts`, `tests/unit/uploads.test.ts`, `e2e/record-attachments.spec.ts`.

## Stockage sur disque

- Images et documents partagent un seul dossier, `uploadsDir()` : `UPLOAD_DIR`, sinon `<cwd>/data/uploads`. En conteneur, `UPLOAD_DIR=/data/uploads`, fixé par le bloc `environment:` du compose, sur le volume de la base : hors volume, les fichiers seraient perdus au rebuild. Sauvegarde du dossier : doctrine `deploiement`.
- Nom sur disque : `<uuid>.<ext>` (`crypto.randomUUID()`). L'extension vient du MIME (`extForType`, `attachmentExtForType`), jamais du nom d'origine. Garde du format : `tests/api/upload.test.ts` (« renvoie /api/files/<uuid>.png »), `tests/api/attachments.test.ts` (« un éditeur dépose un PDF ») ; que l'extension ignore le nom d'origine : non testé.
- `isSafeUploadName` (`[A-Za-z0-9_-]+`, un point, une extension simple) protège de la traversée de chemin, au service comme à la purge. Un nom qui n'y répond pas, double extension comprise, n'est ni servi ni purgé et resterait sur le disque indéfiniment : d'où l'extension unique tirée du MIME. Gardes de la traversée : `tests/unit/uploads.test.ts` (« isSafeUploadName : accepte… »), `tests/api/files-headers.test.ts` (« la garde anti-traversée tient toujours ») ; le nom non conforme ignoré par la purge : non testé.
- Aucune route ne supprime un fichier : seule `purgeOrphanUploads` fait un `unlink` (`grep -rn "fs.unlink" src` ne rend que `src/lib/uploads.ts`). Retirer une pièce jointe, dupliquer ou supprimer une carte ne touchent qu'aux lignes.

## Images de l'éditeur

- `POST /api/upload` : multipart, champ `file`, sans zod (doctrine `api`). Rôle : éditeur d'au moins un espace (`hasRoleInAnyWorkspace`), la requête n'ayant pas de contexte d'espace (ADR 0017). Type hors `ALLOWED` (png, jpeg, gif, webp, svg) → 415, taille au-delà de `uploadMaxMb` → 413, fichier absent → 400. Réponse 200 `{ url: "/api/files/<nom>" }`, que BlockNote embarque dans le contenu ; le nom d'origine est jeté. Gardes : `tests/api/upload.test.ts`, `tests/api/role-gates.test.ts`.
- `GET /api/files/[name]` : session seule, sans scope d'espace ni de page : qui connaît le nom lit le fichier. Nom invalide → 400, absent → 404. Le fichier est lu en entier en mémoire (`fs.readFile`) et servi avec `fileResponseHeaders` (dont `Cache-Control: private, max-age=86400`). Gardes : `tests/api/files-headers.test.ts`, `tests/api/upload.test.ts` (« nom invalide (traversal) → 400 ; fichier absent → 404 »).
- Un document (PDF, bureautique) déposé dans le corps d'une page ou d'une carte échoue en 415, et c'est voulu : les documents passent par les pièces jointes de la carte. Garde : `tests/api/upload.test.ts` (« type non image → 415 », un PDF).

## Deux listes de types

- `ALLOWED` (`POST /api/upload`, images seules) et `ATTACHMENT_TYPES` (pièces jointes) restent deux listes séparées. Élargir `ALLOWED` ouvrirait les documents aux trois instances BlockNote, donc aux pages, et les ferait servir par `/api/files/[name]`, qui n'est scopé à aucun espace (ADR 0040). Un nouveau type de document s'ajoute à `ATTACHMENT_TYPES`.
- `ATTACHMENT_TYPES` couvre PDF, bureautique, texte, CSV, ZIP et quelques images (png, jpeg, webp) ; le SVG n'y figure pas. Gardes : `tests/api/upload.test.ts` (« type non image → 415 »), `tests/api/attachments.test.ts` (« un type non supporté est refusé en 415 », SVG et JS).

## En-têtes des fichiers servis

- Un SVG est un document qui peut porter un `<script>`, et `POST /api/upload` l'accepte de tout éditeur d'au moins un espace. `X-Content-Type-Options: nosniff` (global, `next.config.ts`) n'en protège pas : il empêche le navigateur de deviner un autre type, pas d'honorer le type déclaré. Servi sur l'origine de l'application, un tel SVG s'exécuterait avec la session du lecteur (ADR 0038).
- Toute réponse qui sert un fichier téléversé porte `FILE_CSP` (`default-src 'none'; sandbox`), quel que soit son type, sans liste de types « dangereux » : une liste se périme au premier type ajouté. `sandbox` sans jeton rend le document opaque (ni script, ni formulaire, ni accès aux cookies de l'application) ; `default-src 'none'` coupe toute sous-ressource, exfiltration comprise. La CSP d'une réponse ne s'applique pas au rendu d'une `<img>` : les images de l'éditeur s'affichent normalement. Gardes : `tests/api/files-headers.test.ts` (« pas seulement les suspects », « la CSP retire les scripts »).
- Les octets ne sont pas filtrés : le `<script>` reste dans le fichier servi, c'est l'en-tête qui le neutralise. Ne pas corriger en nettoyant le contenu. Garde : `tests/api/files-headers.test.ts` (« un SVG porteur de script est neutralisé par la CSP »).
- `INLINE_SAFE` (les types d'`ALLOWED`) s'affiche en ligne ; tout autre type part en `application/octet-stream` avec `Content-Disposition: attachment`. `mimeForName` ne connaît que les extensions d'images : un document de pièce jointe, qui vit dans le même dossier, sortirait donc de `/api/files` en téléchargement, jamais rendu. Le SVG est dans `INLINE_SAFE` pour s'afficher dans une `<img>` : ce n'est pas la disposition qui le neutralise, c'est la CSP. Gardes : `tests/api/files-headers.test.ts` (« pas de Content-Disposition », « jamais rendu »).
- `Cross-Origin-Resource-Policy: same-origin` : un autre site ne peut pas embarquer nos fichiers, par une `<img>` par exemple. Garde : `tests/api/files-headers.test.ts` (« interdit l'embarquement depuis un autre site »).
- `/api/files/[name]` obtient ces en-têtes de `fileResponseHeaders` ; `/api/attachments/[id]` les pose lui-même (`FILE_CSP`, CORP, `application/octet-stream`, `attachment`, `no-store`). Toute nouvelle route qui sert un fichier téléversé pose au moins `FILE_CSP` et CORP, par `fileResponseHeaders` ou explicitement. Garde : `tests/api/attachments.test.ts` (« les en-têtes interdisent le rendu et le cache »).

## Pièces jointes

- `RecordAttachment` ne porte que la référence du fichier : `fileName` (nom sur disque), `name` (nom d'origine, affiché et restitué au téléchargement), `mimeType`, `size`. `recordId` en Cascade, `uploadedBy` en SetNull. Plusieurs lignes peuvent citer le même `fileName`.
- L'accès passe par la carte : liste, téléchargement, dépôt et retrait appellent `checkRecordAccess`, jamais une résolution par nom de fichier. Perdre l'accès à la carte (retrait de l'espace, page privée d'autrui, carte en corbeille) ferme le document, en 404. Garde : `tests/api/attachments.test.ts` (« pas au nom du fichier », cas de la page privée d'autrui).
- `fileName` ne sort dans aucune réponse (ni la liste, ni le 201 du dépôt) : le fichier vit dans le même dossier que les images, et `/api/files/<fileName>` le servirait à toute session, sans passer par la carte. Non testé.
- Rôles : un lecteur liste et télécharge ; déposer et retirer demandent le rôle éditeur (403). Gardes : `tests/api/attachments.test.ts` (« peut lire et télécharger », « est refusé (403) », « ne retire rien (403) »). Exception connue : le retrait, définitif, est ouvert à l'éditeur alors que l'irréversible est réservé à l'admin (fiche Discovery « Rôle requis pour retirer une pièce jointe »).
- La liste (`GET /api/records/[id]/attachments`, plus récentes d'abord) donne le `displayName` du déposant, jamais son email (rappel de l'invariant 13 du CLAUDE.md). Garde : `tests/api/attachments.test.ts` (« la liste expose le displayName »).

### Dépôt

- `POST /api/records/[id]/attachments` : multipart, champ `file`, sans zod (doctrine `api`). Type hors `ATTACHMENT_TYPES` → 415, taille au-delà de `uploadMaxMb` → 413, fichier absent → 400. Réponse 201. Gardes : `tests/api/attachments.test.ts` (« un éditeur dépose un PDF : 201 », « refusé en 415 », « refusé en 413 ») ; le 400 : non testé.
- Le fichier s'écrit d'abord, la ligne ensuite : l'inverse laisserait une ligne visible pointant dans le vide, cet ordre ne laisse au pire qu'un orphelin, que la purge ramasse. Non testé.
- Le nom d'origine est rogné et tronqué à `MAX_NAME` (200) caractères ; vide, il devient « document ». Gardes : `tests/api/attachments.test.ts` (« un nom d'origine réduit à des espaces retombe sur un libellé », « un nom d'origine très long est tronqué, pas refusé »).

### Téléchargement

- `GET /api/attachments/[id]` streame le fichier (`createReadStream` puis `Readable.toWeb`, avec `Content-Length`). Ne pas reprendre le `fs.readFile` de `/api/files` : avec des documents de plusieurs Mo sur le Pi, chaque téléchargement simultané chargerait le fichier entier en mémoire. Non testé.
- `Cache-Control: no-store` : un document retiré ou un accès révoqué ne reste pas servi par le cache du navigateur. Garde : `tests/api/attachments.test.ts` (« les en-têtes interdisent le rendu et le cache »).
- `Content-Disposition: attachment; filename*=UTF-8''<nom encodé>` restitue le nom d'origine, accents compris. Garde : `tests/api/attachments.test.ts` (« survit à l'en-tête »).
- Une ligne dont le fichier a disparu rend 404, pas 500. Garde : `tests/api/attachments.test.ts` (« une ligne dont le fichier a disparu rend 404, pas 500 »).

### Retrait, duplication, suppression

- `DELETE /api/attachments/[id]` supprime la ligne, jamais le fichier, qu'une autre ligne peut citer. La purge libère le fichier quand plus rien ne le cite. Garde : `tests/api/attachments.test.ts` (« jamais le fichier »).
- Le retrait est définitif : `RecordAttachment` n'a pas de `trashedAt`, et en ajouter un ne suffirait pas. La purge se règle sur l'âge du fichier, pas sur la date de retrait : un document ancien détaché partirait au passage suivant, et la corbeille ne protégerait que les documents récents (ADR 0040). La modale de confirmation le dit. Garde : `e2e/record-attachments.spec.ts` (« déposer un document, le voir listé, puis le retirer »).
- La duplication d'une carte recopie les lignes et partage le fichier, sans copier d'octet ; `uploadedBy` reste le déposant d'origine. Garde : `tests/api/attachments.test.ts` (« la copie porte les mêmes documents, sans recopier un octet »).
- Supprimer une carte définitivement (`?permanent=1`, purge de la corbeille) emporte ses lignes en Cascade ; le fichier part à une purge suivante. Garde : `tests/api/purge-attachments.test.ts` (« emporte ses pièces jointes (Cascade) »).

### Écran

- `RecordAttachments` lit la clé `/api/records/[id]/attachments` avec `fetcher` et `noRetryOn4xx` : la clé répond 404 quand la carte part en corbeille, c'est un refus, pas une panne. Un échec de lecture s'affiche avant « Aucun document », sinon une liste vide se lirait comme un retrait (non testé). Le refus du serveur au dépôt (type, taille) s'affiche tel quel, séparé de l'erreur de lecture. Garde : `e2e/record-attachments.spec.ts` (« un type refusé affiche le message du serveur, sans rien casser »).
- Écart connu, sans fiche Discovery : le composant n'a pas d'état de chargement (`items` vaut `[]` tant que la requête n'a pas répondu), donc « Aucun document. » s'affiche pendant le chargement, contrairement à l'ordre erreur → chargement → vide → liste (doctrine `ui`). Non testé.
- À venir : dépôt par glisser-déposer et trace dans l'Historique (fiche Discovery « Glisser-déposer et trace dans l'Historique des pièces jointes »). Pièges déjà relevés : doctrine `records`.
- Le pont MCP n'expose ni l'upload ni les pièces jointes (doctrine `mcp`).

## Purge des orphelins

- `purgeOrphanUploads()` supprime les fichiers du dossier que rien ne cite et dont le `mtime` dépasse `UPLOAD_PURGE_DAYS` (30 j). Elle porte sur toute l'instance et ne lit la base que s'il existe au moins un fichier assez vieux. Garde : `tests/api/upload.test.ts` (« garde le référencé et le récent, supprime l'orphelin ancien »).
- Sources lues : `Page.content`, `Record.content` et `Record.sectionsBody` par `extractUploadRefs` (URLs `/api/files/<nom>`), et `RecordAttachment.fileName`, ajouté directement. Toute nouvelle colonne qui cite un fichier s'ajoute ici : la purge ne connaît que ce qu'on lui donne, et un fichier cité ailleurs serait supprimé au bout de 30 jours, donc jamais pendant une recette (ADR 0040). Gardes : `tests/api/upload.test.ts` (« garde le référencé », via `Page.content`), `tests/api/purge-attachments.test.ts` ; `Record.content` et `Record.sectionsBody` : non testés.
- Un nom stocké nu (`fileName` vaut `<uuid>.pdf`, pas `/api/files/<uuid>.pdf`) s'ajoute directement, jamais par `extractUploadRefs` : la regex rendrait un ensemble vide, et la purge supprimerait toutes les pièces jointes de plus de 30 jours. Gardes : `tests/api/purge-attachments.test.ts` (« pas via la regex des URL », « même vieux »).
- Non lu : `Record.coverUrl`, qu'aucune route n'écrit (doctrine `records`). Le jour où il est alimenté, il entre dans la purge.
- L'ensemble des noms cités est recalculé en entier à chaque passage : c'est le comptage de références du projet. Deux lignes qui citent un fichier le protègent, la dernière retirée le libère. Garde : `tests/api/purge-attachments.test.ts` (« pièce jointe qui le cite disparaît »).
- La purge ne filtre pas `trashedAt`, exception voulue à l'invariant 6 du CLAUDE.md : un élément en corbeille protège ses fichiers, sinon le restaurer rendrait ses images et ses pièces jointes mortes. Garde : `tests/api/purge-attachments.test.ts` (« protège encore ses pièces jointes ») ; pour les pages, non testé.
- Déclenchement paresseux par `GET /api/config`, quel que soit le rôle de l'appelant (ADR 0007) ; un échec de purge est avalé et le GET répond quand même (non testé). Dans l'UI, seul Réglages → Stockage appelle ce GET, et l'onglet n'est visible qu'aux admins d'au moins un espace : sans visite d'un admin, aucun orphelin n'est purgé.

## Quota et `AppConfig`

- `AppConfig` est une ligne unique (`id = "app"`) portant `uploadMaxMb` (défaut 10). La lire et l'écrire par `getAppConfig()` et `setAppConfig()`, des upserts qui créent la ligne avec ses défauts ; jamais par `findUnique`, qui rend `null` sur une base neuve. Garde : `tests/api/upload.test.ts` (« GET crée le singleton (défaut 10 Mo) ; PATCH le change et le persiste »).
- `uploadMaxMb` est le seul plafond, commun aux images et aux pièces jointes : un second réglage obligerait chaque route à choisir lequel appliquer. Dépassement → 413 `Fichier trop volumineux (max N Mo)`. Gardes : `tests/api/upload.test.ts` (« dépasse la taille max → 413 »), `tests/api/attachments.test.ts` (« un fichier trop gros est refusé en 413 »).
- `GET /api/config` rend `{ uploadMaxMb }` à tout utilisateur connecté. `PATCH /api/config` : admin d'au moins un espace (`hasRoleInAnyWorkspace`, faute d'admin d'instance, ADR 0017), `uploadMaxMb` entier de 1 à 200, sinon 400. Gardes : `tests/api/upload.test.ts` (« PATCH borne la valeur (1..200) → 400 hors bornes »), `tests/api/role-gates.test.ts`.
- En production, le proxy nginx (NPM) plafonne la taille du corps avant l'application (`client_max_body_size`, hors dépôt) : au-delà, nginx répond lui-même 413, et un `uploadMaxMb` supérieur à ce plafond reste sans effet. Valeur et vérification : doctrine `deploiement`.
