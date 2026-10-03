# Doctrine : Records (cartes)

Périmètre : les valeurs des propriétés d'une carte (`title`, `relation`, `user`, options select), les routes records et propriétés, les révisions, les templates et le corps sectionné, les commentaires, le RecordPanel, l'autosave des corps (carte et page).
Invariants courts : `.claude/rules/records.md` · Décisions datées : `docs/adr/`

## Fichiers

- `src/app/api/records/[id]/` : `route.ts` (GET, PATCH, DELETE), `duplicate/`, `restore/`, `revisions/`, `comments/`, `attachments/` (doctrine `uploads`).
- `src/app/api/databases/route.ts` (création et scaffold depuis un template), `databases/[id]/route.ts` (PATCH `recordTemplate`), `databases/[id]/records/route.ts` (liste et création), `databases/[id]/properties/route.ts`, `properties/[id]/route.ts`, `templates/`.
- `src/lib/relations.ts` (`validateRelationValues`), `src/lib/assignees.ts` (`validateUserValues`), `src/lib/propertyConfig.ts` (`validatePropertyConfig`, `removedOptionIds`, `findReferencedOptionIds`), `src/lib/propertyColors.ts` (`SELECT_COLORS`), `src/lib/templates.ts` (templates fournis, `emptySectionsBody`).
- Dans `src/lib/db.ts` : `mergeRecordProperties`, `removePropertyKey`, `isMultiValueType`, `withoutUnknownIds`, `parseSectionsBody`/`serializeSectionsBody`, `diffRecordRevisions`, `shouldCoalesceRevision`.
- `src/components/databases/` : `RecordPanel.tsx`, `RecordComments.tsx`, `RecordAttachments.tsx` (doctrine `uploads`), `Cell.tsx` (dont `SelectBadge`, réutilisé par le backlog et `BulkActionBar`), `BulkActionBar.tsx`. `src/components/Editor.tsx` (page). `src/lib/client/debouncedSaver.ts`.
- Gates de rôle de toutes ces routes : `tests/api/role-gates.test.ts`.

## Valeurs de `properties`

- `Record.properties` est un JSON indexé par `DatabaseProperty.id`, jamais par le nom de la propriété, qui n'est qu'un libellé modifiable. Non testé.
- La propriété de type `title` n'est pas une clé de `properties` : elle correspond au champ SQL `Record.title`. `Cell.tsx` bifurque sur ce cas, et tout code générique sur les propriétés doit en faire autant. Non testé.
- Une database a une seule propriété `title`, créée par `POST /api/databases`. `POST /api/databases/[id]/properties` refuse `type: "title"` (400), `DELETE /api/properties/[id]` refuse de la supprimer (400), et aucune route ne duplique une propriété. Non testé.
- Le type d'une propriété est figé : `PATCH /api/properties/[id]` refuse un champ `type`, et un `config.type` différent du type (400) (`tests/api/property-options.test.ts`, AC7). Changer de type passe par une colonne neuve et une migration des valeurs (doctrine `deploiement`, scripts).
- Rappel (invariant 3 du CLAUDE.md) : au PATCH, `properties` est fusionné par `mergeRecordProperties` et `null` retire la clé (`tests/api/records-inline-save.test.ts`) ; `content` et `sectionsBody` sont remplacés en entier.
- Les clés de `properties` ne sont pas vérifiées contre le schéma, ni à la création ni au PATCH : une clé inconnue est stockée telle quelle, la cohérence revient au client. Seules les valeurs `relation` et `user` sont contrôlées, plus les règles de transition (doctrine `roles-permissions`). Non testé.
- `isMultiValueType` (`multiselect`, `user`) dit si une valeur est un tableau. Le consulter partout où l'on choisit entre scalaire et liste (drop kanban, filtres, actions groupées) : écrire une chaîne dans un champ tableau corrompt la carte sans erreur de compilation. Filtres sur ces types : doctrine `vues`.

## Propriété `relation`

- La valeur est un `string[]` d'ids de `Record` de la database `config.targetDatabaseId`. À la création de la propriété, la cible est obligatoire, accessible et dans le même espace, sinon 400 (`tests/api/relation-property.test.ts`, AC1).
- Toute écriture passe par `validateRelationValues`, à la création de la carte comme au PATCH : valeur non tableau, id inconnu, d'une autre database ou en corbeille, 400 et rien n'est écrit. `null` retire la clé (`tests/api/relation-property.test.ts`, AC2 et AC3 ; le refus d'un id en corbeille n'est pas testé).
- Pas de backlink. Un id dont la carte a été supprimée est un lien mort toléré à l'affichage, jamais une 500 (`tests/api/relation-property.test.ts`, AC6 ; ADR 0008).

