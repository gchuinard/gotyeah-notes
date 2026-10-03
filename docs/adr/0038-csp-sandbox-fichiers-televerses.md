# 0038 : CSP sandbox sur tout fichier téléversé servi

- Date : 2026-08-08
- Référence : commit `1f90c95` (PR #70) ; documenté dans CLAUDE.md seulement le 2026-08-09 par `373669c` (PR #76)
- Statut : acceptée

## Contexte
`image/svg+xml` fait partie des types acceptés par `POST /api/upload`, ouvert à tout éditeur d'au moins un espace, et un SVG est un document qui peut porter un `<script>`.
Ouvrir directement `/api/files/<nom>.svg` exécutait ce script sur l'origine de l'application, avec la session du lecteur : XSS stockée same-origin, vivante en production.
`X-Content-Type-Options: nosniff` n'y pouvait rien, puisqu'il empêche de deviner un autre type, pas d'honorer le type déclaré ; le projet n'avait aucune CSP.

## Décision
`fileResponseHeaders` (`lib/uploads.ts`) pose `FILE_CSP = "default-src 'none'; sandbox"` et `Cross-Origin-Resource-Policy: same-origin` sur toute réponse de `/api/files/[name]`, sans liste de types jugés dangereux, car une telle liste se périme.
Seuls les types `INLINE_SAFE` (png, jpeg, gif, webp, svg) restent affichés en ligne ; tout autre type part en `Content-Disposition: attachment`.
Les octets ne sont pas filtrés : le script reste dans le fichier et c'est l'en-tête qui le neutralise (`tests/api/files-headers.test.ts`).

## Conséquences
Le changement est non régressif : le `Content-Type` ne bouge pas et les images collées s'affichent comme avant, une CSP de réponse ne visant que la navigation directe.
La branche « attachment par défaut » a servi dès le lendemain : les `.pdf`, `.docx` ou `.zip` des pièces jointes (0040), écrits dans le même `UPLOAD_DIR` et inconnus de `mimeForName`, partent en téléchargement s'ils sont demandés à `/api/files/[name]` ; `/api/attachments/[id]` pose la même `FILE_CSP` et le même CORP.
C'est aussi pourquoi `ALLOWED` (upload d'images) et `ATTACHMENT_TYPES` (pièces jointes) restent deux listes séparées.
