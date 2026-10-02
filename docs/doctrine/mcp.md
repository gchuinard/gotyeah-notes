# Doctrine : Pont MCP

Périmètre : le pont de confiance côté notes (`src/lib/session.ts`, `src/proxy.ts`), l'incarnation du compte « IA », les outils `notes_*` du dépôt `gotyeah-mcp` (surface, sémantiques, descriptions), leur activation et leur déploiement.
Invariants courts : `.claude/rules/mcp.md` · Décisions datées : `docs/adr/`

## Où vit le code

- Les outils `notes_*` vivent dans le dépôt `gotyeah-mcp` : `mcp_remote/notes_tools.py` (logique et appels HTTP à l'API notes), `mcp_remote/remote.py` (déclaration des outils et de leurs descriptions), `mcp_remote/notes_entities.py` (table de surface). Ne jamais toucher `gotyeah_sonar` pour un outil `notes_*` : le code en a été retiré (ADR 0002).
- Les outils sont greffés sur le hub MCP, qui porte aussi `sonar_*` et `monitor_*`, et non sur un serveur séparé : le hub authentifie déjà la personne par l'OAuth fédéré à Keycloak, et notes ne l'authentifie pas une seconde fois, il fait confiance au hub par le pont (ADR 0002).
- Côté notes, le pont tient dans deux fichiers : `src/proxy.ts` laisse passer, `src/lib/session.ts` valide.

## Pont de confiance (`lib/session.ts`)

- `getSession()` lit d'abord le cookie : un cookie valide l'emporte. Sans cookie valide, `getServiceUser()` accepte deux en-têtes, `X-MCP-Secret` et `X-Act-As-Email`.
- Le secret est comparé en temps constant (`timingSafeEqual`) à `MCP_SHARED_SECRET`. Vide, le pont est coupé et n'ajoute aucune surface.
- L'email passe par `normalizeEmail`, puis doit désigner un User existant : le pont ne crée jamais de compte. Email inconnu → `console.warn("[mcp-act-as] email inconnu …")`, `null`, donc 401.
- `MCP_ACT_AS_ALLOWLIST` : emails séparés par des virgules, rognés et mis en minuscules. Hors liste → `console.warn("[mcp-act-as] refusé (hors allowlist) …")`, `null`, 401. Vide, tout User existant est incarnable : la garde n'agit que renseignée, et sa valeur se lit dans le conteneur (`docker exec gotyeah_notes printenv MCP_ACT_AS_ALLOWLIST`), jamais dans un fichier du dépôt (ADR 0025).
- Toute nouvelle incarnation s'ajoute à l'allowlist au moment où on la crée : sinon le pont répond 401 et le MCP ne dit pas pourquoi. Cela vaut pour `NOTES_ACT_AS_EMAIL` comme pour l'email de la personne, sans lequel `yours` vaut `null` (voir « Mes espaces »).
- Chaque incarnation réussie est journalisée : `console.info("[mcp-act-as] <email> → user <id>")`.
- Une incarnation n'a pas de `Session` : son espace courant est sa membership la plus ancienne (`firstWorkspaceId`). C'est pourquoi un script ne pose jamais de date par `CURRENT_TIMESTAMP` (doctrine `deploiement`).
- Garde : seul le passage par le proxy est testé (`tests/api/api-hardening.test.ts`, « POST pont MCP … laissé passer »). `getServiceUser()` n'est couvert par aucun test : les tests de route mockent `getSession`, et `vitest.config.ts` vide `MCP_SHARED_SECRET`.

## Passage par le proxy (`src/proxy.ts`)

- Sans cookie, une requête vers `/api/*` qui porte les deux en-têtes est laissée passer ; hors `/api/*`, elle est redirigée vers `/login`. Le proxy ne teste que leur présence : la validation reste dans `lib/session.ts`. Toute future auth par en-têtes suit ce partage (doctrine `api`).
- Anti-CSRF : une mutation qui porte les deux en-têtes est dispensée du contrôle d'`Origin`. La dispense tient à leur présence, pas à leur validité : elle suppose qu'un navigateur ne peut pas poser ces en-têtes en cross-site, faute de préflight CORS accordé (l'app ne sert aucun `Access-Control-*`). N'ajouter aucun en-tête CORS qui autorise `x-mcp-secret` ou `x-act-as-email`. Non testé.
- Les gates de rôle vivent dans les handlers, pas dans le proxy, que le pont traverse sans cookie (ADR 0017).
- Le pont passe par `getSession()` comme un humain : une garde ne repose jamais sur l'absence d'écran. Exemple : `PATCH /api/me` refuse un compte de service en 409 (doctrine `auth-invitations`).

## Incarnation du compte « IA »

- `NOTES_ACT_AS_EMAIL=ia@gotyeah.local`, dans le `.env` de `gotyeah-mcp`, remplace l'email du porteur du jeton claude.ai pour tous les outils `notes_*` (`act_as_override()`) : les écritures de l'agent sont attribuées à « IA » dans l'Historique. Vide, le pont incarne le porteur, dont l'email doit être vérifié par l'IdP (`resolve_email` ; ADR 0019). Gardes : `gotyeah-mcp/tests/test_notes_tools.py` (`test_act_as_override_reads_env`), `gotyeah-mcp/tests/test_notes_flows.py` (`test_resolve_email_unverified_claims_returns_none`).
- `ia@gotyeah.local` est un compte de service (`User.isService`), créé par `scripts/create-service-account.mjs`, jamais par une route (doctrine `roles-permissions`). Il doit figurer dans `MCP_ACT_AS_ALLOWLIST`.
- Il est rattaché d'office, en admin, à tout espace créé par `POST /api/workspaces`, jamais au « Mon espace » d'une inscription (ADR 0034). Admin, parce que les outils de suppression sont gatés admin (doctrine `roles-permissions`).
- Il voit les pages privées des espaces où il est membre : l'agent lit plus large que la personne qui lui parle.
- Le filtre `@me` résolu par le serveur désigne l'appelant, donc le compte incarné, pas la personne (doctrine `vues`).
- Il ne reçoit aucune notification (`notify()` écarte les comptes de service), et aucun outil n'expose la cloche (doctrine `notifications`).
- Un espace créé par `notes_create_workspace` a pour seul admin le compte incarné (et les autres comptes de service) : aucun humain n'en est membre (`yours: false`), et aucun écran n'y remédie, car le compte de service ne se connecte pas à l'interface (le script lui pose un mot de passe inutilisable, le lien email lui est refusé) et l'invitation n'est pas exposée au MCP. Un espace destiné à une personne se crée depuis l'interface : elle en devient admin, et le compte de service y est rattaché d'office. Garde côté notes : `tests/api/service-account-autojoin.test.ts` (« un compte de service qui crée un espace ne se rattache pas deux fois » : 200, une seule membership, admin). L'absence d'accès humain : non testé.
- Une page que le pont crée dans une section privée est privée au compte incarné, donc invisible des humains (doctrine `modele`).

## « Mes espaces » : le champ `yours`

- `notes_list_workspaces` rend les espaces du compte incarné, pas ceux de la personne. Chaque espace porte `yours`, vrai quand le porteur du jeton IdP en est membre. Il n'est pas déduit : le MCP refait un `GET /api/workspaces` en incarnant la personne, et la réponse de l'API tranche. Sans incarnation fixe, ce second appel est sauté et `yours` vaut `true` partout.
- « Mes espaces » = `yours: true` seulement. N'écrire dans un espace `yours: false` que si la personne l'a nommé. `yours: null` veut dire « inconnu » (porteur absent, second appel en échec, email du porteur hors `MCP_ACT_AS_ALLOWLIST`) : demander, ne jamais supposer. Garde : `gotyeah-mcp/tests/test_notes_flows.py` (`test_yours_*`).
- La portée vient de l'identité d'appel (invariant 8 du CLAUDE.md) : aucune route ne prend `?userId=`, et il ne faut pas en ajouter pour ce besoin, sous peine d'ouvrir la lecture de l'appartenance des autres.

## Surface des outils `notes_*`

- `notes_entities.py` fait foi : pour chaque entité, six verbes (`list`, `get`, `create`, `update`, `delete`, `restore`), chacun servi par un outil ou déclaré `Gap` avec sa raison. Un outil enregistré mais non déclaré, ou déclaré mais absent du serveur, fait échouer `gotyeah-mcp/tests/test_notes_entities.py` ; `test_deliberate_gaps_are_documented_where_it_matters` y fige les trous voulus (`workspace.delete`, `trash.delete`, `attachment.create`).
- Le total est figé par `gotyeah-mcp/tests/test_remote_boot.py`. Pour compter : `grep -oE "def (notes_[a-z_]+)" mcp_remote/remote.py | sort -u | wc -l`. La doctrine ne tient aucun sous-total par entité.
- Les groupes ci-dessous disent la sémantique ; en cas d'écart sur les noms, la table fait foi.

### Espaces et membres

- `notes_list_workspaces`, `notes_get_workspace` (l'espace et ses sections), `notes_create_workspace`, qui renvoie l'espace avec ses sections par défaut pour enchaîner sans relister. Garde : `gotyeah-mcp/tests/test_notes_sidebar_flows.py` (`test_create_workspace_returns_its_default_sections`).
- Pas d'outil de suppression d'espace, et il n'y en aura pas : `DELETE /api/workspaces/[id]` cascade sans garde de vacuité, la suppression se fait dans l'interface web (ADR 0016).
- Renommer un espace n'existe nulle part : `/api/workspaces/[id]` n'exporte que `DELETE`.
- `notes_list_members` rend `userId`, `displayName` et `role`, jamais l'email (invariant 13 du CLAUDE.md). L'email reste lu en interne pour résoudre un assigné. Non testé côté MCP.

### Pages, sections, corbeille

- Pages : `notes_list_pages`, `notes_get_page`, `notes_create_page`, `notes_update_page`, `notes_move_page`, `notes_delete_page`, `notes_search`. Sections : `notes_list_sections`, `notes_create_section`, `notes_update_section`, `notes_delete_section`.
- `notes_move_page` ne change que le rattachement, sans recopie du contenu : `parent_id` en fait une sous-page, `section_id` une racine de section (`parentId: null`). Les deux sont exclusifs ; les deux ou aucun sont refusés avant tout appel HTTP. Garde : `gotyeah-mcp/tests/test_notes_flows.py` (`test_move_page_*`).
- `notes_delete_section` ne supprime aucune page : notes réaffecte les racines à une section du même type. La réponse décrit la réaffectation (combien de pages, vers quelle section) observée en relisant les pages après coup, jamais recalculée dans l'adaptateur, qui ne porte pas de règle métier : une règle de repli recopiée mentirait le jour où notes la change. Le 409 « dernière section de ce type » devient une consigne. Garde : `gotyeah-mcp/tests/test_notes_sidebar_flows.py` (`test_delete_section_*`).
- Corbeille : `notes_list_trash`, `notes_restore_page` (avec le sous-arbre), `notes_restore_record` (refusé tant que la page hôte est en corbeille ; le message dit de la restaurer d'abord). Sans ces outils, un agent tenait ses suppressions pour définitives. `notes_list_trash` ne rend que les racines supprimées et les cartes supprimées sous une page vivante : une sous-page partie avec son parent n'y figure pas (elle revient avec lui), ni une carte dont la page hôte est en corbeille (restaurer la page, puis la carte si elle avait été supprimée à part). Lister la corbeille purge au passage ce qui y dort depuis plus de `TRASH_PURGE_DAYS` (30 j). Garde : `gotyeah-mcp/tests/test_notes_sidebar_flows.py` (`test_restore_record_409_names_the_fix`).

### Databases, propriétés, records, vues

- Outils : `notes_get_database`, `notes_create_database`, `notes_delete_database`, `notes_set_patch_notes_page`, `notes_create_property`, `notes_update_property`, `notes_add_select_option`, `notes_update_select_option`, `notes_remove_select_option`, `notes_delete_property`, `notes_list_records`, `notes_get_record`, `notes_create_record`, `notes_duplicate_record`, `notes_update_record`, `notes_delete_record`, `notes_list_record_revisions`, `notes_create_view`, `notes_update_view`, `notes_delete_view`.
- Une database est une page : aucun outil ne liste les databases, `notes_get_page` rend `database: {id}`.
- Les records se manipulent par nom de propriété et par nom d'option, traduits en ids via le schéma (`notes_get_database`) ; un nom inconnu échoue en listant les noms valides. Les `properties` sont fusionnées, `null` efface la cellule. Garde : `gotyeah-mcp/tests/test_notes_tools.py` (`test_resolve_unknown_property_raises_with_valid_names`).
- Un assigné (propriété `user`) s'écrit par `userId`, email ou `displayName`, résolus dans cet ordre sur les membres de l'espace de la database. Cette liste n'est chargée que si un assigné est visé. Gardes : `gotyeah-mcp/tests/test_notes_flows.py` (`test_update_record_resolves_assignee_by_name`, `test_update_record_without_assignee_never_fetches_members`).
- `notes_update_property` ne fait que renommer ou réordonner. Options select : `notes_add_select_option` est idempotent (même nom, casse ignorée), `notes_update_select_option` garde l'id de l'option, donc aucune carte n'est réécrite, `notes_remove_select_option` est refusé par le serveur tant que l'option est référencée, et le 400 est traduit en consigne. Changer le type d'une propriété est refusé (400), c'est voulu (doctrine `records`). Gardes : `gotyeah-mcp/tests/test_notes_tools.py` (`test_build_select_option_idempotent_case_insensitive`, `test_edit_option_renames_without_touching_the_id`), `gotyeah-mcp/tests/test_notes_sidebar_flows.py` (`test_remove_select_option_referenced_explains_what_to_do`).
- `notes_list_records` appelle la route nue : il reçoit tous les records, corps compris. Les params `filter`, `limit`, `offset` et `includeContent` de `GET /api/databases/[id]/records` (doctrine `api`) restent inutilisés (ADR 0009).
- `notes_update_view` transmet `config` tel quel, en remplacement total : relire la vue (`notes_get_database`) et renvoyer le config complet (doctrine `vues`).
- `notes_set_patch_notes_page` est le seul chemin pour poser `Database.patchNotesPageId`, qu'aucun écran n'écrit (doctrine `sprints-backlog`).

### Corps d'une carte

- `content` (corps libre) s'écrit en remplacement total, MCP compris : relire et tout réémettre. Il n'est jamais envoyé s'il n'est pas fourni.
- `sections_body` de `notes_update_record` fait une mise à jour partielle par libellé : les sections non citées gardent leur contenu et leur id, celles du modèle qui manquent sont ajoutées vides, un `content` omis laisse la section intacte et `"content": []` la vide. C'est la porte à prendre sur une carte sectionnée, sans jamais citer « 🗣️ Notes de Gautier ». Garde : `gotyeah-mcp/tests/test_notes_flows.py` (`test_update_record_partial_section_update_preserves_the_others`).
- `template_id` seul applique le squelette du modèle en reprenant le contenu par id ; `remove_template=true` rend le corps libre d'origine, masqué et non effacé. Un modèle inconnu échoue avant l'écriture, sans carte orpheline. Gardes : `gotyeah-mcp/tests/test_notes_flows.py` (`test_update_record_template_alone_keeps_existing_content_by_id`, `test_update_record_unknown_template_fails_before_the_patch`, `test_create_record_unknown_template_creates_no_orphan_record`).

### Modèles

- Outils : `notes_list_templates`, `notes_create_template`, `notes_update_template`, `notes_delete_template`, `notes_create_database_from_template` (depuis n'importe quel modèle, fourni ou de l'espace), `notes_create_ticket_database` et `notes_create_bug_database` (raccourcis des modèles fournis), `notes_set_record_template` (corps libre pré-rempli des nouvelles cartes d'une database, sans effet sur les existantes).
- Les modèles fournis (`builtin-*`) sont en lecture seule : modification et suppression sont refusées avant l'appel HTTP. Gardes : `gotyeah-mcp/tests/test_notes_flows.py` (`test_update_template_builtin_refused_before_any_http_call`, `test_delete_template_builtin_refused_before_any_http_call`).
- `notes_update_template` remplace `sections` en entier, et le serveur donne un id neuf à toute section qui n'en porte pas : repasser les ids existants (lus par `notes_list_templates`), sinon les cartes déjà sectionnées se décrochent (doctrine `records`). Libellés et ids en doublon sont refusés avant l'appel (`gotyeah-mcp/tests/test_notes_tools.py`, `test_normalize_template_sections_rejects_duplicate_*`). La régénération côté serveur : non testée.

### Sprints

- Outils : `notes_list_sprints`, `notes_create_sprint`, `notes_update_sprint`, `notes_delete_sprint`. Affecter une carte : paramètre `sprint` de `notes_create_record` / `notes_update_record`, par nom ou `"backlog"` ; un nom sans database échoue (`gotyeah-mcp/tests/test_notes_tools.py`, `test_resolve_sprint_id_named_without_database_raises`).
- `notes_update_sprint` : `state: "active"` démarre (409 si un autre sprint est actif) ; `state: "completed"` avec `database_id` renvoie les cartes non terminées au backlog si la vue backlog câble le statut et l'option « terminé », sinon clôt sans renvoi et ajoute un `mcpWarning` ; sans `database_id`, ni renvoi ni avertissement (doctrine `sprints-backlog`). Gardes : `gotyeah-mcp/tests/test_notes_flows.py` (`test_update_sprint_completed_*`).
- `notes_delete_sprint` renvoie ses cartes au backlog ; le sprint et ses notes de version sont perdus (le bloc déjà ajouté à la page « Patch notes » reste).

### Commentaires

- `notes_list_record_comments` est la seule façon, pour la session suivante, de voir une remarque : `notes_get_record` ne rend pas les commentaires. Le fil est borné comme à l'écran (doctrine `records`).
- `notes_add_record_comment` pose une note sans toucher au corps, qui s'écrit en remplacement total. Le fil est append-only : modification et suppression sont des `Gap`, faute de route côté notes (ADR 0041). Un corps vide ou de plus de 4000 caractères est refusé avant l'appel HTTP ; ce littéral de `notes_tools.py` doit rester égal à `MAX_BODY` de `src/app/api/records/[id]/comments/route.ts`. Gardes : `gotyeah-mcp/tests/test_notes_flows.py` (`test_add_record_comment_refuse_*`).

## Réversibilité dans les descriptions

- Seules `Page` et `Record` ont un `trashedAt` : `notes_delete_page` (avec son sous-arbre et les cartes d'une database hôte) et `notes_delete_record` mettent à la corbeille, restaurable `TRASH_PURGE_DAYS` (30 j). Tout le reste est définitif : database (cartes comprises ; pour un retrait réversible, mettre la page hôte à la corbeille), propriété (valeurs effacées), option, vue, sprint, section, modèle.
- Toute description d'outil de suppression dit où va l'objet et comment le récupérer, ou qu'il n'y a pas de retour. Un mensonge de description est pire qu'un outil manquant : le trou se voit, pas le mensonge. Le verbe `restore` de `notes_entities.py` oblige à trancher entité par entité ; le texte des descriptions, lui, n'est pas testé.

## Ce que le MCP ne couvre pas

- Ne jamais conclure « la fonctionnalité n'existe pas » faute d'outil : lire d'abord `notes_entities.py`, qui dit ce qui manque exprès, puis les routes (`find src/app/api -name route.ts`).
- Sans outil :
  - upload d'images (`POST /api/upload`, `GET /api/files/[name]`) : préalable bloquant, aucune route ne supprime un fichier téléversé, donc pas d'upload exposé avant qu'une telle route existe ;
  - pièces jointes (`/api/records/[id]/attachments`, `/api/attachments/[id]`) ;
  - purge définitive de la corbeille (`?permanent=1`), hors MCP exprès ;
  - config d'instance (`/api/config`) ;
  - suppression d'espace (exprès, ADR 0016) et renommage (n'existe nulle part) ;
  - membres et invitations : inviter, changer un rôle et retirer sont les `Gap` voulus de l'entité `member` (actes d'administration, et le pont incarne un compte de service qui n'a pas à élargir l'accès d'un espace) ; lister ou révoquer une invitation n'a pas d'entité dans la table ;
  - notifications (`/api/notifications`) ;
  - comptes SSO (`/api/workspaces/[id]/idp`, `/api/workspaces/[id]/members/[userId]/idp`) ;
  - profil (`PATCH /api/me`, qui refuse de toute façon un compte de service) ;
  - préférences de session (`/api/pages/recent`, `/api/pages/[id]/visit`, `/api/workspaces/[id]/switch`), connexion (`/api/auth/*`) et réponse à une invitation (`/api/invitations/[id]`, `/api/invitations/claim`) : sans objet pour un agent.
- Écarts connus de `notes_entities.py`, à corriger dans `gotyeah-mcp` : le `Gap` `member.create` exige un « compte préexistant », alors que `POST /api/workspaces/[id]/members` invite toute adresse et n'ajoute jamais directement (doctrine `auth-invitations`) ; sa raison de fond reste vraie. L'entité `attachment` décrit les images de `/api/upload` et affirme qu'aucune route ne liste de fichiers, alors que les pièces jointes ont leur liste (`GET /api/records/[id]/attachments`) et leur retrait (`DELETE /api/attachments/[id]`, qui détache la ligne sans supprimer le fichier).

## Activation et déploiement

- Activation sur le Pi : le même secret des deux côtés, `MCP_SHARED_SECRET` dans notes et `NOTES_MCP_SECRET` dans `gotyeah-mcp`, plus `NOTES_API_BASE_URL=http://gotyeah_notes:3000` côté MCP ; les deux conteneurs partagent le réseau `nginx-proxy-manager_default`. Puis `docker compose up -d` et rafraîchir le connecteur claude.ai. Sans ces deux variables, le hub n'expose aucun outil `notes_*` (`enabled()`).
- `MCP_SHARED_SECRET` et `MCP_ACT_AS_ALLOWLIST` figurent dans le bloc `environment:` de `docker-compose.yml`, sans quoi elles n'atteindraient pas le conteneur (invariant 16 du CLAUDE.md).
- Après un ajout d'outil, l'ordre est : push sur `main` de `gotyeah-mcp` (son `deploy.yml` lance les tests, puis rsync et `docker compose up -d --build`), conteneur redéployé, puis rafraîchissement du connecteur claude.ai. Sans ce dernier temps, un outil présent en production n'est pas proposé par le client, et on le croit à tort non déployé.
- Ce qui fait foi est le code dans le conteneur : `docker exec gotyeah_mcp sh -lc 'grep -oE "def (notes_[a-z_]+)" /app/mcp_remote/remote.py | sort -u | wc -l'`. Ni le dépôt du Pi, ni la liste d'outils du client, qui reflète le cache de claude.ai.
- Jamais le HEAD git du Pi pour `gotyeah-mcp` : rsync exclut `.git`, et le `.git` de `/home/pi/sites/gotyeah-mcp` est le reliquat d'un ancien clone, dont le HEAD n'avance pas et dont `git status` montre des fichiers « modifiés » en permanence (ADR 0046). Pour notes, déployé par `git reset --hard` sur le commit testé, le HEAD du Pi est fiable : vérifier au bon endroit selon le mode de déploiement du dépôt (doctrine `deploiement`).