## Propriété `user` (assignés)

- La valeur est un `string[]` d'ids de membres de l'espace hôte. La propriété n'a pas d'options, à dessein : ses colonnes kanban viennent des membres (doctrine `vues`).
- `validateUserValues` s'applique au patch entrant, jamais au résultat du merge : sinon un membre retiré gèlerait toute écriture sur les cartes qu'il occupait. Valeur non tableau ou id non membre : 400 (`tests/api/user-property.test.ts` : AC3 pour le refus, AC6 pour la carte d'un membre retiré qui reste modifiable).
- Un membre parti reste un lien mort toléré, affiché grisé « Membre retiré ».
- Une écriture depuis l'UI réémet le tableau entier : elle passe par `withoutUnknownIds`, sinon le 400 rend la carte inéditable, avec un rollback muet. Portes : `KanbanView` au drop ; `Cell` au commit du sélecteur, seulement si la valeur a bougé (ouvrir puis fermer sans rien toucher n'écrit rien) ; `BulkActionBar` à l'union. Le lien mort est ainsi lâché au premier déplacement, ce qui rend la colonne « Membre retiré » réparatrice. Gardes : `tests/unit/kanbanColumns.test.ts` (logique), `e2e/kanban-me-filter.spec.ts` (drop) ; portes `Cell` et `BulkActionBar` non testées.
- La cellule et le filtre n'affichent que le `displayName`, jamais l'email que `GET /api/workspaces/[id]/members` renvoie à tout membre (`e2e/user-property.spec.ts`).
- Les colonnes « Assigné » des templates fournis sont de type `user` ; les databases scaffoldées avant le 04/08/2026 gardent leur colonne texte (ADR 0018).
- « Main à » est une propriété `user` sur les boards : l'assignation passe par les membres, ne pas recréer de select Gautier/IA (ADR 0020).

## Options select et `config`

- `validatePropertyConfig` exige pour chaque option un id et un nom non vides et une couleur de `SELECT_COLORS`, sinon 400 (`tests/unit/propertyConfig.test.ts`).
- Renommer ou recolorer une option conserve son id : aucune carte n'est réécrite. Retirer une option encore référencée par une carte, un `doneStatusOptionId`, un filtre de vue ou une règle de transition répond 400 (`findReferencedOptionIds` ; `tests/api/property-options.test.ts`, AC5).
- `PATCH /api/properties/[id]` remplace `config` en entier, options comprises : envoyer le config complet. Seule une clé `rules` absente reporte l'existant (doctrine `roles-permissions`).
- Supprimer une propriété (admin, définitif) retire sa clé de tous les records de la database, dans la même transaction (`removePropertyKey`). La purge des clés n'est pas testée.

## Routes d'une carte

- `POST /api/databases/[id]/records` (éditeur, 201) : valide `relation` et `user`, applique les règles de transition à la création, vérifie `sprintId` (doctrine `sprints-backlog`), pose le corps initial (voir Templates), puis crée avec `nextPosition` dans la transaction.
- `PATCH /api/records/[id]` (éditeur), dans cet ordre : validation zod du corps de requête (400), accès (404), rôle (403), `relation` et `user` (400), sprint (400), diff des révisions, règles de transition (403), puis une seule transaction pour la carte, ses révisions et les notifications `record_assigned` (doctrine `notifications`). Un refus n'écrit ni carte ni révision.
- `DELETE /api/records/[id]` met à la corbeille (éditeur) ; `?permanent=1` est définitif (admin) et emporte en cascade révisions, commentaires et lignes de pièces jointes (`tests/api/record-revisions.test.ts`, `tests/api/comments.test.ts` ; la cascade des pièces jointes n'est pas testée).
- `POST /api/records/[id]/restore` (éditeur) répond 409 tant que la page hôte est en corbeille : restaurer la page d'abord (`tests/api/trash.test.ts`).
- `POST /api/records/[id]/duplicate` (éditeur, 201) : copie serveur atomique. Titre suffixé « (copie) » ; `icon`, `coverUrl`, `content`, `properties`, `sectionsBody`, `templateId` et `sprintId` repris ; position en fin ; `createdBy` = l'utilisateur courant. Garde : `tests/api/record-duplicate.test.ts` (titre, `icon`, `properties`, corps, `sprintId`, position) ; la copie de `coverUrl`, de `templateId` et le `createdBy` ne sont pas testés. Les valeurs sont recopiées sans revalidation, liens morts compris, et aucune révision n'est écrite. Les pièces jointes suivent en partageant le fichier (doctrine `uploads`) ; la duplication passe les règles de transition comme une création (doctrine `roles-permissions`).
- `coverUrl` : `GalleryView` l'affiche, mais aucune route ne l'écrit, seule la duplication le recopie, et `purgeOrphanUploads` ne le scanne pas (doctrine `uploads`). Ne rien construire en supposant qu'il est alimenté. Non testé.
- Pièces jointes (`/api/records/[id]/attachments`, `/api/attachments/[id]`) : doctrine `uploads`.

## Révisions (`RecordRevision`)

- Écrites côté serveur, dans la transaction de `PATCH /api/records/[id]` : une ligne par champ réellement modifié, `before` et `after` en JSON, `actorId` en SetNull. Le diff est calculé avant l'update par `diffRecordRevisions`, logique pure ; une valeur réémise à l'identique n'écrit rien (`tests/unit/recordRevisions.test.ts`, `tests/api/record-revisions.test.ts`).
- `field` vaut `title`, `content`, un `DatabaseProperty.id`, un `RecordSection.id`, ou `sectionsBody` pour le passage en corps libre. `icon`, `position`, `templateId` et `sprintId` ne sont pas tracés.
- Coalescence, pour absorber l'autosave BlockNote (un PATCH à chaque pause de frappe) : même acteur et même champ dans `REVISION_COALESCE_MS` (2 min), `shouldCoalesceRevision` fusionne dans la dernière ligne, qui garde son `before` d'origine et reçoit le nouvel `after` et un `createdAt` rafraîchi (`tests/api/record-revisions.test.ts`, AC3 et AC4). Un aller-retour dans la fenêtre ne laisse donc aucune trace de l'état intermédiaire.
- Rétention indéfinie, aucune purge. Seuls les records sont versionnés, pas les pages (ADR 0013).
- `GET /api/records/[id]/revisions` : tout membre qui voit la carte, du plus récent au plus ancien, acteur réduit à `{ id, displayName }`, sans borne ni pagination.
- Onglet Historique : un champ de corps n'a pas d'aperçu lisible et s'affiche « Contenu mis à jour ». `fieldLabel()` retombe sur « Section » et `isBodyField()` rend `true` pour tout `field` inconnu (`RecordPanel.tsx`) : tout nouveau champ tracé fait évoluer ces deux fonctions, sinon sa ligne s'affiche, fausse (« Section » comme champ modifié, puis « Contenu mis à jour »). C'est le cas de la trace des pièces jointes, à venir (fiche Discovery « Glisser-déposer et trace dans l'Historique des pièces jointes »).

## Templates et corps sectionné

- Un `Template` (par espace) définit `columns`, `kanbanGroupProperty` et `sections` (`[{ id, label }]`, libellés fixes) ; le corps sectionné est un opt-in (ADR 0004). Les templates fournis vivent en code dans `lib/templates.ts` (`builtin-scrum`, `builtin-ticket`, `builtin-bug`) et sont en lecture seule : `PATCH` et `DELETE /api/templates/[id]` les refusent (400, non testé). Créer ou modifier un template demande le rôle éditeur, le supprimer le rôle admin (`tests/api/role-gates.test.ts`).
- `POST /api/databases { templateId }` (template fourni, ou template de l'espace de la page, sinon 400) crée dans une transaction la propriété `title`, la vue table, les colonnes du template et la vue kanban groupée sur `kanbanGroupProperty` (cas scrum : doctrine `sprints-backlog`), et estampe `Database.templateId` et `Database.recordSections`. Il n'écrit jamais `recordTemplate`. Non testé.
- `recordSections` est un estampage : modifier le template ensuite ne change ni les databases déjà créées ni leurs cartes.
- Corps initial d'une carte, point unique pour le web et le MCP (`POST /api/databases/[id]/records`) : sans `content` fourni, une database à `recordSections` reçoit un corps sectionné vide (`emptySectionsBody`) et son `templateId` ; sinon `recordTemplate`, s'il existe, préremplit le corps libre. Un `content` explicite donne toujours un corps libre, et `sectionsBody` n'est pas accepté à la création. Non testé.
- `recordTemplate` : document BlockNote servant de modèle au corps libre, posé par `PATCH /api/databases/[id]` (éditeur) ou `notes_set_record_template`. Il ne s'applique qu'aux cartes créées ensuite.
- Une carte sectionnée se rend depuis son `sectionsBody` (`[{ id, label, content }]`, lu et écrit par `parseSectionsBody` et `serializeSectionsBody`), jamais depuis `recordTemplate` : un éditeur BlockNote par section, libellés rendus hors éditeur et non modifiables. Sans template, la carte garde son corps libre `content`.
- Le menu « modèle » du RecordPanel change le template d'une seule carte, indépendamment du kanban. Il fait correspondre les sections par id (contenu repris) et recolle à la fin les anciennes sections non vides absentes du nouveau template.
- Repasser en corps libre (`sectionsBody: null`) ne recopie pas les sections dans `content` : l'écran réaffiche l'ancien `content`, figé depuis le sectionnement, et le texte des sections ne subsiste que dans la révision `sectionsBody`. Relire les sections avant ce geste. Non testé.
- `PATCH /api/templates/[id]` remplace `sections` en entier et génère un id pour toute section qui n'en porte pas : repasser les ids existants, sinon le menu « modèle » ne retrouve plus le contenu de ces sections. Côté MCP, `notes_update_template` a le même effet (doctrine `mcp`).
- Pour modifier une section sans réémettre les autres, `notes_update_record` avec `sections_body` met à jour par libellé (doctrine `mcp`) ; l'API, elle, remplace tout le corps.

## Commentaires (`RecordComment`)

- Un fil par carte : `GET` et `POST /api/records/[id]/comments`, onglet « Commentaires » du RecordPanel. Il sert à poser une remarque sans toucher au corps, qui s'écrit en remplacement total.
- Append-only : aucune route de modification ni de suppression, ni `updatedAt` ni `deletedAt`, ni dans l'API, ni à l'écran, ni au MCP (`tests/api/comments.test.ts` : seuls `GET` et `POST` sont exportés, le modèle n'a ni `updatedAt` ni `deletedAt` ; `e2e/record-comments.spec.ts`). `createdAt` est la date de publication, jamais rafraîchie, à l'inverse de celui d'une révision (ADR 0041).
- Publier demande le rôle éditeur ; le lecteur lit le fil mais n'y écrit pas (403) (`tests/api/comments.test.ts`).
- Corps en texte brut, rogné, de 1 à `MAX_BODY` (4000) caractères, sinon 400 ; les retours à la ligne sont conservés (`tests/api/comments.test.ts`). Pas de BlockNote : un corps de blocs n'a pas d'aperçu lisible, et le pont MCP écrit ce champ (ADR 0041).
- `recordId` en Cascade : la carte emporte son fil. `authorId` en SetNull : l'API rend `author: null` et l'écran affiche « Quelqu'un » (`tests/api/comments.test.ts`).
- Le GET rend le `displayName` de l'auteur, jamais son email (`tests/api/comments.test.ts`).
- Le GET est borné à `TAKE` (200) messages, les plus récents d'abord, sans pagination : au-delà, les plus anciens restent en base mais ne sont servis ni à l'écran, ni à l'API, ni au MCP, et rien ne le signale : le fil a l'air de commencer là. À reprendre si un fil approche ce volume. Non testé.
- Publier n'écrit aucune notification (`tests/api/comments.test.ts` ; motif : doctrine `notifications`, ADR 0041).
- À l'écran, la publication insère la ligne rendue par le serveur (`mutate((prev = []) => [cree, ...prev], { revalidate: false })`), pas un `mutate()` nu, que SWR dédupliquerait sur deux publications rapprochées. Le fil étant append-only, la réponse fait foi : rien à réconcilier. Non testé en rafale.
- Pas de compteur sur l'étiquette de l'onglet : il obligerait à charger le fil à chaque ouverture de carte.
- Outils MCP `notes_list_record_comments` et `notes_add_record_comment` : doctrine `mcp`.

## RecordPanel

- Onglets : Contenu, par défaut (propriétés, corps libre ou sectionné, puis pièces jointes sous le corps) ; Commentaires ; Historique (`e2e/record-history.spec.ts`).
- Contenu reste monté, masqué, hors de son onglet, pour préserver l'instance BlockNote et son autosave en attente. Commentaires et Historique se montent à la demande, ce qui rend leur fetch paresseux.
- Toutes les vues montent le panneau avec `key={selectedRecord.id}` : rouvrir une carte est un montage neuf, qui resème les éditeurs depuis le cache SWR (voir Autosave).
- `Cell` : édition inline par type, partagée par les vues et le panneau. `BulkActionBar` : sélection multiple, un PATCH optimiste indépendant par carte, avec rollback ciblé ; le serveur ne sait pas qu'ils viennent d'un seul geste.
- Échap dans un champ ou dans l'éditeur ne ferme pas le panneau ; hors champ, il flushe les saisies puis ferme (`e2e/autosave.spec.ts`).
- Les éditeurs BlockNote du panneau capturent déjà le dépôt d'un fichier pour insérer une image dans le corps. Le futur dépôt d'une pièce jointe s'arbitre par la zone visée, jamais par le type de fichier (fiche Discovery « Glisser-déposer et trace dans l'Historique des pièces jointes »).

## Autosave

- Ne pas toucher à cette logique sans raison. Les savers sont des `createDebouncedSaver` (le dernier payload gagne, `flush()` envoie ce qui attend ; `tests/unit/debouncedSaver.test.ts`), et leurs `fetch` portent `keepalive: true`.
- Page (`Editor.tsx`) : 600 ms ; titre, icône et contenu fusionnés dans un brouillon puis envoyés en un seul PATCH ; flush au démontage (`e2e/autosave.spec.ts`).
- Carte (`RecordPanel.tsx`) : 500 ms pour `content`, 600 ms pour `sectionsBody` ; flush à la fermeture, au démontage et sur `pagehide`. Le titre (au blur) et les propriétés (au commit) partent sans debounce.
- Toute écriture d'une carte réconcilie le cache SWR, corps compris : `useCreateBlockNote({ initialContent })` ne lit sa graine qu'une fois et `sections` naît d'un `useState`, donc le panneau resème ses éditeurs depuis le cache à chaque montage (`e2e/autosave.spec.ts:77` ; ADR 0045).
- La réconciliation du corps est locale : après un `res.ok`, `globalMutate(key, updater, { revalidate: false })` écrit dans le cache ce que le serveur vient d'accepter, `sectionsBody` sous sa forme sérialisée. Pas de refetch : la clé records rend tous les records, corps compris, et la relire à chaque frappe ralentirait le Pi. Un échec ne touche pas au cache, sinon la réouverture servirait une sauvegarde qui n'a pas eu lieu.
- `saveTitle` et `saveProperty` écrivent dans le cache avant le fetch, puis revalident la clé en cas de succès.
- Diagnostic : si l'utilisateur dit « ça ne s'enregistre pas » et qu'un rechargement rend le texte, le fautif est le cache, pas la sauvegarde ; « fiabiliser l'autosave » passerait à côté.
- Un éditeur périmé détruit : la frappe suivante renvoie le document périmé en remplacement total, sur une carte sectionnée toutes les sections d'un coup, « 🗣️ Notes de Gautier » comprise, et la coalescence de 2 min fusionne l'aller et le retour dans la même révision. Le texte perdu n'existe alors plus nulle part.
- `pagehide` flushe les saisies en attente de la carte : fermer l'onglet ou recharger ne démonte pas React, et `keepalive: true` rend l'envoi de dernière seconde délivrable. `pagehide` plutôt que `beforeunload`, qui ne se déclenche pas sur mobile. Non testé.
- Le panneau affiche l'état du corps (`data-save-state` : « Enregistrement… », « Enregistré ✓ », « Non enregistré » puis « recharge la page », séparés par un tiret cadratin dans le texte affiché par `RecordPanel.tsx`). L'échec est rouge et persistant, il ne retombe pas sur l'état neutre : sans cet affichage, rien ne contredit l'utilisateur quand une écriture échoue. Cet état ne couvre ni le titre ni les propriétés. Garde : `e2e/autosave.spec.ts:77` pour le succès ; l'échec n'est pas testé.
- Exception connue : `Editor.tsx` (pages) ne teste pas `res.ok`, affiche « Enregistré ✓ » même sur un 403 ou un 500, et n'a pas de flush sur `pagehide`, donc une saisie de moins de 600 ms est perdue à la fermeture de l'onglet (fiche Discovery « Autosave des pages : état d'échec visible et flush sur pagehide »).
- Un test d'autosave rouvre la carte sans recharger, parce que `page.goto()` vide le cache SWR et rend le test aveugle au défaut ; il se vérifie rouge sur le code d'avant (`e2e/autosave.spec.ts:77`, qui ne couvre que le corps libre ; ADR 0045).
