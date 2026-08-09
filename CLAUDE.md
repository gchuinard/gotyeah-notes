# CLAUDE.md

Ce fichier cadre le travail de Claude Code sur ce projet. Lis-le avant toute modification.

## Contexte projet

**gotyeah-notes** est un clone de Notion self-hosted. Multi-workspace, multi-membres avec rôles, pages organisées en arborescence, databases avec vues multiples (table, kanban, calendar, gallery, backlog), drag-and-drop, éditeur de blocs BlockNote.

## Stack

- **Next.js 16** (App Router, Server Components par défaut)
- **React 19**
- **TypeScript** strict
- **Tailwind CSS v4** pour le style
- **Prisma 7 + SQLite** (fichier local, provider "prisma-client", output `../generated/prisma`)
- **BlockNote** (`@blocknote/react` + `@blocknote/mantine`) pour l'éditeur de blocs
- **dnd-kit** pour le drag & drop (sidebar, table rows, kanban cards)
- **SWR** pour le fetch côté client
- **lucide-react** pour les icônes
- **zod** pour la validation des bodies API

Pas d'autres libs sans raison forte. Avant d'ajouter une dépendance, demande-toi si on peut faire sans.

## Modèle de données (18 modèles)

```
User            → email @unique, firstName/lastName/displayName, passwordHash.
                  displayName = le seul nom affiché (header, sidebar, acteur des révisions).
                  isService = compte de SERVICE (pont MCP « IA ») : voit les pages PRIVÉES
                  des espaces où il est MEMBRE (sinon 404 partout, l'automatisation est
                  muette). Aucune route ne l'expose en écriture — création par
                  scripts/create-service-account.mjs uniquement.
                  Rattaché D'OFFICE (admin) aux espaces créés par POST /api/workspaces,
                  jamais au « Mon espace » d'une inscription — cf. « Rattachement d'office ».
Session         → id = sha256(token) (le token ne vit qu'en cookie), currentWorkspaceId
                  pour le workspace actif, @@index([expiresAt]) pour la purge des expirées
Workspace       → conteneur partageable, l'autorité c'est Membership
Membership      → (userId, workspaceId, role: admin|editor|viewer), unique sur (userId, workspaceId).
                  Rôles APPLIQUÉS par toutes les routes (hasRole) — cf. « Rôles » ci-dessous.
WorkspaceInvitation → PRÉ-AUTORISATION d'un email qui n'a pas encore de compte :
                  (email normalisé, workspaceId, role, invitedBy), unique (workspaceId, email).
                  Devient une Membership TOUTE SEULE à la première connexion, puis la ligne
                  est SUPPRIMÉE (la Membership est la trace, pas de claimedAt) — de même
                  quand l'ajout d'un membre porte sur une adresse déjà invitée.
                  Un email PART (lib/mailer.ts, Brevo) si BREVO_API_KEY est posée ;
                  sans clé, l'invitation est créée quand même et l'écran le dit.
                  Périmée après INVITATION_TTL_DAYS (7 j), vérifié à l'usage.
Section         → conteneur dans la sidebar, type = "private"|"team", icon, appartient à un Workspace
Page            → arborescence (parentId), visibility dénormalisé depuis la section racine,
                  ownerId = créateur (autorité des pages privées), trashedAt = corbeille
PageVisit       → UPSERT sur unique (userId, pageId), pour la section "Récents"
Database        → liée 1-1 à une Page (pageId @unique). Une database EST une page.
                  templateId/recordSections = template source + squelette de sections estampé.
                  patchNotesPageId = page « Patch notes » (référence LIBRE, pas de relation Prisma).
DatabaseProperty → colonnes dynamiques (name, type, position, config JSON).
                  types : title|text|number|select|multiselect|date|checkbox|url|email|relation|user
Record          → lignes de la database (title, properties JSON indexé par property.id).
                  templateId/sectionsBody = corps SECTIONNÉ (sinon corps libre `content`).
                  sprintId = sprint d'affectation (vue backlog), null = backlog. onDelete SetNull.
                  createdBy (SetNull), coverUrl, trashedAt = corbeille.
RecordRevision  → piste d'audit d'un Record : une ligne par CHAMP changé (title | content |
                  sectionsBody | DatabaseProperty.id | RecordSection.id), actorId (SetNull),
                  before/after en JSON. Onglet « Historique » de la carte.
Sprint          → sprint d'une Database (vue backlog façon Jira). name, goal, startDate, endDate,
                  state (future|active|completed), position, releaseNotes (générées à la clôture).
                  Record.sprintId pointe dessus.
View            → type table|kanban|calendar|gallery|backlog, config JSON (filtres, tris, group-by,
                  columnWidths, createInUnassignedOnly ; backlog : pointsPropertyId/statusPropertyId/
                  epicPropertyId/doneStatusOptionId ; kanban scrum : sprintScope "active"|"all"|<sprintId>)
Template        → modèle réutilisable par workspace : columns + kanbanGroupProperty + sections [{id,label}]
                  (builtins : backlog? câble la vue Backlog du template scrum)
Notification    → cloche de l'en-tête. C'est un MESSAGE, JAMAIS une AUTORISATION : l'autorité
                  d'une invitation reste WorkspaceInvitation, celle d'un accès reste Membership.
                  Append-only comme RecordRevision (pas d'updatedAt) ; seul readAt bouge —
                  null = non lu, même grammaire que trashedAt. Types : workspace_invitation |
                  workspace_joined | role_changed | membership_removed | invitation_declined |
                  record_assigned.
                  ⚠️ Un type INCONNU dégrade en ligne générique, jamais ne plante (un retour
                  arrière du code laisse en base des lignes déjà écrites).
                  @@unique([userId, invitationId]) : ré-inviter fait un UPSERT sur la même ligne,
                  sinon chaque relance empilerait une carte « Accepter » de plus.
                  Purge 90 j, paresseuse, à l'OUVERTURE du panneau et scopée au destinataire —
                  JAMAIS sur le compteur, qui est le GET le plus chaud de l'app.
RecordAttachment → PIÈCE JOINTE d'une carte (document déposé dessus). Le FICHIER vit
                  sur disque (UPLOAD_DIR), la ligne n'en porte que la référence : `fileName`
                  (nom sur disque, `<uuid>.<ext>`) + `name` (nom d'origine, affiché et
                  restitué au téléchargement — POST /api/upload le jette).
                  recordId → Cascade, uploadedBy → SetNull.
                  ⚠️ Deux lignes peuvent citer le MÊME fileName : c'est ce qui rend la
                  duplication d'une carte gratuite. Le comptage de références est
                  purgeOrphanUploads, qui recalcule l'ensemble des noms cités à chaque
                  passage. ⚠️ AUCUN trashedAt — le retrait est DÉFINITIF (décision du
                  08/08) : la purge borne sur l'âge du FICHIER, pas sur la date de retrait,
                  donc un deletedAt supprimerait immédiatement tout document de plus de
                  30 j qu'on détache et ne protégerait que ceux qu'on vient de poser.
AppConfig       → réglages globaux de l'instance. Ligne UNIQUE id="app", uploadMaxMb.
                  Toujours via `lib/appConfig.ts` (upsert → jamais de ligne manquante).
```

### Conventions clés du modèle

- **Page.sectionId** : renseigné UNIQUEMENT sur les pages racines (parentId IS NULL). Pour les enfants, la section est héritée via la racine. Toujours passer par `lib/pages.ts > setPageSection()`.
- **Page.visibility** : dénormalisé depuis la section racine ("private" | "team"), synchronisé récursivement via `setPageSection()`.
- **Page.ownerId = autorité des pages privées** : une page `visibility="private"` n'est accessible QU'À son `ownerId`, même pour les autres membres du workspace. Règle centralisée dans `lib/workspace.ts > isPageAccessible(page, userId, isService?)` et appliquée **en cascade** par TOUS les `check*Access` — sinon un membre lirait la database posée sur la page privée d'un autre. **Exception UNIQUE : un compte de service (`User.isService`) voit les pages privées des espaces où il est membre** — jamais au-delà (la frontière d'espace tient, c'est testé). Pour les LISTES (arbre, recherche, corbeille), le pendant est `pageVisibilityFilter(userId, isService)` (`undefined` = aucune restriction, à étaler dans le `where`). Ne réimplémente jamais ces tests : un `visibility === "private"` réécrit à la main échapperait à l'exemption — le test `service-account.test.ts` fait échouer la CI s'il en réapparaît un hors du helper.
- **Rattachement d'office des comptes de service (08/08/2026)** — sans lui, le pont MCP était muet sur tout espace créé après le compte « IA » : `notes_list_workspaces` n'en rendait qu'un, et le reste répondait 404 sans dire pourquoi. `createWorkspaceWithDefaults(name, userId, { withServiceAccounts })` rattache donc tous les `User.isService` au nouvel espace.
  - ⚠️ **Opt-in à défaut FALSE, et ce défaut est load-bearing.** Des **quatre** appelants, **un seul** le demande : `POST /api/workspaces`, le geste explicite « créer un espace ». Les trois autres (`register`, callback OIDC, acceptation d'invitation) fabriquent le « **Mon espace** » PERSONNEL d'un compte qui vient de naître — or un compte de service voit les pages privées des espaces où il est membre. L'y rattacher ferait lire l'espace personnel de **toute personne qui s'inscrit**. Même règle que `claimInvitations({ grant })` : le défaut sûr est celui qui n'accorde rien. Un **méta-test** (`tests/api/service-account-autojoin.test.ts`) refuse tout second appelant — la garde n'est pas le défaut de l'argument, c'est le nombre d'appelants.
  - **Rôle `admin`**, pas `editor` : six outils MCP (`notes_delete_database|_property|_view|_sprint|_section|_template`) sont gatés admin. En éditeur, ils répondraient 403 dans les espaces neufs et marcheraient dans l'ancien.
  - ⚠️ **Le créateur peut LUI-MÊME être le compte de service** (`notes_create_workspace` existe) : sa membership est déjà posée, la réémettre violerait l'unique `(userId, workspaceId)` et ferait échouer la transaction, donc la création de l'espace. D'où le `id: { not: userId }`.
  - **Rattrapage de l'existant** : `scripts/backfill-service-memberships.mjs`, essai à blanc par défaut (`--execute` pour écrire). Il **chiffre ce qu'il ouvre** (pages privées par espace, et de qui) avant d'écrire — un rattachement donne accès au privé de TOUS les membres, pas seulement de qui lance la commande.
  - ⚠️ **Ne JAMAIS écrire `CURRENT_TIMESTAMP` dans une colonne DateTime depuis un script SQL.** Prisma stocke les DateTime SQLite en **TEXTE** ISO-8601 avec un `T` et un décalage (`2026-08-08T11:02:42.575+00:00`) ; `CURRENT_TIMESTAMP` écrit `2026-08-08 11:02:42`, séparateur **espace**. La comparaison étant lexicographique, l'espace (0x20) passe avant le `T` (0x54) : la ligne devient la **plus ancienne de la journée**. Or `lib/session.ts > firstWorkspaceId` fixe l'espace courant d'une identité incarnée à sa membership la plus ancienne — un rattrapage déplacerait donc l'espace de travail par défaut du compte de service, sans une ligne d'erreur. Passer par `prismaNow()` (`scripts/create-service-account.mjs`), qui est aussi **corrigé rétroactivement** : il portait le même défaut, latent tant qu'il ne posait que la première membership.
- **Rôles (APPLIQUÉS partout via `hasRole`, hiérarchiques : admin ⊇ editor ⊇ viewer)** : **lecteur** = lecture seule TOTALE (aucune mutation, pas même ses pages privées) · **éditeur** = tout le contenu + mise à la corbeille/restore + organiser sections et templates (create/update) + clôture de sprint · **admin** = tout l'IRRÉVERSIBLE (DELETE database/property/view/sprint/section/template, `?permanent=1`, DELETE workspace) + gestion des membres + `PATCH /api/config`. **Écritures exemptées** (sinon un lecteur est cassé) : `POST pages/[id]/visit` (Récents), `POST workspaces/[id]/switch` (préférence de session), `POST /api/workspaces` (créer SON espace → il en devient admin), et `DELETE members/[userId]` **sur sa PROPRE membership** (quitter un espace — sinon un invité y est prisonnier ; le garde « dernier admin » s'applique quand même). Routes SANS contexte workspace : `POST /api/upload` = éditeur+ d'au moins un espace, `PATCH /api/config` = admin d'au moins un espace (`hasRoleInAnyWorkspace` — approximation v1 assumée, pas d'admin d'instance). ⚠️ Les gates vivent dans les handlers, JAMAIS dans le proxy (Vitest importe les handlers directement, le pont MCP passe le proxy sans cookie) — le méta-test de `tests/api/role-gates.test.ts` refuse tout handler mutant non déclaré. Côté client, le rôle arrive via `GET /api/workspaces` (champ `role`) → `useWorkspace().isViewer/isAdmin` ; un rôle inconnu (chargement) est traité lecteur, jamais éditeur ; le 403 serveur reste l'autorité, l'UI n'est que du confort.
- **Invitations (`lib/invitations.ts`)** : « cet email aura ce rôle sur cet espace », posé AVANT que la personne existe. `POST /api/workspaces/[id]/members` crée une **Membership immédiate** si le compte existe (200, `status:"member"`), sinon une **invitation** (201, `status:"invited"`) ; ré-inviter le même email **met à jour le rôle** au lieu de 409. Le claim (`claimInvitations`) tourne sur **deux** chemins seulement : le **callback OIDC** (les DEUX branches — compte existant et provisionné) et le **login** d'un compte préexistant. ⚠️ **JAMAIS sur `POST /api/auth/register`** : cette route ne vérifie aucun email, une invitation `admin` y serait réclamable par quiconque occupe l'adresse. Conséquence assumée : avec `REGISTRATION=on` et aucun IdP, une invitation reste en attente indéfiniment. Le claim est enveloppé (`claimInvitationsSafely`) — il ne doit JAMAIS empêcher de se connecter, et comme la ligne n'est supprimée que dans la transaction réussie, la connexion suivante le rejoue. ⚠️ **Un droit délégué ne survit pas à la perte du droit de déléguer** : `updateMemberRole` (démotion depuis admin) et `removeMember` suppriment, **dans leur transaction**, les invitations émises par la personne visée. ⚠️ **L'oracle d'énumération n'est PAS fermé**, il change de forme : le 404 « compte inconnu » disparaît, mais `member` vs `invited` dit la même chose. Le vrai plafond reste le rate-limit — famille de clés **`invites:<userId>`** avec son **propre budget** (`INVITE_BUDGET`, 20/h), séparée de `members:<userId>` : inviter est un **succès**, le compter dans le compteur d'échecs du login ferait qu'inviter une équipe déclencherait un 429 accusant l'admin de sonder des comptes.
- **Invitation par EMAIL + inscription sur invitation (05/08/2026)** — l'invitation cesse d'être muette, et devient le **laissez-passer** du provisioning.
  - ⚠️ **AUCUN JETON dans l'email, à dessein.** C'est **Keycloak** qui authentifie et garantit l'adresse (le callback refuse déjà `email_verified === false`) ; l'invitation, elle, est posée sur une ADRESSE. Un jeton n'ajouterait aucune preuve — il ne ferait que déposer un secret réutilisable dans une boîte mail, un historique et un `Referer`. Le lien de l'email est donc un lien **nu** vers l'app. ⚠️ **RÉVISÉ le 06/08** : cette règle visait un jeton d'INVITATION (7 j, confère un rôle) et elle tient toujours pour lui. Elle ne s'applique PAS au jeton de CONNEXION introduit ensuite (`lib/magicLink.ts`) — usage unique, aucun droit propre, droit revérifié au clic. La formulation d'origine disait « ne complète pas ce design avec un lien magique » : lue telle quelle, elle ferait défaire un lot livré.
  - **Provisioning fermé** : à `OIDC_ALLOW_SIGNUP=false`, le callback ne crée un compte que si `hasPendingInvitation(email)`. Motif : le realm Keycloak `gotyeah` est **partagé par tous les sites** de l'écosystème — sans ce filtre, l'utilisateur de n'importe lequel d'entre eux obtenait un compte notes (plus « Mon espace ») en cliquant « Se connecter ». L'IdP dit **qui** tu es, l'invitation dit si tu es attendu **ici**. Garde de câblage : `tests/unit/signupGate.test.ts` (le flag seul refuserait TOUS les invités, en silence).
  - **Péremption `INVITATION_TTL_DAYS` = 7 j**, vérifiée **à l'usage** et purgée au passage (pas de cron en self-host, comme la corbeille). Le filtre est l'autorité, la purge n'est que du ménage.
  - **« Renvoyer » = ré-inviter** : aucune route dédiée, `POST /members` fait déjà l'upsert. D'où `createdAt` **rafraîchi** à l'update — il vaut « dernière émission » et prolonge les 7 j, sinon relancer une invitation périmée expédierait un lien déjà mort.
  - **`emailSent` / `emailReason`** sont des champs **ADDITIFS** des réponses 200/201 (le front et le MCP qui les ignorent ne cassent pas). Ils existent parce qu'un envoi **silencieusement raté est pire qu'un envoi absent** : l'admin croirait la personne prévenue. `disabled` (pas de clé Brevo) n'est pas une panne, c'est le mode historique — on prévient à la main.
  - ⚠️ **L'échec d'envoi n'annule JAMAIS l'invitation** : l'ordre est load-bearing — écrire en base, PUIS notifier. L'inverse annoncerait un accès qui n'existe pas.
  - ⚠️ **L'ajout d'un membre CONSOMME l'invitation qui visait la même adresse**, dans sa transaction. Sinon la ligne survit et devient une porte dérobée : `removeMember` ne supprime que les invitations **émises par** la personne, jamais celles qui la **visent** — retirer le membre le laissait donc revenir seul à sa connexion suivante.
  - ⚠️ **Le budget `invites:<userId>` plafonne l'EMAIL, pas l'écriture** : il est consommé par les DEUX branches. Le limiter à `invited` laissait la boucle ajouter/retirer sur un compte existant offrir un canal d'envoi illimité vers l'adresse d'un tiers, depuis l'expéditeur vérifié de l'instance. ⚠️ Le plafond reste **par acteur**, pas par destinataire, et `POST /api/workspaces` est exempté de rôle : tout titulaire d'un compte peut donc créer un espace au nom qu'il choisit et le faire figurer dans le sujet d'un email signé par le domaine. ⚠️ **FERMÉ le 06/08** par un second plafond, `RECIPIENT_BUDGET` (5/h, clé `to:<sha256(email)>`) : il borne ce qu'une ADRESSE reçoit, tous acteurs confondus — le budget par acteur ne bornait rien quand créer un compte et un espace est gratuit. ⚠️ Il retient l'**EMAIL**, jamais l'écriture, et **ne change PAS le code HTTP** : refuser l'invitation punirait un admin pour un abus qu'il ne commet pas, et un 429 ferait de la route un oracle (« cette adresse a déjà été visée »). L'admin le voit via `emailReason: "throttled"`. L'adresse est **hachée** dans la clé — même règle que « pas d'email dans les journaux ». Reste en mémoire, donc remis à zéro au redéploiement : impraticable, pas impossible.
  - ⚠️ **Le claim au login est conditionné à `REGISTRATION=off`** (`app/api/auth/login`). « Le compte existe déjà » ne prouve rien quand n'importe qui peut le créer : `POST /api/auth/register` ne vérifie aucune adresse, donc sans cette condition l'exclusion du claim sur `register` se contournait en une requête de plus (register sur l'email visé, puis login, et l'invitation `admin` tombait). Inscription fermée ⇒ les comptes mot de passe viennent d'un admin ou d'un script, et le rattrapage redevient sûr.
  - **Provisioning de l'invité DANS l'IdP (`lib/keycloak.ts`, 06/08)** — ⚠️ **RETIRÉ DU PARCOURS D'INVITATION le 06/08 même**, remplacé par la connexion par lien email (bullet suivant) ; le module est **de nouveau appelé depuis le 07/08**, mais par un **geste séparé** dans Réglages → Membres, jamais par `POST /members` (cf. *Comptes SSO*). Historiquement : sans lui le parcours était **cassé pour un externe** : le realm a l'auto-inscription fermée (et doit le rester), donc l'email disait « connecte-toi » à quelqu'un qui ne *pouvait* pas. ⚠️ **Surface volontairement étroite** : client dédié `notes-provisioning` **créé DANS le realm `gotyeah`** (un client de `master` n'obtiendrait aucun jeton sur l'issuer du realm, et voisinerait l'administration de tous les realms), portant `manage-users` + `view-users` et **rien d'autre** (jamais `realm-admin`), aucun flux de connexion. ⚠️ **`emailVerified: false` et aucun mot de passe** — load-bearing : la preuve de possession vient du clic sur le lien envoyé *à cette adresse*. Le poser à `true` ferait qu'un admin se trompant d'adresse fabriquerait un compte « vérifié » pour une boîte qu'il ne contrôle pas, alors que le claim d'invitation repose justement sur `email_verified`. ⚠️ `existing` **n'envoie aucun email d'activation** : proposer un nouveau mot de passe à qui en a déjà un ressemble à une prise de contrôle. ⚠️ **`/admin/*` est fermé côté public** (Cloudflare Access → **302**, pas 401 : un échec au diagnostic trompeur), d'où `KEYCLOAK_INTERNAL_URL` = `http://login-keycloak:8080`, les deux conteneurs partageant le réseau `nginx-proxy-manager_default`. Seule la **base** est surchargeable : le **realm reste dérivé d'`OIDC_ISSUER`** — provisionner dans un autre realm que celui qui authentifie ne se verrait qu'au moment où l'invité, compte créé, ne pourrait pas se connecter. Vides = désactivé, on revient au geste manuel, et l'écran Membres le dit.
- **L'invitation s'ACCEPTE (08/08/2026)** — ajouter quelqu'un ne l'ajoute plus, ça le lui **propose**.
  - ⚠️ **`POST /members` ne crée plus JAMAIS de Membership.** Il pose une invitation et une notification actionnable ; la réponse ne dit plus jamais `member`. Motif premier : on n'entrait pas dans un espace sans l'avoir demandé. Motif second, plus lourd : ce comportement était le **TREMPLIN** de l'escalade trouvée le 07/08 sur les comptes SSO — fabriquer un espace (`POST /api/workspaces` n'a aucun gate) puis y ajouter sa cible de force suffisait à se décerner « admin de cet espace ». Le tremplin disparaît ; le test d'escalade le constate en cassant dès l'étape 2.
  - ⚠️ **`claimInvitations(userId, email, { grant })`** — défaut à **FALSE**. Le défaut sûr est celui qui n'accorde rien : un appelant qui oublie l'option laisse l'invitation en attente, il n'ouvre pas une porte en silence. `grant: true` **uniquement** sur la branche « compte qui vient de naître » du callback OIDC : ce compte n'existe QUE parce qu'une invitation vivante l'autorisait, et l'IdP a vérifié l'adresse.
  - ⚠️ **QUATRE points d'appel** (vérifié le 08/08 par `grep claimInvitations src/`) : `login`, les **DEUX** branches du callback OIDC, et **UNE SEULE** branche de `consumeMagicLink` — celle du compte existant. La doctrine a annoncé trois, puis cinq ; les deux étaient fausses. **Cinq** était juste au moment où elle a été écrite et ce lot l'a périmée lui-même : en supprimant la création de compte dans `consumeMagicLink` (retour `needs_acceptance`), il a supprimé le cinquième appel. Le chemin qui fait RÉELLEMENT entrer un invité externe reste le lien email, pas le login : un changement qui l'oublie referme la seule porte d'entrée, et la CI ne le dit pas. ⚠️ **Dette connue** : `login` et `consumeMagicLink` ont un test de route, **les deux branches du callback OIDC n'en ont AUCUN** — il n'existe pas de `tests/api/oidc-*.test.ts`.
  - ⚠️ **`consumeMagicLink` ne crée plus de compte.** Sur une adresse invitée sans compte, il rend `needs_acceptance` et le handler redirige vers `/invitation`. Le jeton est supprimé **puis restitué** dans ce seul cas : sans ça l'écran d'acceptation naîtrait avec un jeton déjà mort. L'usage unique n'est pas affaibli — aucune session n'est ouverte sur ce chemin, et c'est l'acceptation qui consomme pour de bon.
  - ⚠️ **`/invitation` et `/api/invitations/claim` sont PUBLIQUES** (`PUBLIC_PATHS` du proxy). Leur garde est le jeton, pas un cookie. Le GET est un **aperçu** qui ne consomme rien et ne rend que des libellés — jamais le rôle offert, jamais un id exploitable — et répond **uniformément** sur tout échec : distinguer ferait de cette page un oracle sur les adresses connues.
  - ⚠️ **`declinedAt` sur WorkspaceInvitation.** Un refus laisse une trace, sinon l'admin voit « en attente » s'évanouir sans savoir si c'est un refus ou une expiration. **`hasPendingInvitation` l'EXCLUT** : sans ce filtre, dire non puis revenir par « Se connecter » suffirait à obtenir le compte que le refus venait d'écarter — sécurité, pas confort. Ré-inviter le remet à `null` : c'est un geste délibéré qui rouvre la porte.
  - ⚠️ **`removeMember` supprime aussi les invitations qui VISENT la personne**, pas seulement celles qu'elle a émises. Le trou était masqué tant que l'ajout consommait l'invitation ; depuis qu'il n'est qu'une proposition, retirer quelqu'un ne le retirait plus — l'invitation survivante rouvrait l'accès. Trouvé par un test existant.
  - ⚠️ **Ne PAS stocker le rôle offert dans la notification** : ré-inviter le change sur la MÊME ligne d'invitation, une copie périmée afficherait « éditeur » sur un bouton qui accorde « lecteur ». Il est lu sur l'invitation, à l'affichage. Même règle pour la phrase : on stocke des **références** résolues à la lecture, jamais le texte rendu (doctrine de `RecordRevision`).
  - ⚠️ **`record_assigned` (le « Main à » du Dev Loop) est écrit DANS la transaction de `PATCH /records/[id]`**, à partir du diff de révisions déjà calculé. Trois gardes, chacune fermant un piège identifié avant l'écriture : (a) **entrants seulement** (`addedAssignees`) — notifier sur « la propriété a changé » préviendrait tout le monde à chaque retrait ; (b) **coalescence 2 min par acteur** (`shouldCoalesceAssignment`) — `BulkActionBar` envoie un PATCH INDÉPENDANT par carte, donc cocher 30 cartes ferait 30 lignes pour un seul clic, et le serveur ne peut pas savoir que c'en était un ; au-delà de la première, le titre est effacé au profit d'un `count` ; (c) **aucune notification si la page hôte est PRIVÉE et qu'on n'en est pas propriétaire** — le message porte le titre de la carte, prévenir quelqu'un d'une assignation qu'il ne peut pas voir lui divulguerait ce titre et le laisserait devant un 404. ⚠️ L'écriture ne passe PAS par `notify()` (la coalescence exige de lire la dernière ligne) : les filtres du helper sont donc **redéclarés** dans la route — « jamais soi-même », et « jamais un compte de SERVICE » (ajouté le 08/08 : il manquait, un compte de service assigné accumulait des lignes de cloche sans lecteur). ⚠️ **La garde (c) était FAUSSE jusqu'au 08/08** : elle testait `user.id`, l'**ACTEUR**, là où la question est « le **DESTINATAIRE** peut-il ouvrir cette page ? ». Écrite avec l'acteur, elle ne se déclenchait que si l'acteur était lui-même exclu — c'est-à-dire jamais, puisqu'il vient d'écrire sur la carte. Elle fuyait donc le titre dans un sens et le bloquait dans l'autre (personne n'était prévenu sur la page privée d'autrui, alors que son propriétaire le pouvait légitimement). ⚠️ Et son test passait : il réutilisait un destinataire déjà notifié plus haut dans le fichier, dont la **coalescence 2 min** absorbait la nouvelle ligne — un compteur inchangé pour une raison sans rapport avec la garde. Leçon générale : **un test de notification doit viser un destinataire NEUF**, sinon la coalescence le rend vide.
  - ⚠️ **`checkRecordAccess` expose désormais `page`** (id, visibility, ownerId), déjà chargée par sa requête. C'est elle qui décide qui peut être prévenu.
  - ⚠️ **Aucun email en plus de la notification** pour les événements de la cloche : le budget par destinataire est de 5/h et il est PARTAGÉ avec les invitations — trois messages de courtoisie et l'invitation légitime part en `throttled`.
- **Connexion par LIEN EMAIL (`lib/magicLink.ts`, 06/08)** — le canal des invités, et ce qui a remplacé le provisioning IdP dans le parcours d'invitation.
  - **Pourquoi.** L'IdP ne peut pas être le seul chemin : le realm est partagé par tout l'écosystème et son auto-inscription est fermée, donc un invité externe n'y a aucun compte et ne peut pas s'en créer. Le faire provisionner par notes marchait, mais imposait **DEUX emails dont l'ordre comptait** sans que rien ne l'indique — l'invité cliquait le premier et tombait sur un écran lui réclamant un mot de passe qu'il n'avait pas. Un lien de connexion supprime la question : un message, un clic.
  - ⚠️ **Ce jeton n'est PAS celui qu'on avait écarté.** Le design des invitations refuse toujours un jeton d'INVITATION (7 j, confère un rôle). Ici c'est un jeton de **CONNEXION** : usage unique, aucun droit propre, et le droit d'entrer est **revérifié à la consommation** — un lien ne survit pas à la révocation de l'invitation qui le justifiait. `id = sha256(token)`, comme les sessions.
  - **Deux TTL** : `MAGIC_LINK_TTL_MINUTES` = 15 min pour un lien demandé depuis l'écran de connexion ; `INVITE_LINK_TTL_MINUTES` = 7 j pour celui glissé dans l'email d'invitation — plus court, l'invité qui ouvre son courrier le lendemain trouverait un lien mort. Ce TTL long n'ajoute aucun droit : il est borné par l'invitation, qui expire au même moment.
  - ⚠️ **`POST /api/auth/magic` répond TOUJOURS pareil** (adresse inconnue, invitation expirée, envoi raté) : distinguer ferait de cette route publique un oracle disant qui a un compte ici. Le rate-limit porte donc sur toutes les demandes, pas sur les échecs — il n'y a pas d'échec observable, et c'est le volume qui est l'abus.
  - ⚠️ **Un compte de service ne se connecte jamais par email** : il n'a pas de boîte, et il voit les pages privées des espaces où il est membre.
  - ⚠️ **Demander un lien invalide le précédent**, sinon chaque clic laisse une porte ouverte pour tout son TTL. Et le jeton est supprimé **avant** la vérification d'expiration : un jeton qui survivrait à son propre échec resterait rejouable.
  - **Conséquence assumée** : ce chemin **contourne l'IdP**, donc ses politiques (MFA, expiration) ne s'y appliquent pas, et l'email devient un facteur d'authentification — comme pour toute réinitialisation de mot de passe. `MAGIC_LINK=off` ferme le canal.
  - ⚠️ **Limite connue** : un filtre anti-hameçonnage qui suit les liens (Defender, Barracuda) consommerait le jeton avant le destinataire, qui verrait « lien expiré ». Le repli est d'en redemander un. La parade serait un écran de confirmation, jamais un jeton réutilisable.
  - **`lib/keycloak.ts` reste en place mais N'EST PLUS APPELÉ** par la route d'invitation : le provisioning IdP est devenu inutile pour les invités. Le module et son client `notes-provisioning` sont conservés pour ne pas avoir à les réécrire si l'on veut un jour que les invités existent aussi dans l'IdP.
  - ⚠️ **Le nom d'espace et le displayName sont ÉCHAPPÉS** dans le HTML (`escapeHtml`) : ce sont des chaînes libres, et un `<a>` injecté dans un email qui a l'air de venir de GotYeah est un hameçonnage réussi. Le JS ne s'exécute pas dans un client mail — un lien, si.
- **Comptes SSO depuis Réglages → Membres (07/08/2026)** — voir *qui peut se connecter par l'IdP*, créer le compte manquant, suspendre ou rétablir un accès. `GET /api/workspaces/[id]/idp` (état) + `POST /api/workspaces/[id]/members/[userId]/idp` (`create` | `suspend` | `resume`).
  - ⚠️ **DEUX gardes, et c'est la SECONDE qui tient : `IDP_ADMIN_EMAILS`.** Le rôle « admin de l'espace » ne peut PAS être l'autorité d'une action dont l'effet porte sur le realm partagé, parce qu'il est **auto-attribuable en deux requêtes** : `POST /api/workspaces` n'a aucun gate (exemption assumée — on crée SON espace et on en devient admin), puis `POST /members` crée une Membership **immédiate** pour toute adresse ayant déjà un compte notes, **sans son consentement**. Un lecteur invité sur un seul board se fabriquait ainsi le droit de couper la connexion Keycloak de n'importe qui, sur tous les sites. Trouvé en revue adversariale et **reproduit** ; le test `idp-accounts.test.ts` rejoue la chaîne complète et exige le 403. ⚠️ La garde couvre les **trois** actions, `resume` comprise : rendre un accès coupé ailleurs (offboarding d'un autre site) est aussi une décision. ⚠️ **Vide = PERSONNE**, jamais « tout le monde » — le défaut inverse est celui qui a rendu `MCP_ACT_AS_ALLOWLIST` inerte trois semaines.
  - ⚠️ **AUCUNE SUPPRESSION, et ce n'est pas un oubli.** Le client a le droit d'appeler `DELETE /users/{id}` ; `lib/keycloak.ts` ne l'expose pas. Le realm `gotyeah` est **partagé par tous les sites** : supprimer un compte détruit le `sub` sur lequel les voisins reconnaissent la personne, plus son MFA et ses identités fédérées — sans corbeille Keycloak, et **sans sauvegarde** (le snapshot pré-MEP ne couvre que la SQLite de notes). Recréer donne un `sub` neuf : notes, qui lie par email, ne verrait rien ; le voisin verrait un inconnu. `enabled: false` obtient le même effet, **réversible**, et le `POST /users/{id}/logout` qui suit coupe les sessions déjà ouvertes (sans lui, la personne travaille encore des heures).
  - ⚠️ **Suspendre le SSO ne révoque PAS l'accès à notes** : la Membership, le compte notes et le lien de connexion par email survivent. Le geste qui met dehors reste `DELETE /members/[userId]`. L'écran le dit **en toutes lettres** — sinon l'admin croit avoir fermé une porte qui reste ouverte.
  - ⚠️ **`unknown` n'est pas « aucun compte ».** L'annuaire est lu en **UNE** requête bornée (`LIST_LIMIT`) puis croisé localement : Keycloak n'a pas de lookup par lot, et N allers-retours de 8 s feraient dépendre l'écran de la santé de l'IdP. Page pleine ⇒ `truncated`, et les adresses non lues valent `unknown`. Répondre « aucun compte » ferait cliquer « créer » sur quelqu'un qui en a un — donc **un doublon d'identité** dans un realm partagé, irréparable depuis notes. Même règle si l'IdP ne répond pas : `available: false`, l'UI n'affiche rien plutôt qu'un état par défaut.
  - ⚠️ **La route est SÉPARÉE de `/members`** — cette clé SWR alimente aussi les cellules `user`, les filtres et les **graines des colonnes kanban**. Y greffer un appel Keycloak ferait qu'un IdP lent bloque l'ouverture d'un board, puis que le kanban, privé de graines, classe **toutes** ses cartes en « Membre retiré ».
  - ⚠️ **`resent` répare un CUL-DE-SAC.** Création OK + email d'activation en échec ⇒ compte sans mot de passe ; l'ancienne logique le retrouvait « existing » et sortait avant l'envoi, donc plus **aucun** lien ne repartait, précisément quand l'admin tentait de réparer. Le critère est `requiredActions` contenant `UPDATE_PASSWORD`, **jamais `emailVerified`** (un compte utilisable avec adresse non vérifiée ne doit pas se voir proposer un mot de passe).
  - ⚠️ **Mais `UPDATE_PASSWORD` ne prouve PAS « jamais activé »** — Keycloak le pose aussi sur un compte **vivant** : mot de passe temporaire, « Required user actions » saisie à la main, politique d'expiration. L'envoi est donc gardé par `hasPasswordCredential` (`GET /users/{id}/credentials`, métadonnées seules, couvert par `view-users`) : un mot de passe existant ⇒ `existing`, **et illisible ⇒ `existing` aussi** — on n'expédie pas un « choisis ton mot de passe » sur une supposition, dans un realm partagé. C'est le même motif que la branche `existing` : ça ressemblerait à une prise de contrôle. D'où le libellé d'écran « **action en attente côté SSO** » et non « jamais activé » : l'annuaire, lu en une requête, ne peut pas trancher.
  - ⚠️ **`sessionsCut` n'est pas décoratif.** Le `logout` qui suit la désactivation peut échouer (timeout, 502, jeton expiré) : son échec est **rapporté**, jamais avalé. Le compte est bien désactivé mais les sessions ouvertes survivent — annoncer « sessions coupées » ferait tenir un offboarding partiel pour terminé, et c'est précisément le motif pour lequel le `logout` existe.
  - ⚠️ **`create` consomme `recipientAllowed`** (`RECIPIENT_BUDGET`) **et** `INVITE_BUDGET`. L'email d'activation est émis par **Keycloak**, pas par `lib/mailer` : sans ce passage, un bouton re-cliquable rouvrait le canal d'envoi vers l'adresse d'un tiers que la PR #59 venait de fermer. D'où le déplacement de `recipientKey`/`recipientAllowed` **dans `lib/rateLimit.ts`** — deux définitions du même hachage divergeraient, et chaque route aurait son compteur ; un test le garde. ⚠️ Ici le plafond **refuse l'action (429)** au lieu de laisser passer sans email, contrairement à l'invitation : provisionner sans activation fabrique le cul-de-sac ci-dessus, et il n'y a pas d'oracle à craindre (l'admin voit déjà ce membre et son adresse).
  - ⚠️ **Suspendre exige de RECOPIER l'adresse**, pas une modale « es-tu sûr ? » — le rayon dépasse l'application, et une modale se clique sans lire. ⚠️ **Personne ne suspend son propre accès** (409) : `LEGACY_LOGIN=off` en prod, se couper soi-même n'a pas de retour simple. ⚠️ **Refus sur un compte de service** (409, comme `POST /members`) : pas de boîte mail, et il voit les pages privées.
  - ⚠️ **Le budget destinataire est consommé APRÈS l'appel, et seulement si un email est parti** (`created` / `resent`). Le consommer d'office ferait payer à l'adresse un `existing` qui n'envoie rien — et comme le compteur est partagé avec `POST /members`, cinq clics sans effet bloqueraient ensuite les **invitations légitimes** vers cette personne.
  - Le GET répond **200** avec `{configured, allowed, available}` — jamais 403 sur la configuration : l'écran a besoin de savoir pourquoi il n'affiche rien. C'est le **POST** qui répond 409 (non configuré) et 403 (hors allowlist). `configured && allowed && available` ⇒ boutons ; sinon **rien**, pas de bouton fantôme. ⚠️ Mais `!allowed` est **affiché** : c'est l'état de la prod tant qu'`IDP_ADMIN_EMAILS` n'est pas posée, et un écran muet enverrait chercher une panne.
  - ⚠️ **Les CLÉS D'ACCÈS (passkeys) ne s'enregistrent PAS depuis notes, et ne le pourront jamais.** Une clé naît d'une cérémonie `navigator.credentials.create()` exécutée par le NAVIGATEUR, et le credential produit est lié au domaine appelant : une cérémonie lancée depuis notes fabriquerait une clé pour le domaine de *notes*, que Keycloak ne verrait jamais et que notes ne saurait pas vérifier (ni challenge, ni stockage de credential, ni vérification d'assertion — son auth s'arrête à un id_token). L'API admin de Keycloak ne sait pas non plus injecter un credential WebAuthn. Ce que notes livre est donc un **lien** vers `accountConsoleUrl()`, dans Réglages → Profil. ⚠️ Il **remplace** un formulaire « Changer le mot de passe » qui n'avait aucune route derrière et que `LEGACY_LOGIN=off` rendait doublement mort. ⚠️ **Ne pas basculer `REQUIRED_ACTIONS` sur `webauthn-register-passwordless`** : le mot de passe est le FILET (une clé Windows Hello est liée au TPM, non synchronisée — PC perdu, accès perdu), et le thème email de Keycloak n'a pas de traduction pour ces actions. ⚠️ Sur un même PC, une **seconde clé Hello ÉCRASE la première** (CTAP 2.1, même domaine + même compte) : un vrai secours vit sur un autre authenticator.
  - ⚠️ **`addMember` revalide AUSSI la clé `/idp`.** L'état SSO est indexé par `userId` : sans ça, un membre qui vient d'arriver ne s'y trouve pas, s'affiche « non vérifié » et n'offre **aucun** bouton jusqu'à un rechargement complet.
- **Permissions fines par colonne — TRANSITIONS (`lib/permissionRules.ts`)** : une règle dit « pour poser CETTE option, il faut ces rôles OU être l'une de ces personnes », stockée dans `DatabaseProperty.config.rules` à côté des `options`. **L'absence de règle vaut permission** — c'est ce qui rend le lot rétrocompatible avec les 22 boards de prod, dont aucun config ne porte la clé. ⚠️ **PAS d'exemption admin** (décision du 05/08) : un admin bloqué ne contourne pas la règle, il la **modifie** — acte explicite, écrit dans le config, réversible, là où une exemption serait invisible. ⚠️ `lib/permissionRules.ts` est à **ZÉRO import** et doit le rester : il est consommé par des composants `"use client"`, un `import` vers `lib/workspace` y tirerait `lib/prisma` donc **better-sqlite3 (addon natif) dans le bundle navigateur**. Le rang de rôles y est redéclaré, un test garde la synchro. ⚠️ **L'ordre d'évaluation de `canTransition` est FIGÉ** : « aucune règle → permis » AVANT « pas d'identité → refus ». Inversé, il viderait tous les menus select de la production. ⚠️ **DEUX écrans, un seul composant** : `TransitionRulesEditor` est monté par `PropertyPopover` (en-tête de colonne, vue Tableau) ET par `PageOptionsPanel` (barre latérale, toutes vues). Avant le 09/08 il n'y avait que le premier — donc **aucun** chemin depuis un board kanban, et **0 colonne sur 306** portait une règle un mois après la livraison. Même famille que `patchNotesPageId`, resté `null` sur 20 boards faute d'UI : une fonctionnalité sans porte n'existe pas. Ne pas redupliquer l'éditeur. **Quatre portes** gatées côté serveur : `PATCH /records/[id]` (ne compte que les transitions RÉELLES, via le diff des révisions), `POST /databases/[id]/records` et `POST /records/[id]/duplicate` (une duplication produit le même résultat qu'une création dans la colonne), plus **DEUX** portes sur la clé `rules`, toutes deux gatées **admin** — les routes sont ouvertes aux éditeurs et le config s'écrit en entier, sans ces gates un éditeur se dé-restreindrait lui-même. `PATCH /properties/[id]` gate sur la **différence**, pas la présence : le popover réémet `{...config}` à chaque renommage. ⚠️ **`POST /databases/[id]/properties` gate sur la PRÉSENCE** (d'un tableau non vide), parce qu'à la création il n'y a rien à diffuser — poser des règles en fabriquant la colonne EST l'acte à gouverner. Cette seconde porte **manquait jusqu'au 08/08**, et la présente doctrine affirmait pourtant que « la clé est gatée admin » : c'était vrai du PATCH, faux de la création, et un éditeur créait donc une colonne dont les règles d'accès étaient déjà les siennes. ⚠️ **Exception assumée au « config = remplacement TOTAL »**, et seulement sur `rules` : une clé absente **reporte** l'existant (le MCP reconstruit le config sans la connaître et l'effacerait) ; pour retirer une règle il faut envoyer un tableau explicite. Une option citée par une règle rejoint `findReferencedOptionIds` et devient non supprimable, avec un message qui dit **où** retirer la règle.
- **Corbeille (soft delete)** : **seuls `Page` et `Record` ont un `trashedAt`** ; les 13 autres modèles n'en ont pas (supprimer une View / un Sprint / une Property / une Section est **définitif**). Trasher une page estampe **tout son sous-arbre** en transaction (`lib/trash.ts > trashPageSubtree`, restauration symétrique) : le soft delete ne cascade pas via les FK, il faut le propager à la main. Les `check*Access` renvoient **null** pour un élément trashé — l'option `includeTrashed` n'est là que pour le lifecycle corbeille (restaurer / purger). **Toute nouvelle lecture doit filtrer `trashedAt: null`.** Purge définitive après 30 j (`TRASH_PURGE_DAYS`), déclenchée **paresseusement** à l'ouverture de la corbeille — pas de cron en self-host.
- **Record.properties** : JSON indexé par `DatabaseProperty.id` (stable), JAMAIS par le nom de la propriété. Le nom est un label affichable qui peut changer.
- **Record.title** vs property "title" : la property de type `"title"` (créée automatiquement avec la database) correspond au champ SQL `Record.title`, PAS à une entrée dans `Record.properties`. Le composant Cell bifurque sur ce cas.
- **DatabaseProperty.type = "title"** : type spécial, un seul par database, créé auto, ne peut pas être supprimé ni dupliqué. Les garde-fous sont en place côté API.
- **Propriété `relation`** : la valeur d'un record est un `string[]` d'ids de `Record` appartenant à `config.targetDatabaseId`. Tout POST/PATCH de properties passe par `lib/relations.ts > validateRelationValues()` (→ **400** si un id n'existe pas dans la database cible ou y est en corbeille). Pas de backlink en v1 ; un id dont le record a été supprimé est un « lien mort » toléré à l'affichage.
- **Écrire une propriété `user` = ne JAMAIS réémettre un id qui n'est plus membre** (`lib/db.ts > withoutUnknownIds`). `validateUserValues` refuse (400) tout tableau contenant un non-membre, or **la moindre écriture réémet le tableau entier** : sans nettoyage, une carte gardant l'id d'un membre parti devient définitivement inéditable (drop kanban, cellule et actions groupées échouent tous, avec un rollback muet). Les trois portes d'écriture appliquent la règle : `KanbanView` au drop, `Cell` au commit du sélecteur d'assignés (**seulement si la valeur a bougé** — ouvrir/fermer sans rien toucher ne doit rien écrire), `BulkActionBar` à l'union. Le lien mort est donc lâché au premier déplacement : c'est ce qui rend la colonne « Membre retiré » réparatrice au lieu d'être un cul-de-sac.
- **Kanban regroupé par assigné** : l'axe accepte `select | multiselect | user`. Les colonnes ne viennent PAS toutes de `config.options` (une propriété `user` n'en a aucune, à dessein) : `lib/client/kanban.ts > buildKanbanColumns` reçoit des **graines injectées** (`{id,label}[]` — options pour select, membres de l'espace pour `user`). Une carte assignée à un membre **parti** atterrit dans une colonne dédiée « Membre retiré » (`includeOrphans`, réservé à l'axe `user` : le serveur refuse déjà de retirer une option select référencée). ⚠️ Cette colonne porte `optionId: null` et n'est **pas** une cible de dépôt — y déposer une carte appliquerait la sémantique « Sans valeur » et effacerait ses assignés ; le garde-fou est dans `useDroppable({ disabled })` **et** dans `handleDragEnd` (dnd-kit laisse passer un dépôt sur une CARTE de la colonne). Le renommage inline d'en-tête reste réservé aux colonnes qui portent une vraie option.
- **Propriété `user` (assignés)** : la valeur d'un record est un `string[]` d'ids de `User` **membres de l'espace hôte**. Tout POST/PATCH de properties passe par `lib/assignees.ts > validateUserValues()` (→ **400** si un id n'est pas membre, ou si la valeur n'est pas un tableau de strings) — validé sur le **patch entrant SEULEMENT**, jamais sur le résultat du merge : sinon un membre retiré gèlerait toute écriture ultérieure sur les cartes qu'il occupait. Un membre parti reste un « lien mort » toléré, affiché grisé « Membre retiré ». C'est un type **multi-valeurs** (`isMultiValueType` de `lib/db.ts` : multiselect + user) : filtres/tris/kanban le traitent comme un multiselect, `eq/neq` y sont sans effet (l'UI mappe « est / n'est pas » sur `contains/notContains`). ⚠️ **La liste des membres n'est jamais affichée avec l'email** : `GET /api/workspaces/[id]/members` le renvoie à tout membre, l'exposer sur un board diffuserait les emails de l'espace — la cellule et le filtre n'affichent que le `displayName`.
- **Record.coverUrl** : le champ existe et `GalleryView` l'affiche, mais **aucune route ne permet de l'écrire** aujourd'hui (ni `POST /records`, ni `PATCH /records/[id]`) — seul `POST /api/records/[id]/duplicate` le recopie. Ne construis pas de feature en supposant qu'il est alimenté.
- **View.config** : remplacement TOTAL au PATCH (pas de merge). Le client envoie toujours le config complet.
- **Filtre « Moi » (jeton `@me`)** : `View.config` est en base et **partagé par tous les membres** — y écrire un userId donnerait les cartes de son AUTEUR à tout le monde. Un filtre « Moi » stocke donc la constante `CURRENT_USER_TOKEN` (`lib/db.ts`, valeur `"@me"`), résolue **à la lecture** par `resolveFilterTokens(filters, currentUserId, properties)` (pur, `lib/client/viewFilters.ts`) — **scopé au type `user`** : « @me » tapé à la main dans le filtre d'une colonne texte doit rester littéral, sinon cette vue passerait silencieusement à zéro résultat pour tout le monde. Trois portes, toutes câblées : `applyViewConfig(records, config, properties, currentUserId?)` (4e argument **optionnel** — les appels à 3 arguments restent valides), `deriveSeedFromFilters(filters, properties, currentUserId?)` (sinon la carte créée dans une vue « Moi » naîtrait assignée à la chaîne `"@me"` → 400), et **`GET /api/databases/[id]/records?filter=`** côté serveur (sinon le MCP filtrerait sur le littéral et recevrait 0 record sans erreur). ⚠️ **Sans identité, le jeton est laissé tel quel** : la vue est vide plutôt que complète — un board vide se remarque, un board qui montre les cartes de tout le monde ne se remarque pas. L'utilisateur courant descend de `app/pages/[id]/page.tsx` → `DatabaseShell` → les 5 vues (prop `currentUserId`, résolue au SSR : pas de flash, pas de route `/api/me`). ⚠️ Un axe `user` ne se dessine PAS tant que `useWorkspaceMembers` n'a pas répondu : sans graines, toute carte assignée serait classée « Membre retiré » — le kanban affiche un état de chargement, et un état d'erreur explicite si la liste ne vient pas (le hook expose `error` pour ça).
- **Record.properties au PATCH** : MERGE via `mergeRecordProperties()`, pas écrasement. Une valeur `null` supprime la clé. ⚠️ En revanche `content` et `sectionsBody` sont en **remplacement TOTAL** : une mise à jour partielle du corps EFFACE les sections non réémises. Relis le corps existant avant d'écrire.
- **RecordRevision (historique)** : écrit **côté serveur**, dans la MÊME transaction que le `PATCH /api/records/[id]` — une ligne par champ **réellement** changé (diff calculé avant l'update par `lib/db.ts > diffRecordRevisions`, logique PURE et testée). **Coalescence 2 min** (`shouldCoalesceRevision` : même acteur + même champ → fusion dans la dernière ligne) pour absorber le spam d'autosave BlockNote. **Rétention indéfinie : pas de purge**, contrairement au `trashedAt`. Périmètre records uniquement (les pages ne sont pas versionnées).
- **Templates (modèles)** : un `Template` (par workspace) définit colonnes + regroupement kanban + sections de corps à libellés FIXES. Templates « fournis » (ticket, bug) en code (`lib/templates.ts`, id `builtin-*`, lecture seule) à côté des templates DB. `POST /api/databases { templateId }` scaffolde colonnes + kanban + estampe `Database.recordSections`. Un record d'une DB templatée a un **corps sectionné** (`Record.sectionsBody` = `[{id,label,content}]`, parse via `lib/db.ts > parseSectionsBody`) — libellés rendus HORS éditeur (non modifiables), un éditeur BlockNote par section. **Opt-in** : sans template, le record garde son corps libre (`content`). Le menu « modèle » du `RecordPanel` change le template par carte (indépendant du kanban).
- **Backlog (façon Jira)** : un 5e type de vue `backlog`. Les **sprints** sont un modèle Prisma `Sprint` (par database) ; un record y est rattaché via `Record.sprintId` (null = backlog). `onDelete: SetNull` → supprimer un sprint renvoie ses issues au backlog (non destructif). Les colonnes story points / statut / épic ne sont PAS un nouveau concept : ce sont des propriétés normales (number / select / select coloré), câblées dans `View.config` (`pointsPropertyId`, `statusPropertyId`, `epicPropertyId`, `doneStatusOptionId`) par le template fourni `builtin-scrum`. Sans câblage, la vue dégrade proprement (lanes par sprint, lignes titre seul). **Board scopé (Scrum)** : le kanban a un `View.config.sprintScope` (`"active"` = sprint en cours · `"all"` = toutes les issues · un id de sprint) ; le board scrum est scaffoldé `sprintScope:"active"` (nommé « Sprint actif »). Le statut est l'axe COMMUN (`statusPropertyId` backlog = `groupByPropertyId` board) → l'avancement se reflète des deux côtés. Le kanban ne fetch les sprints QUE si `sprintScope` est défini (kanban classique inchangé). **Un seul sprint `active`** par database — le check et l'update vivent dans la MÊME transaction (deux PATCH concurrents sinon → deux sprints actifs), le conflit remonte en **409**. `POST /api/databases/[id]/records` et `PATCH /api/records/[id]` acceptent `sprintId` (garde-fou : sprint de la même database, sinon 400). API sprints : `GET/POST /api/databases/[id]/sprints`, `PATCH/DELETE /api/sprints/[id]`. Accès via `checkSprintAccess` (`lib/workspace.ts`).
- **Clôture d'un sprint (transaction unique)** : `PATCH {state:"completed", moveIncompleteToBacklog, statusPropertyId, doneStatusOptionId}` fait, atomiquement : passage à `completed`, **renvoi des issues non terminées au backlog** (`status != doneStatusOptionId` → `sprintId=null`), génération de `Sprint.releaseNotes` (markdown, **une seule fois** : `releaseNotes` déjà rempli = re-clôture idempotente), puis **append d'un bloc daté à la page « Patch notes »** mappée par `Database.patchNotesPageId`. Garde-fous : réconciliation d'exhaustivité (toute issue listée doit être terminée, sinon **rollback + 422**), page au contenu JSON illisible → **rollback + 422** (on n'écrase jamais la page), pas de page mappée → clôture OK avec un flag `patchNotesAppend` explicite. `Sprint.releaseNotes` est en **lecture seule côté UI**. Démarrer/terminer dispo depuis le backlog ET le board.
- **Database.patchNotesPageId** : référence **LIBRE**, sans relation Prisma. La robustesse est assurée à l'écriture (le PATCH refuse une page d'un autre workspace ou inaccessible) ET à l'append (page existante, même workspace, non trashée, accessible à l'acteur — la visibility peut changer après le mapping). `null` = pas de mapping, ce n'est pas une erreur.
- **Position** : Float, gap-based ordering (gap de 1000) via `lib/positions.ts > nextPosition()` — models `databaseProperty`, `record`, `view`, `sprint`, **et eux seuls**. Passer le client de `$transaction` pour que le MAX(position) et le create soient atomiques. ⚠️ **`Page` n'utilise PAS `nextPosition`** : `lib/pages.ts > createPage()` a son propre calcul (`MAX + 1`, scopé à la section pour les racines). Ne mélange pas les deux systèmes. `setPageSection()` applique le **même** calcul, mais **seulement si le rattachement change vraiment** (nouveau parent ou nouvelle section) : la page déplacée arrive en dernière position de sa nouvelle fratrie, alors qu'un PATCH qui ne déplace rien laisse la position intacte — sinon le drag & drop de la sidebar (qui envoie `position` seul) serait contredit.
- **Pièces jointes (`RecordAttachment`)** — un document déposé sur une carte, servi par `GET /api/attachments/[id]`.
  - ⚠️ **`POST /api/upload` reste IMAGE-ONLY, et la liste des types de pièces jointes est SÉPARÉE** (`ATTACHMENT_TYPES`). Élargir `ALLOWED` ouvrirait les documents aux trois éditeurs BlockNote — donc aux **pages** — et ils seraient alors servis par `GET /api/files/[name]`, qui ne vérifie qu'une session et n'est scopé à aucun espace. Le lot creuserait le trou qu'il ouvre une route scopée pour éviter. Conséquence assumée : glisser un PDF dans le **corps** d'une page échoue toujours en 415.
  - ⚠️ **L'accès passe par la CARTE** (`checkRecordAccess`), pas par le nom du fichier — toute la différence avec `/api/files/[name]`. Perdre l'accès à la carte ferme le document. `Cache-Control: no-store` (un accès révoqué ne doit pas rester servi par le cache) et `Content-Disposition: attachment; filename*=UTF-8''` pour restituer le nom d'origine accentué.
  - ⚠️ **Le téléchargement STREAME** (`createReadStream` → `Response`), contrairement au patron de `/api/files` qui charge le fichier entier en RAM. Avec des documents de plusieurs Mo sur un Pi arm64, recopier ce patron ferait un pic proportionnel au nombre de téléchargements simultanés.
  - ⚠️ **`purgeOrphanUploads` a dû être ÉTENDUE**, et c'est l'étape qui pouvait détruire des données : elle ne scannait que `Page.content`, `Record.content` et `Record.sectionsBody`. Le `fileName` y est ajouté **directement**, jamais via `extractUploadRefs` — le champ contient `uuid.pdf`, pas `/api/files/uuid.pdf`, et la regex rendrait un ensemble **vide**, donc purgerait tout. La mèche est d'un mois (30 j sur le mtime du fichier) : aucun test manuel ni aucune recette ne l'aurait vue. Écrite AVANT les routes, avec ses tests.
  - **La duplication d'une carte recopie les lignes et PARTAGE le fichier** : gratuit et sûr, parce que le `Set` de la purge EST le comptage de références. `uploadedBy` reste celui de l'original — la ligne dit qui a déposé.
  - **Le retrait supprime la LIGNE, jamais le fichier** : un autre enregistrement peut le citer. C'est la purge qui libère l'octet.
  - **Un seul plafond**, `AppConfig.uploadMaxMb`, partagé avec les images. ⚠️ Le proxy (NPM) plafonne à **25 Mo** (`client_max_body_size` dans `/data/nginx/custom/server_proxy.conf`) : au-delà, c'est nginx qui coupe, avant l'application, avec son propre 413.
- **AppConfig** : ligne **singleton** (`id = "app"`). Toujours passer par `lib/appConfig.ts > getAppConfig()/setAppConfig()` (upsert → la ligne est créée à la volée avec ses défauts, jamais de `findUnique` qui renverrait null).
- **Prisma 7** génère les types avec suffixe `Model` (RecordModel, ViewModel...). `lib/db.ts` les aliase. Le type natif TS `Record` est shadowé → importer comme `import type { Record as DbRecord }`.

## Architecture

```
src/
├── proxy.ts                         # ⚠️ LE middleware (Next 16 a renommé middleware → proxy).
│                                    #   401 sur /api/* sans cookie + anti-CSRF (Origin cross-site → 403).
│                                    #   Laisse passer le pont MCP (x-mcp-secret + x-act-as-email).
├── app/
│   ├── layout.tsx                   # Racine : pose data-theme (cookie app-theme), monte
│   │                                #   DialogProvider > WorkspaceProvider > AppShell
│   ├── page.tsx                     # "/" → redirect /login si pas de session, sinon écran d'accueil
│   ├── login/ · register/           # page.tsx (Server) + LoginForm/RegisterForm (Client)
│   ├── settings/                    # SettingsPage.tsx — Profil (identité MODIFIABLE via
│   │                                #   PATCH /api/me, sauf l'email ; + lien « Gérer mes
│   │                                #   moyens de connexion » vers la console de compte de l'IdP :
│   │                                #   mot de passe et CLÉS D'ACCÈS y vivent, pas dans notes)
│   │                                #   · Membres (espace actif : liste,
│   │                                #   ajout par email, rôles, invitations en attente, et
│   │                                #   COMPTES SSO : créer / suspendre / rétablir — gestion admin)
│   │                                #   · Stockage (masqué aux non-admins) · Apparence
│   ├── templates/page.tsx           # Gestion des modèles (TemplatesManager)
│   ├── pages/[id]/page.tsx          # Server Component : charge Page, enregistre la visite,
│   │                                #   branche DatabaseShell (si database) OU EditorClient
│   ├── globals.css                  # Thèmes (data-theme), mapping --bn-colors-* de BlockNote
│   └── api/                         # 41 route handlers → voir « Conventions des routes API »
│       ├── me/route.ts              # PATCH profil de l'utilisateur COURANT (displayName,
│       │                            #   firstName, lastName). Aucun gate de rôle : on ne
│       │                            #   modifie que soi-même. ⚠️ L'EMAIL n'y est PAS modifiable
│       ├── auth/                    # PUBLIC : login/logout/register + oidc/login|callback
│       ├── workspaces/              # GET/POST, [id] DELETE (admin), [id]/switch POST
│       │                            #   ⚠️ POST est le SEUL appelant à passer
│       │                            #   withServiceAccounts — cf. « Rattachement d'office »
│       │   ├── [id]/idp/route.ts    # GET état des comptes SSO des membres (ADMIN). UNE requête à
│       │   │                        #   l'IdP + croisement local ; séparée de /members à dessein
│       │   ├── [id]/members/        # GET liste (tout membre, expose isService), POST ajout par
│       │   │   │                    #   email (admin, lecteur par défaut) : 200 si le compte
│       │   │   │                    #   existe, 201 INVITATION sinon. Refuse un compte de service.
│       │   │   ├── [userId]/        # PATCH rôle, DELETE retrait (admin ; quitter l'espace = soi-même)
│       │   │   │                    #   garde-fou transactionnel « dernier admin » → 409
│       │   │   └── [userId]/idp/    # POST create|suspend|resume sur le compte IdP (ADMIN).
│       │   │                        #   JAMAIS de suppression ; suspendre ≠ retirer de l'espace
│       │   └── [id]/invitations/    # GET pré-autorisations en attente (ADMIN — route SÉPARÉE de
│       │                            #   /members, dont la clé SWR alimente aussi le board),
│       │                            #   [invitationId] DELETE révoque (admin, définitif)
│       ├── sections/                # GET/POST, [id] PATCH/DELETE (409 si dernière du type)
│       ├── pages/
│       │   ├── route.ts             # GET arbre (hors corbeille), POST create
│       │   ├── recent/route.ts      # GET 5 dernières visites (PageVisit)
│       │   └── [id]/                # route.ts (GET expose database:{id}, PATCH, DELETE → CORBEILLE),
│       │                            #   restore/ (page + sous-arbre), visit/ (upsert PageVisit)
│       ├── trash/route.ts           # GET corbeille du workspace ; purge > 30 j au passage
│       ├── search/route.ts          # GET pages + records (scopé workspace, hors corbeille)
│       ├── config/route.ts          # GET/PATCH réglages instance ; le GET purge les uploads orphelins
│       ├── upload/route.ts          # POST image multipart → { url } ; 413 trop gros / 415 type
│       ├── files/[name]/route.ts    # GET sert le fichier (OCTETS BRUTS, pas de JSON) ; session requise
│       ├── templates/               # route.ts GET/POST, [id] GET/PATCH/DELETE (builtins → 400)
│       ├── databases/
│       │   ├── route.ts             # POST create (+ scaffold colonnes/kanban/backlog depuis templateId)
│       │   └── [id]/
│       │       ├── route.ts         # GET (expose workspaceId : source des membres côté client),
│       │       │                     #   PATCH (recordTemplate, patchNotesPageId), DELETE
│       │       ├── properties/route.ts  # POST property (relation : cible dans le MÊME workspace)
│       │       ├── records/route.ts     # GET list (params optionnels filter/limit/offset/includeContent
│       │       │                        #   + X-Total-Count), POST record (corps sectionné, sprintId)
│       │       ├── sprints/route.ts     # GET list, POST sprint (vue backlog)
│       │       └── views/route.ts       # POST view
│       ├── properties/[id]/route.ts # PATCH (rename/options, type FIGÉ), DELETE (purge la clé des records)
│       ├── records/[id]/
│       │   ├── route.ts             # GET, PATCH (+ écrit les RecordRevision), DELETE → CORBEILLE (?permanent=1)
│       │   ├── duplicate/route.ts   # POST copie serveur atomique (titre « (copie) », props/corps/sprint)
│       │   ├── restore/route.ts     # POST restaure (409 si la page hôte est encore en corbeille)
│       │   └── revisions/route.ts   # GET historique des modifs
│       ├── sprints/[id]/route.ts    # PATCH (démarrer/terminer + notes de version + append Patch notes), DELETE
│       └── views/[id]/route.ts      # PATCH, DELETE (400 si c'est la dernière vue)
├── contexts/                        # Les 2 SEULS contextes React (pas de state global au-delà)
│   ├── WorkspaceContext.tsx         # workspaces, activeWorkspace, switchWorkspace()
│   └── DialogContext.tsx            # useDialog() → confirm()/alert() en Promise.
│                                    #   ⚠️ Remplace window.confirm : ne JAMAIS utiliser confirm() natif
├── components/
│   ├── AppShell.tsx                 # Sidebar + Header + SearchPalette ; EmptyWorkspaceScreen si 0 workspace
│   ├── Header.tsx · Breadcrumb.tsx  # Fil d'ariane (via buildBreadcrumb), recherche/réglages/avatar
│   ├── Sidebar.tsx                  # Sections, arborescence, Récents, DnD de pages
│   │                                #   3 boutons de ligne au survol : Options / + / 🗑
│   ├── PageOptionsPanel.tsx         # Réglages d'UN élément de l'arbre : renommer, et —
│   │                                #   si c'est un tableau — les règles d'accès aux
│   │                                #   colonnes. ⚠️ SEUL chemin depuis un board kanban
│   │                                #   ⚠️ PageTree.tsx n'existe plus : l'arbre est intégré ici
│   ├── SearchPalette.tsx            # Palette Cmd/Ctrl+K : pages + records, avec chemin d'accès
│   ├── TrashSection.tsx             # Corbeille dans la sidebar : restaurer / purger
│   ├── Editor.tsx                   # BlockNote page : autosave, upload d'images, liens @page,
│   │                                #   conversion en database
│   ├── EditorClient.tsx             # Wrapper dynamic({ssr:false}) — BlockNote ne rend pas au SSR
│   ├── WorkspaceSelector.tsx · EmptyWorkspaceScreen.tsx · EmojiPicker.tsx · VisitRecorder.tsx
│   ├── ui/Dialog.tsx                # Modale accessible (portal, focus trap, Échap) — pilotée par DialogContext
│   ├── templates/TemplatesManager.tsx
│   └── databases/
│       ├── DatabaseShell.tsx        # Tabs de views + toolbar (sort/filter/compteur) + branching de vue
│       ├── TableView.tsx            # Table (édition inline, DnD rows, resize colonnes)
│       ├── KanbanView.tsx           # Kanban (DnD cards, sprint-aware via config.sprintScope)
│       ├── CalendarView.tsx · GalleryView.tsx
│       ├── BacklogView.tsx          # Backlog Jira : lanes sprint/backlog, points, épics, démarrer/terminer
│       ├── RecordPanel.tsx          # Slide panel : onglets « Contenu » (corps libre OU sectionné)
│       │                            #   et « Historique » (révisions, fetch paresseux) + menu modèle
│       ├── Cell.tsx                 # Édition inline par type (+ SelectBadge, réutilisé ailleurs)
│       ├── BulkActionBar.tsx        # Barre flottante de sélection multiple (N PATCH optimistes)
│       ├── SelectCheckbox.tsx       # Case de multi-sélection ronde, partagée Table/Kanban
│       ├── CardActions.tsx          # Dupliquer / Supprimer au survol — les 5 vues.
│       │                            #   `onDelete` OPTIONNEL : Galerie et Calendrier
│       │                            #   n'exposent que la duplication
│       ├── PropertyPopover.tsx · AddPropertyModal.tsx · SortControls.tsx · FilterControls.tsx
│       └── portal.tsx               # Composant Portal partagé
└── lib/
    ├── prisma.ts                    # Singleton PrismaClient
    ├── session.ts                   # getSession(), createSession, hashToken (sha256), SESSION_COOKIE
    ├── oidc.ts                      # OIDC/Keycloak : discovery, verifyIdToken, appOrigin,
    │                                #   accountConsoleUrl (<issuer>/account — ⚠️ JAMAIS dérivée
    │                                #   d'endpoints() de keycloak.ts, qui substitue l'URL INTERNE),
    │                                #   flags oidcEnabled/legacyLoginEnabled/registrationEnabled,
    │                                #   normalizeEmail (trim+lowercase, utilisé aussi par le pont MCP)
    ├── rateLimit.ts                 # Rate-limit mémoire du login (IP+email) → 429.
    │                                #   Porte aussi recipientKey/recipientAllowed : le budget par
    │                                #   DESTINATAIRE est partagé par toutes les portes d'envoi
    ├── workspace.ts                 # getMembership, createWorkspaceWithDefaults, isPageAccessible,
    │                                #   check{Database,Property,Record,View,Sprint}Access,
    │                                #   hasRole/hasRoleInAnyWorkspace (gates de rôle),
    │                                #   updateMemberRole/removeMember (garde « dernier admin »)
    ├── positions.ts                 # nextPosition(model, where, client?) → MAX(position) + 1000
    ├── pages.ts                     # createPage, setPageSection (synchro récursive visibility),
    │                                #   appendReleaseNotesToPage, deleteSectionReassigningRoots
    ├── trash.ts                     # trash/restorePageSubtree, purgeExpiredTrash (30 j)
    ├── uploads.ts                   # Chemin, MIME, garde anti-traversée, purgeOrphanUploads
    ├── db.ts                        # Types (PropertyType, ViewConfig, ParsedRecord, RecordSection…),
    │                                #   parse*/serialize*, mergeRecordProperties, removePropertyKey,
    │                                #   stripRecordBody, diff/parse des révisions
    ├── relations.ts                 # validateRelationValues (intégrité des propriétés relation)
    ├── assignees.ts                 # validateUserValues (les assignés sont-ils membres de l'espace ?)
    ├── mailer.ts                    # Transport email (API HTTP Brevo). Union non-levante, timeout 8 s,
    │                                #   AUCUNE adresse dans les journaux. Clé vide = envoi désactivé
    ├── invitationEmail.ts           # Contenu des emails d'invitation/d'ajout (pur, testable, échappé)
    ├── keycloak.ts                  # Comptes IdP (API admin Keycloak) : provisionIdpAccount,
    │                                #   listIdpAccounts, setIdpAccountEnabled. Unions non-levantes.
    │                                #   ⚠️ AUCUNE suppression exposée (realm partagé, pas de backup)
    ├── propertyConfig.ts            # validatePropertyConfig (zod), removedOptionIds,
    │                                #   findReferencedOptionIds (nettoyage d'options select supprimées)
    ├── propertyColors.ts            # SELECT_COLORS (palette des options select)
    ├── templates.ts                 # Templates fournis (builtin-scrum/ticket/bug), emptySectionsBody
    │                                #   ⚠️ leur colonne « Assigné » est de type `user` depuis le 04/08 :
    │                                #   les databases scaffoldées AVANT gardent leur colonne texte
    ├── tree.ts                      # buildTree, buildBreadcrumb, collectSubtreeIds,
    │                                #   toggleBranchCollapsed, searchResultPathSegments
    ├── avatar.ts · appConfig.ts     # Couleur/initiales d'avatar · config runtime (quota d'upload)
    └── client/                      # ⚠️ Client uniquement (jamais importé côté serveur)
        ├── viewFilters.ts           # applyFilters, applySorts, applyViewConfig, deriveSeedFromFilters,
        │                            #   resolveFilterTokens (jeton « @me » → utilisateur courant)
        ├── blocknoteSchema.tsx      # Schéma BlockNote partagé : inline content « pageLink » (@page)
        │                            #   + menu de suggestion. Importé par Editor ET RecordPanel
        ├── upload.ts                # uploadFile() branché sur BlockNote (coller/glisser une image)
        ├── useWorkspaceMembers.ts   # Membres de l'espace de la DATABASE (≠ workspace de session)
        │                            #   pour les cellules/filtres « utilisateur ». Clé SWR partagée
        │                            #   avec Réglages → Membres
        ├── kanban.ts                # Logique pure du kanban (ids DnD, valeur de groupe au drop,
        │                            #   buildKanbanColumns : colonnes depuis des « graines »
        │                            #   INJECTÉES — options select OU membres de l'espace)
        ├── reorder.ts               # intermediatePosition() : position entre deux items au drop
        ├── debouncedSaver.ts        # createDebouncedSaver — le debounce d'autosave, testable
        ├── dialogController.ts      # Machine à états des dialogues (logique pure de DialogContext)
        ├── useThemeMode.ts          # light/dark déduit de la luminance de --bg (prop theme de BlockNote)
        └── useRecordDeepLink.ts     # Lien profond vers un record (?r=<id>)
```

**Conventions de lecture de cet arbre**

- La logique **pure et testable** est systématiquement extraite dans `lib/` (`client/kanban.ts`, `client/dialogController.ts`, `client/reorder.ts`, `propertyConfig.ts`…) pour être couverte par Vitest sans DOM. Avant d'écrire un helper dans un composant, vérifie qu'il n'est pas déjà là.
- `lib/client/**` ne doit **jamais** être importé depuis une route API ou un Server Component.
- Les deux éditeurs BlockNote (page et record) partagent `lib/client/blocknoteSchema.tsx` et `lib/client/upload.ts` : toute évolution de l'éditeur se fait là, pas en dupliquant dans `Editor.tsx` et `RecordPanel.tsx`.

### Signatures des helpers (à respecter au mot près)

```ts
// lib/positions.ts — arguments POSITIONNELS, pas un objet.
nextPosition(
  model: "databaseProperty" | "record" | "view" | "sprint",
  where: { databaseId: string },
  client?: PositionClient    // client de $transaction : rend atomiques le MAX(position)
): Promise<number>           // et le create qui suit. Défaut : le client global.

// lib/workspace.ts — 3e paramètre pour atteindre les éléments en corbeille.
checkDatabaseAccess(databaseId: string, userId: string, includeTrashed = false)
checkRecordAccess(recordId: string, userId: string, includeTrashed = false)
checkPropertyAccess(propertyId: string, userId: string)
checkViewAccess(viewId: string, userId: string)
checkSprintAccess(sprintId: string, userId: string)

// lib/workspace.ts — gates de rôle. hasRole est PUR (renvoie false, ne lève pas) ;
// il s'applique au membership renvoyé par les check*Access ou getMembership.
hasRole(membership: { role: string } | null | undefined, required: WorkspaceRole): boolean
hasRoleInAnyWorkspace(userId: string, required: WorkspaceRole): Promise<boolean>
// Unions non-levantes façon setPageSection, transactionnelles (count + write atomiques) :
updateMemberRole(workspaceId, targetUserId, role): Promise<{ ok: true; membership } | { ok: false; code: "not_found" | "last_admin" }>
removeMember(workspaceId, targetUserId): Promise<{ ok: true } | { ok: false; code: "not_found" | "last_admin" }>

// lib/pages.ts — setPageSection NE LÈVE PAS : elle renvoie une union à narrower.
createPage(input: CreatePageInput)   // objet : { title?, parentId?, workspaceId, ownerId, sectionId? }
setPageSection(pageId: string, input: SetPageSectionInput):
  Promise<{ ok: true; page } | { ok: false; code: "page_not_found" | … }>

// lib/client/viewFilters.ts — l'ordre des arguments compte (records, config, properties).
applyViewConfig(records: ParsedRecord[], config: ViewConfig, properties: ParsedDatabaseProperty[])
```

## Conventions des routes API

- **Auth** : `getSession()` → 401 si null. **Exception : `/api/auth/*` est public** (`src/proxy.ts > PUBLIC_PATHS`) — ces routes *créent* la session, elles ne peuvent pas la lire. Leur garde est un flag d'env (`LEGACY_LOGIN`, `REGISTRATION`, OIDC) → **403** si la fonctionnalité est désactivée, **429** sur rate-limit login.
- **Accès** : helpers `check*Access` de `lib/workspace.ts` → **404** si pas d'accès. Ils ne couvrent que les entités de database (`checkDatabaseAccess`, `checkPropertyAccess`, `checkRecordAccess`, `checkViewAccess`, `checkSprintAccess`). Pour **page / section / workspace / trash / search : pas de helper** (ne cherche pas un `checkPageAccess`, il n'existe pas) → `getMembership()` + contrôle de confidentialité (`isPageAccessible`, ou `visibility === "private" && ownerId !== user.id`), 404 également.
- **404, jamais 403 pour l'ACCÈS à une ressource** (ne pas leaker l'existence : non-membre ou page privée d'autrui → 404). Les 403 du projet sont fonctionnels : **rôle insuffisant** (`{ error: "Rôle insuffisant" }` — le membre voit déjà la ressource en lecture, l'action est refusée ; **ordre obligatoire : check d'accès → 404 PUIS check de rôle → 403**), fonctionnalité désactivée (`/api/auth/login|register`) et refus anti-CSRF du proxy (`Origin` cross-site sur une mutation).
- **Corbeille (soft delete)** : `DELETE /api/pages/[id]` et `DELETE /api/records/[id]` estampent `trashedAt` — ils ne suppriment PAS. `?permanent=1` = suppression définitive depuis la corbeille. Les `check*Access` masquent le trashé par défaut → passer `includeTrashed = true` (3e arg) pour le cycle de vie corbeille. Toutes les lectures (arbre, search, records, recent) filtrent `trashedAt: null`.
- **`PATCH /api/me` — l'EMAIL n'est PAS modifiable, et ce n'est pas un oubli.** C'est la clé de liaison avec l'IdP : le callback OIDC retrouve le compte par `email`, et le claim d'invitation repose dessus. Le laisser changer depuis notes ferait qu'à la connexion suivante la personne serait soit **refusée** (`OIDC_ALLOW_SIGNUP=false`, aucune invitation vivante), soit **provisionnée comme un NOUVEAU compte** — sans ses memberships, ses pages privées possédées ni son historique. Un changement d'adresse part de l'IdP. La route est par ailleurs **sans gate de rôle** (on ne modifie que soi-même, l'id vient de la session — même famille que `visit` et `switch`), et **refuse un compte de service** en 409 : le pont MCP passe par `getSession()` comme tout le monde, la garde ne peut donc pas reposer sur l'absence d'UI.
- **Rattachement inter-workspace** : une route qui reçoit un id de rattachement (`parentId`/`sectionId` de `POST /api/pages`) doit vérifier qu'il appartient bien au `workspaceId` contrôlé — le rôle est vérifié sur CE workspace, sinon on écrirait dans l'arborescence d'un espace où l'on n'est que lecteur. Même réflexe que `patchNotesPageId` et les propriétés `relation`. ⚠️ **Le contrôle d'espace ne SUFFIT PAS** (corrigé le 08/08) : `POST /api/pages` applique aussi `isPageAccessible` au **parent**. Sans lui, un éditeur créait une sous-page sous la page **privée** d'un autre membre — `createPage` recopie la `visibility` du parent, donc l'enfant naissait privé au nom du créateur, planté dans un arbre que son propriétaire ne verrait jamais, et remonté en **racine orpheline** chez le créateur (`buildTree` remonte un nœud dont le parent est absent de la map). 404, jamais 403.
- **Validation** : zod, schema en haut du fichier. Exceptions : `POST /api/upload` lit un `FormData` (pas de JSON), `/api/auth/*` et `POST /api/pages` valident à la main.
- **JSON fields** : JAMAIS de `JSON.parse/stringify` direct dans les routes → toujours les helpers `parse*/serialize*` de `lib/db.ts`. (Seul `templates/*` sérialise `columns`/`sections` à la main — pas de helper dédié pour `Template`.)
- **Réponse succès** : objet parsé direct (pas wrappé dans `{ data: ... }`). **201** sur les créations d'entités database (database, record, duplicate, property, view, sprint, template) ; les routes historiques (pages, sections, workspaces) répondent 200. Deux sorties non-JSON : `GET /api/files/[name]` renvoie des **octets bruts**, `/api/auth/oidc/*` renvoie des **redirections** (erreur → `/login?sso_error=<code>`).
- **Réponse erreur** : `{ error: "message" }` ou `{ error: "Validation failed", details: zodFlattenedErrors }`. Codes métier en usage : **409** (page déjà database, sprint déjà actif, email pris, dernière section, restore sous page trashée), **422** (clôture de sprint : réconciliation des issues, page « Patch notes » illisible), **413/415** (upload), **429** (login).
- **Position** : `nextPosition(model, where, tx)` — models `databaseProperty | record | view | sprint`. **Appeler DANS le `prisma.$transaction` de la création, avec le client `tx` en 3e argument** : hors transaction, deux créations concurrentes lisent le même `MAX(position)` et collisionnent.
- **Effets de bord sur GET** (self-host, pas de cron) : `GET /api/config` purge les uploads orphelins > 30 j, `GET /api/trash` purge la corbeille expirée > 30 j. **Acte SYSTÈME assumé** (décision 03/08) : la purge TTL se déclenche quel que soit le rôle de l'appelant, lecteur inclus — les 30 j sont consommés, le GET n'est que le déclencheur opportuniste.
- **Pas de filtres/tris côté serveur** : tous les records sont retournés (hors corbeille : `trashedAt: null`), le client filtre en JS via `applyViewConfig()`. **Exception assumée** — `GET /api/databases/[id]/records` accepte des params **optionnels** pour les consommateurs sans `applyViewConfig` : `filter` (JSON `ViewFilter[]`, appliqué via `applyFilters` — pas de réimplémentation), `limit` (1-200) / `offset` (total pré-pagination dans l'en-tête `X-Total-Count` ; le corps reste un **tableau nu**), `includeContent=false` (omet `content`/`sectionsBody` via `stripRecordBody`). **Sans aucun param, la réponse est identique à l'historique** → le front n'est pas impacté. ⚠️ Ces params ont été faits « pour le MCP » mais le MCP ne les utilise pas encore (`notes_tools.py > list_records` appelle la route nue).

## Conventions UI

- **Server Components par défaut**. `"use client"` uniquement si état, effets, ou event handlers.
- **Tailwind** : classes inline, pas de `@apply`, pas de CSS modules.
- **Fetch client** : SWR, clé = URL de l'API. Après mutation, `mutate(key)`.
- **Pas de state global** (Zustand, Redux). SWR + useState local suffisent.
- **Optimistic updates** partout : mutate le cache SWR avant le fetch, rollback en cas d'erreur.
- **Portals** : les dropdowns/popovers utilisent `createPortal` vers `document.body` (le `overflow` des conteneurs couperait sinon les éléments absolus).
- **Drag-and-drop** : **`MouseSensor` (`distance: 6`) + `TouchSensor` (`delay: 250, tolerance: 6`)**, partout (sidebar, table, kanban, backlog, options select). ⚠️ **Plus de `PointerSensor`** (convention d'avant le 06/08) : au doigt, le navigateur revendiquait le geste pour le défilement et émettait `pointercancel`, donc le drag ne s'armait quasiment jamais — ni fiable, ni franchement désactivé. Le `delay` est ce qui distingue un appui long (« je déplace ») d'un glissement (« je scrolle »). **Exception : les onglets de vues de `DatabaseShell` gardent `MouseSensor` SEUL** — leurs listeners couvrent tout l'onglet dans une bande `overflow-x-auto`, les rendre draggables au doigt interdirait d'atteindre les vues 4 et 5. ⚠️ Pas de `touch-none` sur les lignes de l'arbre de la sidebar : elles couvrent presque toute la surface, `touch-action: none` y interdirait de faire défiler la liste (le `TouchSensor` pose lui-même son listener non-passif une fois le drag armé).

## Autosave

L'éditeur BlockNote debounce 500-600ms sur `onChange` et envoie un PATCH. Même pattern dans RecordPanel pour le contenu des records. Ne touche pas à cette logique sans raison.

## Bugs connus

- **Écritures SQLite coupées par le watcher `next dev`** — symptôme historique : ECONNRESET côté serveur + NetworkError client au drag-and-drop d'une page vers le haut dans la sidebar, alors que la donnée était bien écrite en DB. Cause retenue : better-sqlite3 écrit `dev.db-wal` **dans le dossier projet**, watché par Next.js dev → Fast Refresh en plein PATCH.
  **Mitigation appliquée, non re-testée** : la DB de dev vit désormais HORS du repo (`DATABASE_URL` de ton `.env` local ; l'astuce est documentée dans `.env.example`) et le harnais E2E fait pareil (`tests/e2e-server.mjs` → `os.tmpdir()`). Traite donc ce point comme *mitigé*, pas comme *prouvé disparu*. **Si le symptôme réapparaît, vérifie d'abord que `DATABASE_URL` ne pointe pas dans le repo** avant de chercher ailleurs.
- **Environnement de dev** (note, pas un bug) : le développement se fait en **Windows natif**. L'ancienne entrée « Turbopack + WSL2 » (nouveaux fichiers non détectés sur les mounts `/mnt/c/...`) est **sans objet** dans cette configuration ; elle ne redeviendrait vraie que si le projet repassait sous WSL sur `/mnt/c` — auquel cas : travailler dans le FS natif WSL (`~/projects/...`).

## Thème (couleurs)

- **Un seul système** : attribut `data-theme` sur `<html>` (≈12 thèmes : light, sepia, rose, dark, midnight, ocean, forest, nord, tokyo, dracula, catppuccin, gruvbox), posé au SSR depuis le cookie `app-theme` (`app/layout.tsx`), piloté par **Settings → Apparence**. Chaque thème définit `--bg`, `--surface`, `--surface-hover`, `--surface-active`, `--border`, `--text`, `--text-muted`, `--accent` dans `globals.css`.
- **NE JAMAIS utiliser les classes Tailwind `dark:`** : il n'y a pas de `@custom-variant dark`, donc `dark:` suit le `prefers-color-scheme` de l'OS — pas le thème choisi. Styliser via `text-[var(--text)]`, `bg-[var(--surface)]`, etc.
- **BlockNote** suit le thème via la prop `theme={useThemeMode()}` (`lib/client/useThemeMode.ts`, déduit light/dark de la luminance de `--bg`) ; les variables `--bn-colors-*` sont mappées sur la palette du site dans `globals.css` (`html[data-theme] .bn-root`).
- **Curseur** : Tailwind v4 ne met plus `cursor:pointer` sur les `<button>` → règle de base globale dans `globals.css` (`button:not(:disabled)…`).

## Déploiement

- **CI** : `.github/workflows/ci.yml` — jobs `build` (Next + Prisma), `test` (Vitest unit/API) et `e2e` (Playwright). Un test rouge bloque la CI (condition DoD). **Déclencheurs** : au *push* sur `main`, `feat/**`, `fix/**`, `docs/**` et `chore/**` ; le `pull_request:` n'a aucun filtre et couvre donc **toutes** les branches. Une branche nommée hors de ces préfixes ne déclenche donc rien au push — sa CI n'arrive qu'à l'ouverture de la PR. Ne jamais conclure « CI verte » sans avoir vu un run.
- **CD** : `.github/workflows/deploy.yml` — sur push `main` (ou `workflow_dispatch`), SSH sur le Pi (secrets repo `SSH_HOST`/`SSH_USER`/`SSH_KEY`), `git reset --hard origin/main` + `docker compose up -d --build`, puis attend que le conteneur `gotyeah_notes` soit `healthy` (healthcheck node défini dans `docker-compose.yml`). ⚠️ **Un push sur `main` déclenche un déploiement réel**, à une exception près : `paths-ignore: ["**.md"]` — un push ne touchant QUE des `.md` ne déploie pas. Un commit mêlant doc et code déploie quand même.
- **Snapshot backup AVANT chaque MEP** (filet de sécurité) : le script SSH prend un snapshot SQLite via `sqlite3 .backup` (cohérent sous WAL) `--user 0:0` dans `/home/pi/backups/gotyeah-notes/`, + `PRAGMA integrity_check`. **Un échec du snapshot arrête le déploiement** (avant `docker compose up`). ⚠️ Ne PAS mettre d'étape best-effort dans le `script:` de `deploy.yml` : `appleboy/ssh-action` (`script_stop`) coupe la MEP au moindre code non nul, quelles que soient les gardes shell (`set +e`/`|| true`). Rotation des snapshots (7 j) + réplication restic hors-Pi = **cron dédié sur le Pi** (hors chemin critique, cf. README §Sauvegardes).
- ⚠️ **VÉRIFIÉ ET RÉPARÉ le 07/08/2026 — les deux moitiés de la ligne ci-dessus étaient FAUSSES.** Cette phrase décrivait une intention, jamais un état : (a) aucun cron ne purgeait `/home/pi/backups/gotyeah-notes/`, qui accumulait 40 snapshots depuis le 11 juillet ; (b) surtout, **notes n'apparaissait NULLE PART dans `/opt/backup/backup-daily.sh`** — ni sa base, ni ses uploads. Le seul filet était les snapshots pré-MEP, **sur le même NVMe que la base** : disque mort, tout perdu. Le backup quotidien tournait pourtant très bien pour yoga, npm, Home Assistant, le bistrot et Keycloak. C'est le mode de panne habituel de ce projet — une garde qu'on croit active et qui ne l'est pas — appliqué cette fois à la sauvegarde elle-même. Réparé : `SQLITE_NOTES` + `sqlite_backup` (dump `.backup` cohérent à chaud, jamais un `cp`), le dossier `uploads/` ajouté à `RESTIC_PATHS` (créé vide au passage — il n'existait pas, et un chemin absent aurait cassé le script sous `set -euo pipefail`), et un cron de rotation à 5h30. **Vérifié dans le dépôt restic** : `sqlite/gotyeah-notes.db` (9,8 Mo, non vide) présent dans le snapshot du 07/08 22:37. ⚠️ **Restaurer n'a JAMAIS été essayé** — une sauvegarde non restaurée n'est pas une sauvegarde ; c'est le prochain exercice, sur une copie.
- Le schéma Prisma est appliqué au déploiement par le service one-shot `migrate` via **`prisma migrate deploy`** — migrations VERSIONNÉES (`prisma/migrations/`), plus jamais de `db push` en prod (qui pouvait inférer des `DROP`). Bascule faite le 05/08/2026 (PR #23), baseline `0_init` marquée appliquée sur la prod avant le merge. ⚠️ **`0_init` est FIGÉE** : une migration déjà appliquée n'est jamais rejouée et son checksum n'est pas revérifié — la modifier donnerait un déploiement VERT sur un schéma incomplet, l'erreur n'apparaissant qu'à la première requête. Toute évolution passe par une NOUVELLE migration (`npx prisma migrate dev --name …`) ; deux jobs CI le gardent (*Migrations en phase avec le schéma*, *Baseline figée*). ⚠️ En Prisma 7, comparer la base réelle aux migrations se fait avec `--from-config-datasource` — `--from-url` N'EXISTE PLUS (la commande imprime son aide et sort en 1).
- `postinstall` = `prisma generate` (jamais `db push` : aucune opération destructive à l'install).
- ⚠️ Le build Docker tourne **sur le Pi** (RAM-intensif sur arm64 → pics swap au déploiement). Voir *Reste à faire* (builder en CI).

### Sécurité (auth/API, lot livré 2026-07-11)

Instance exposée durcie — variables d'env associées (défauts sûrs, cf. `.env.example` / `docker-compose.yml`) :
- **`REGISTRATION`** (défaut `off`) : inscription publique par formulaire fermée. `on` pour rouvrir `POST /api/auth/register`. Découplée de `LEGACY_LOGIN` et de l'OIDC.
- **`MCP_ACT_AS_ALLOWLIST`** (défaut vide = comportement historique) : liste d'emails (séparés par virgule) que le pont MCP peut incarner ; hors liste → refus + log d'audit. Injectée au conteneur depuis la PR #38 (18/07/2026) et **renseignée en prod le 05/08/2026** (3 entrées, dont `ia@gotyeah.local`) : c'est seulement depuis cette date que la garde exclut quelqu'un — injectée mais vide, elle laissait passer n'importe quel User existant.
- **Tokens de session hachés** (sha256) : `Session.id = hashToken(token)`, jamais le token en clair ; purge des expirées (`@@index([expiresAt])`). Le déploiement de ce changement déconnecte tout le monde une fois.
- **Login** : rate-limit mémoire (IP+email) → 429 ; anti-énumération (bcrypt factice sur email inconnu, même message/temps). Emails normalisés (`normalizeEmail` = trim+lowercase) sur register/login/act-as.
- **Ajout de membre** (`POST /api/workspaces/[id]/members`) : même `lib/rateLimit.ts`, clé **`members:<userId>`** (⚠️ préfixe obligatoire — le login partage la Map avec des clés `ip:email`). Seuls les **404 « compte inconnu »** sont comptés (le signal de sondage ; un ajout réussi fait `clearFailures`) et journalisés (`[members-add-unknown]`). Le message explicite est CONSERVÉ — une typo d'email doit rester visible. ⚠️ Limite assumée : mémoire + mono-instance, remis à zéro à chaque redéploiement — ça rend le balayage impraticable, pas impossible ; fermer vraiment l'oracle demanderait un flux d'invitation avec acceptation.
- **Headers** (`next.config.ts`) : `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, `Referrer-Policy`. **Anti-CSRF** (`src/proxy.ts`) : une mutation `/api/*` avec `Origin` cross-site est refusée (403) ; GET, same-origin et pont MCP passent.

### Variables d'environnement

Toutes les variables réellement lues (`process.env`). Source de vérité : `.env.example` (local) + bloc `environment:` de `docker-compose.yml` (conteneur). ⚠️ Le compose n'utilise **pas** `env_file` : une variable absente de son bloc `environment:` **n'atteint jamais le conteneur**, même posée dans le `.env` du Pi.

| Variable | Lue dans | Défaut | Si absente |
|---|---|---|---|
| `DATABASE_URL` | `lib/prisma.ts` | `file:./prisma/dev.db` | OK en conteneur (fixée par le compose) ; requise en local pour le CLI Prisma |
| `OIDC_ISSUER` / `_CLIENT_ID` / `_CLIENT_SECRET` / `_REDIRECT_URI` | `lib/oidc.ts` | `""` | Bouton OIDC masqué (`oidcEnabled()` exige les **4**) — dégradation propre, pas d'erreur |
| `OIDC_ALLOW_SIGNUP` | `lib/oidc.ts` | `"true"` (code) / **`"false"`** (compose) | ⚠️ Défauts DIVERGENTS à dessein : le code reste permissif pour un self-host sans invitations, le conteneur est durci. À `"false"`, seule une invitation vivante permet la création du compte |
| `BREVO_API_KEY` | `lib/mailer.ts` | vide | **Envoi désactivé** — les invitations sont créées, personne n'est prévenu (l'écran Membres le dit). Aucune surface ajoutée |
| `MAIL_FROM` / `MAIL_FROM_NAME` | `lib/mailer.ts` | `notes@localhost` / `GotYeah Notes` | Expéditeur. Doit être **vérifié côté Brevo**, sinon 400 et rien ne part |
| `APP_BASE_URL` | `lib/mailer.ts` | vide → `appOrigin()` | Origine des liens d'email. ⚠️ Jamais dérivée de l'en-tête `Host` : elle est contrôlée par l'appelant |
| `KEYCLOAK_ADMIN_CLIENT_ID` / `_SECRET` | `lib/keycloak.ts` | vides | Gestion des comptes SSO **désactivée** : `configured: false`, aucun bouton dans Réglages → Membres, et les routes `/idp` répondent 409. N'affecte PAS le parcours d'invitation (les invités entrent par le lien email). ⚠️ Client dédié au realm applicatif, `manage-users` + `view-users` uniquement |
| `IDP_ADMIN_EMAILS` | `lib/keycloak.ts` | vide | **Autorité d'INSTANCE** de la gestion des comptes SSO (emails, virgules). ⚠️ **Vide = personne** : les routes `/idp` répondent 403 et l'écran n'affiche aucun bouton. Le rôle admin d'un espace ne peut pas servir de garde ici — il est auto-attribuable |
| `KEYCLOAK_INTERNAL_URL` | `lib/keycloak.ts` | vide → base d'`OIDC_ISSUER` | Base interne pour l'API admin (`http://login-keycloak:8080`). ⚠️ Requise ici : `/admin/*` public est derrière Cloudflare Access (302). Le realm n'est **jamais** surchargé. **Vérifiée en prod le 07/08** : `client_credentials` → 200, realm `gotyeah` |
| `OIDC_BUTTON_LABEL` | `lib/oidc.ts` | `"Se connecter avec GotYeah"` | Libellé par défaut |
| `LEGACY_LOGIN` | `lib/oidc.ts` | `"on"` | Login email/mot de passe actif (break-glass) |
| `REGISTRATION` | `lib/oidc.ts` | `"off"` | Inscription publique fermée (défaut sûr) |
| `MCP_SHARED_SECRET` | `lib/session.ts` | vide | Pont MCP act-as **désactivé** (aucune surface ajoutée) |
| `MCP_ACT_AS_ALLOWLIST` | `lib/session.ts` | vide | N'importe quel User existant est incarnable |
| `UPLOAD_DIR` | `lib/uploads.ts` | `<cwd>/data/uploads` | En conteneur, doit valoir `/data/uploads` (volume) — sinon images perdues au rebuild |

- ⚠️ **Leçon de la PR #38** : `MCP_ACT_AS_ALLOWLIST` a été **inerte en prod du 11/07 au 05/08** — d'abord absente du bloc `environment:` (une semaine), puis présente mais **vide** trois semaines de plus, ce qui revient au même : tout User existant restait incarnable. Une garde qu'on croit active et qui ne l'est pas est pire que pas de garde, et le second temps est le plus traître : la variable est là, le diff est vert, seule la VALEUR manque. Réflexe : toute nouvelle variable lue par `src/` est ajoutée AU MÊME MOMENT dans `.env.example` **et** dans `docker-compose.yml` — et une garde n'est déclarée livrée qu'après avoir lu sa valeur DANS le conteneur.
- ⚠️ **Même piège, autre forme (PR #49, 05/08/2026)** : un **argument optionnel à défaut sûr** dégrade aussi en silence. `isPageAccessible(page, userId, isService = false)` avait été câblé dans 14 appels sur 16 au lot C ; les deux oubliés, tous deux dans `app/api/databases/`, rendaient le compte de service muet sur ces routes — CI verte, tests au vert, aucune trace. Ce n'est pas un test qui l'a rattrapé mais un usage réel. Le garde de `service-account.test.ts` vérifie désormais l'**arité** des appels à `isPageAccessible` / `pageVisibilityFilter`, pas seulement l'absence de test de confidentialité réécrit à la main.
- ⚠️ **Troisième forme du même piège (05/08/2026)** : changer un **défaut dans `docker-compose.yml` ne change rien** si la variable est **figée dans le `.env` du Pi** — `${VAR:-défaut}` ne s'applique qu'en son absence. C'est le cas de `OIDC_ALLOW_SIGNUP`, présent dans ce `.env` : le durcissement à `false` livré avec le lot invitations **exige une édition manuelle du `.env` du Pi**, sinon le compose continue de lire `true` et le provisioning reste grand ouvert, diff vert à l'appui. Réflexe : après tout changement de défaut, lire la valeur **dans le conteneur** (`docker exec … printenv VAR`), jamais dans le fichier du dépôt.
- `NODE_ENV` (flag `secure` des cookies) est posé par Next et le Dockerfile — ne pas le définir à la main. `E2E_PORT`, `PORT` et `CI` ne servent qu'aux tests.
- ⚠️ **`AUTH_SECRET` n'est lue nulle part dans `src/`.** Elle n'existe que comme placeholder dans `ci.yml`, `vitest.config.ts` et `tests/e2e-server.mjs` (vestige d'un design d'auth abandonné). Ce n'est pas une variable de configuration : elle n'a aucun effet.

## Intégration MCP (outils notes_*)

- Les outils MCP de gotyeah-notes vivent dans le dépôt **`gotyeah-mcp`** (`gotyeah-mcp/mcp_remote/notes_tools.py`), **greffés sur le hub MCP Sonar** (et **pas** un serveur séparé) : on réutilise son OAuth fédéré à l'IdP **Keycloak** déjà branché dans claude.ai (volonté : ne pas dupliquer l'auth). ⚠️ Le code MCP a été **consolidé de `gotyeah_sonar` vers `gotyeah-mcp`** (commit `6f80180`, 2026-07-01) : ne plus toucher `gotyeah_sonar` pour les outils `notes_*`.
- **Pont de confiance** : `lib/session.ts > getSession()` accepte, à défaut de cookie valide, un appel du MCP via `X-MCP-Secret` (== env `MCP_SHARED_SECRET`, comparaison constant-time) + `X-Act-As-Email` → mappé sur un **User existant** (email normalisé trim+lowercase). Entièrement **OFF tant que `MCP_SHARED_SECRET` est vide** → aucune surface ajoutée par défaut. L'auth web cookie/password est inchangée. **Allowlist optionnelle `MCP_ACT_AS_ALLOWLIST`** (emails séparés par virgule) : si définie, seuls ces emails sont incarnables (sinon refus) ; chaque incarnation est journalisée (`console.info('[mcp-act-as]…')`).
- ⚠️ **`src/proxy.ts` est le middleware** (Next 16 a renommé `middleware` → `proxy`). Il s'exécute AVANT les routes et 401-ait tout `/api/*` sans cookie : il **laisse passer** les appels portant `x-mcp-secret` + `x-act-as-email` (la validation autoritaire reste dans `session.ts`). Toute future auth par en-têtes doit aussi être whitelistée là.

### Les 50 outils `notes_*` (état du code, `remote.py`)

> La surface est décrite entité par entité dans **`gotyeah-mcp/mcp_remote/notes_entities.py`** (table `list/get/create/update/delete/restore`), avec la **raison** de chaque trou volontaire. Un outil non déclaré fait échouer `tests/test_notes_entities.py` : c'est la table, pas cette liste, qui fait foi.

- **Espaces (3)** : `notes_list_workspaces`, `notes_get_workspace`, `notes_create_workspace` (renvoie le workspace **avec ses sections par défaut**, pour enchaîner sans re-lister). ⚠️ **`delete_workspace` n'est pas exposé et ne le sera pas** (décision du 2026-07-30) : `DELETE /api/workspaces/[id]` cascade sans garde de vacuité — la suppression d'un espace se fait dans l'interface web. Renommer un workspace n'existe nulle part.
- **Pages / sections (11)** : `notes_list_pages`, `notes_get_page`, `notes_create_page`, `notes_update_page`, `notes_move_page`, `notes_delete_page`, `notes_search`, `notes_list_sections`, `notes_create_section`, `notes_update_section`, `notes_delete_section`.
  - `notes_move_page` change le SEUL rattachement (`parent_id` → sous-page · `section_id` → racine d'une section, l'un met l'autre à null) : ni recopie du `content`, ni suppression/recréation. Fournir les deux, ou aucun des deux, est refusé **avant** l'appel HTTP.
  - `notes_delete_section` expose la sémantique existante **sans ajout** : aucune page supprimée, les racines sont réaffectées à une autre section du même type. La réponse énumère la réaffectation (combien de pages, vers quelle section) — **observée** après coup, pas recalculée : dupliquer la règle de repli dans l'adaptateur serait du métier hors couche, et un mensonge le jour où elle changerait. Le 409 « dernière section de ce type » est traduit en consigne actionnable.
- **Corbeille (3)** : `notes_list_trash`, `notes_restore_page`, `notes_restore_record`. Sans eux, un agent croyait ses suppressions définitives — voir la note sur les descriptions ci-dessous.
- **Databases / propriétés / records / vues (20)** : `notes_get_database`, `notes_create_database`, `notes_delete_database`, `notes_set_record_template`, `notes_set_patch_notes_page`, `notes_create_property`, `notes_update_property`, `notes_add_select_option`, `notes_update_select_option`, `notes_remove_select_option`, `notes_delete_property`, `notes_list_records`, `notes_get_record`, `notes_create_record`, `notes_duplicate_record`, `notes_update_record`, `notes_delete_record`, `notes_list_record_revisions`, `notes_create_view`, `notes_update_view`, `notes_delete_view`. Une database EST une page → `notes_get_page` renvoie `database: {id}`. Les records se manipulent **par NOM** de propriété (traduit en ids + options select via le schéma, côté `notes_tools.py`).
  - `notes_update_property` ne fait que **renommer / réordonner** la colonne. Les options select se manipulent à part : `notes_add_select_option` (**idempotent**, add-only), `notes_update_select_option` (renommer / recolorer / réordonner — **l'id de l'option est conservé**, donc aucune carte n'est réécrite) et `notes_remove_select_option` (le serveur refuse si l'option est encore référencée par une carte ou une vue backlog ; le 400 est traduit). Changer le **type** d'une propriété est refusé par l'API (`400 type cannot be changed`) — c'est voulu, pas un manque.
- **Templates / modèles (8)** : `notes_list_templates`, `notes_create_template`, `notes_update_template`, `notes_delete_template`, `notes_create_database_from_template` (depuis n'importe quel template), `notes_create_ticket_database` / `notes_create_bug_database` (raccourcis builtins), `notes_set_record_template` (modèle de corps LIBRE d'une database). Les templates fournis (`builtin-*`) sont en **lecture seule** : `update`/`delete` refusent avant l'appel HTTP. ⚠️ `notes_update_template` remplace la liste de `sections` en ENTIER et regénère un id pour toute section sans `id` → repasser les ids existants (via `notes_list_templates`), sinon les cartes déjà sectionnées se décrochent.
- **Sprints / backlog (4)** : `notes_list_sprints`, `notes_create_sprint`, `notes_update_sprint` (state `active`=démarrer / `completed`=terminer ; avec `database_id` → renvoie les issues non terminées au backlog), `notes_delete_sprint`. Affecter une issue à un sprint : param `sprint` (par NOM, ou `"backlog"`) de `notes_create_record` / `notes_update_record`.
⚠️ **« Mes espaces » n'est PAS « les espaces que le MCP rend ».** Le pont incarne `ia@gotyeah.local`, et depuis le rattachement d'office ce compte est membre d'espaces où Gautier ne l'est pas (l'espace personnel d'un autre compte, par exemple). `notes_list_workspaces` porte donc un champ **`yours`** — vrai quand le porteur du jeton IdP est lui-même membre. Il n'est pas déduit : le MCP refait un `GET /api/workspaces` **en incarnant la personne** (le pont sait incarner par email vérifié), et c'est la réponse de l'API qui tranche. ⚠️ **Aucune route ne prend un `userId`** et il ne faut pas en ajouter : la portée vient de l'identité d'appel, jamais d'un paramètre — un `?userId=` serait une porte pour lire l'appartenance des autres. **Quand l'utilisateur dit « mes espaces », ne retenir que `yours: true`, et n'écrire dans un `yours: false` que s'il l'a nommé explicitement.** `yours: null` = on n'a pas pu savoir (porteur inconnu, ou email hors `MCP_ACT_AS_ALLOWLIST`) : demander, jamais supposer.

- **Membres (1)** : `notes_list_members` (userId / displayName / role, **jamais l'email** — le renvoyer diffuserait les adresses de l'espace à qui lit un board). Sert de source à la résolution des assignés par nom. Ajouté le 05/08/2026.

⚠️ **Réversibilité : ce que les descriptions doivent dire.** Côté notes, **seules `Page` et `Record` ont un `trashedAt`** : `notes_delete_page` / `notes_delete_record` mettent à la **corbeille** (restaurable 30 j), tout le reste est **définitif**. Les descriptions de ces deux outils annonçaient « Irréversible » — c'était faux, et un mensonge de description est pire qu'un outil manquant : le trou se voit, pas le mensonge. Corrigé le 2026-07-30, en même temps que `notes_delete_view` / `notes_delete_sprint` qui, eux, se **taisaient** sur une suppression pourtant définitive. Règle : toute description de suppression dit où va l'objet et comment le récupérer, ou qu'il n'y a pas de retour.

⚠️ **Le MCP ne couvre toujours pas toute l'API.** Sans outil dédié à ce jour : upload d'images (`/api/upload`, `/api/files/[name]` — **préalable bloquant** : aucune route notes ne supprime un fichier, il ne faut donc pas exposer l'upload avant de l'avoir construite), purge définitive de la corbeille (`?permanent=1`, volontairement hors MCP), config d'instance (`/api/config`), suppression et renommage de workspace. Ne conclus pas « la fonctionnalité n'existe pas » parce qu'aucun outil `notes_*` ne l'expose — et vérifie d'abord `notes_entities.py`, qui dit lesquels manquent **exprès**.

- **⚠️ Le pont incarne « IA » depuis le 05/08/2026** : `NOTES_ACT_AS_EMAIL=ia@gotyeah.local` dans le `.env` de `gotyeah-mcp` remplace l'email du porteur du jeton claude.ai pour TOUS les outils `notes_*` — les révisions des écritures MCP sont attribuées à « IA », plus à Gautier. Le compte `ia@gotyeah.local` est un **compte de service** (`User.isService`, cf. modèle) créé par `scripts/create-service-account.mjs`, membre admin de « Mon espace », listé dans `MCP_ACT_AS_ALLOWLIST`. Retirer la variable = retour au comportement historique.
- **Lot du 05/08** : résolution des assignés PAR NOM dans `notes_create_record`/`notes_update_record` (propriété `user` : displayName, email ou userId acceptés), adossée à `notes_list_members` (cf. rubrique *Membres*). La liste des membres n'est chargée que si un assigné est visé — un appel qui ne touche pas aux assignés ne paie pas cette requête.
- **Activation** (sur le Pi) : même secret dans les deux `.env` — `MCP_SHARED_SECRET` ici, `NOTES_API_BASE_URL=http://gotyeah_notes:3000` + `NOTES_MCP_SECRET` côté MCP (dépôt `gotyeah-mcp` ; les deux conteneurs sont sur le réseau `nginx-proxy-manager_default`) — puis `docker compose up -d` et rafraîchir le connecteur claude.ai. **✅ Actif en prod (2026-06-29)** ; l'email du User a été aligné sur le gmail (= email IdP).
- **Déploiement du MCP** : le Pi sert `gotyeah-mcp` en `fb687dc` (PR #6 « feat/user-assignees », 05/08/2026), connecteur claude.ai rafraîchi le même jour — les 50 outils répondent. Après tout ajout d'outil : push `gotyeah-mcp` sur `main`, redéploiement du conteneur, **puis** rafraîchissement du connecteur. L'oublier produit un outil en prod que le client ne propose pas, et qu'on relit à tort comme « pas déployé » : **vérifier un déploiement se fait sur le Pi (HEAD du dépôt), pas dans la liste d'outils**.
- Variables d'env : voir `.env.example`.

## Reste à faire

> L'historique git est la source de vérité de ce qui a été livré. Cette liste ne sert qu'à
> (a) éviter de refaire un lot déjà fait, (b) tracer ce qui reste. Si une ligne te semble
> en contradiction avec le code, **crois le code** et corrige la ligne.

### Livré (repères — détail dans `git log`)

- [x] ~~**Pont MCP + MCP v2/v3 (databases, records, templates, sprints, options select)**~~ : 2026-06-29 → 2026-07-17. 37 outils `notes_*` côté `gotyeah-mcp`, déployés, connecteur rafraîchi (49 depuis le lot CRUD du 2026-07-30, 50 depuis le lot assignés du 05/08). Voir *Intégration MCP*.
- [x] ~~**Système de modèles (templates)**~~ : 2026-06-30. Modèle `Template` (workspace), page `/templates`, corps sectionné à libellés fixes, scaffold `POST /api/databases {templateId}`.
- [x] ~~**Backlog façon Jira + cohabitation Board/Sprint**~~ : 2026-06-30. Vue `backlog`, modèle `Sprint`, kanban « sprint-aware » (`sprintScope`), un seul sprint actif (409), clôture renvoyant les issues non terminées au backlog.
- [x] ~~**Auth OIDC + `LEGACY_LOGIN`**~~ : 2026-07-02 (`0cee15f`, `33d47a7`). Connexion OIDC à côté du formulaire ; `LEGACY_LOGIN=off` = « comptes GotYeah uniquement » (c'est la valeur en PROD : il n'y a plus de login par mot de passe). L'IdP a d'abord été Pocket ID ; **c'est Keycloak aujourd'hui** (`https://login.gautierchuinard.com/realms/gotyeah`, vérifié le 05/08/2026) — le code ne connaît que de l'OIDC standard, la bascule n'a rien changé côté `src/`.
- [x] ~~**Corbeille (soft delete) + upload d'images local**~~ : 2026-07-10 (`e386d7c`, `4f2c08c`). `/api/trash`, `/api/records/[id]/restore`, purge auto 30 j ; `/api/upload` + `/api/files/[name]`, purge des orphelins 30 j.
- [x] ~~**Type de propriété « relation »**~~ : 2026-07-10 (`23a69f3`). Types, API et filtres.
- [x] ~~**Lot durcissement sécurité**~~ : 2026-07-11. Voir *Déploiement > Sécurité*. Inclut le **match email insensible à la casse** (`normalizeEmail` + `scripts/normalize-emails.mjs`).
- [x] ~~**Lot Discovery / éditeur / vues**~~ : 2026-07-16 → 2026-07-18. Liens internes `@page` (`5f8d38c`), duplication serveur atomique (`2cc0e48`), sélection multiple + actions groupées (`ca74c3b`), RecordPanel redimensionnable (`0e41983`), réordonnancement des onglets de vues (`a572d3e`), chemin des homonymes dans Cmd+K (`b2a6aa2`), repli récursif de la sidebar (`48666bb`), édition inline sur les cartes kanban (`1eb86a1`).
- [x] ~~**Historique des modifications d'un record**~~ : 2026-07-17 (`17c05d4`). Modèle `RecordRevision`, `GET /api/records/[id]/revisions`, onglet dédié dans le `RecordPanel`.
- [x] ~~**Notes de version (patch notes) de sprint**~~ : 2026-07-16/17 (`a919329`, `e00579a`, `a9e7927`). Générées à la clôture, auto-appendées à la page « Patch notes », affichage lecture seule dans le backlog. ⚠️ La fonctionnalité est restée **inerte jusqu'au 05/08** : `patchNotesPageId` valait `null` sur les 20 boards, et il n'existe **aucune UI** pour le poser (l'API, donc le MCP, est le seul chemin). Mappé ce jour-là sur le board Notes.
- [x] ~~**Compte de service « IA » + « Main à » en propriété `user` (lot C)**~~ : 2026-08-05 (PR #48 — `3d8445b`, `c538cac`, `92568a3`). `User.isService` et son exemption de confidentialité centralisée, migration `20260805000000_user_is_service` **appliquée en prod** (première jouée par le système de la #23), pont MCP incarnant `ia@gotyeah.local`, 22 databases migrées du select vers les membres (259 valeurs, 24 vues recâblées). Queue de lot : PR #49, les deux routes de `app/api/databases/` qui avaient perdu l'exemption.

### Reste

- [ ] **Builds hors Pi** : le build Docker tourne toujours **sur le Pi** (`deploy.yml` → `docker compose up -d --build`), RAM-intensif sur arm64. Cible : builder l'image en CI (`ci.yml` n'a aujourd'hui aucun job Docker) + `docker pull` au déploiement.
- [x] ~~**`MCP_ACT_AS_ALLOWLIST` absente du `docker-compose.yml`, puis vide**~~ : injectée le 18/07/2026 (PR #38), **renseignée dans le `.env` du Pi le 05/08/2026** — 3 emails, dont le compte de service `ia@gotyeah.local`, lus dans le conteneur `gotyeah_notes`. La garde filtre donc réellement. Corollaire : toute nouvelle incarnation doit être ajoutée ici au moment où on la crée, sinon le pont refuse en 401 et le MCP ne dit pas pourquoi.
- [x] ~~**MCP — édition fine des options select**~~ : fait (2026-07-30). `notes_update_select_option` (renommer / recolorer / réordonner) + `notes_remove_select_option` (refus serveur si l'option est encore référencée, traduit en consigne).
- [x] ~~**MCP — trous de la matrice CRUD (corbeille, sections, workspaces)**~~ : fait (2026-07-30), **déployé et visible côté connecteur**. 12 outils ajoutés, descriptions de suppression corrigées, table d'entités + test anti-régression (`notes_entities.py`).
- [x] ~~**Kanban regroupé par assigné + filtre « Moi » (lot B)**~~ : fait (04/08/2026). Axe `user` groupable (colonnes = membres, via `buildKanbanColumns`), colonne « Membre retiré » pour les assignés partis, jeton `@me` résolu client ET serveur.
- [x] ~~**`View.config.createInUnassignedOnly` sans UI**~~ : fait (04/08/2026). Bascule « Créer seulement dans « Sans valeur » » dans le menu ⋯ de l'onglet de vue (`DatabaseShell > TabMenu`), proposée uniquement sur une vue kanban.
- [x] ~~**Dupliquer — phase B**~~ : fait (04/08/2026). `CardActions` est désormais utilisé par les 5 vues ; son `onDelete` est **optionnel** (Galerie et Calendrier n'exposaient aucune suppression, ce lot n'en a pas inventé une).
- [x] ~~**Migrations Prisma versionnées**~~ : fait (05/08/2026, PR #23). Baseline `0_init` régénérée depuis le schéma courant, jouée sur la prod (snapshot + `migrate diff --from-config-datasource` → *No difference detected* → `migrate resolve --applied 0_init`), puis merge. Détail et garde-fous : cf. *Déploiement*. Le workflow `baseline-prisma.yml` n'a PAS pu servir à cette bascule (`workflow_dispatch` exige le fichier sur la branche par défaut, or il arrivait avec la PR) — il reste pour une re-baseline future.
- [x] ~~**CI aveugle sur `fix/**`, `docs/**`, `chore/**`**~~ : fait (18/07/2026, PR #39). `ci.yml` déclenche désormais au push sur `main`, `feat/**`, `fix/**`, `docs/**` et `chore/**`.
- [ ] (optionnel) UI Settings « Jetons d'accès » si un jour on veut un PAT en complément de l'IdP.

## Process de travail (Dev Loop)

Le process ne vit **pas** dans ce dépôt. Sa référence est la page **Dev Loop** du workspace notes (id `cmrci2y9i000b01nnmkel8m61`) — « document lu en premier par toute session IA » — complétée par le **Guide du process** (`cmrcjyk8w003w01nn3b0pkk7y`). Ce qui suit en est le strict nécessaire pour travailler dans ce repo ; en cas de doute, la page Dev Loop fait foi. Règle mère : **les notes font foi, pas la conversation** — ce qui n'est écrit ni dans une fiche ni dans un ticket n'existe pas.

### La boucle

Idée → fiche **Discovery** (inbox globale tous projets, `cmrci44xz000c01nnbg5iumkc`) cadrée par l'IA → **✅ Validée** par Gautier (go n°1) → l'IA crée le ticket dans le **📦 Board du projet** (ici database `cmri206zi009r01juyyyly8he`) → dev sur une branche → PR → merge `main` = **déploiement réel en production** (mécanique : cf. *Déploiement*). Les retours post-MEP réalimentent Discovery ou le Backlog.

**8 statuts** : Backlog · Cadrage · Prêt · En dev · Review / Tests · Recette préprod · À MEP · Terminé.

- **Réservés à Gautier** — « statuts de confirmation », l'IA n'y fait **JAMAIS** entrer une carte : **Validée** (Discovery), **Prêt**, **À MEP**, **Terminé**. Y entrer = sa signature.
- **Permis à l'IA** : `Backlog → Cadrage` (**sur ordre explicite uniquement** — l'IA ne s'auto-saisit jamais d'un ticket), `Prêt → En dev`, puis `En dev → Review / Tests → Recette préprod` en autonomie, **sous condition DoD** : CI verte, chaque critère d'acceptation couvert par un test, self-review du diff faite, section 🧾 Recette du ticket remplie (manipulation → résultat attendu), Cahier de tests à jour (cf. *Socle de test*). CI rouge → l'IA reboucle en dev, seule.
- **Fin de session ou blocage** : mettre à jour la section 🤝 État courant de la carte, passer `Main à = Gautier`, s'arrêter.
- **Ne jamais rien supprimer** (carte, fiche) : ce qu'on abandonne se range, ça ne s'efface pas. Côté **Discovery**, le statut « 🗑️ Abandonnée » est fait pour ça. Côté **📦 Board, il n'existe AUCUNE option d'abandon** (les 8 statuts du pipeline + « Déployé T1 / à contrôler », rien d'autre), et « Obsolète » n'existe sur aucune des deux databases : un ticket qu'on ne fera pas reste au **Backlog**, raison écrite dans 🤝 État courant, `Main à = Gautier`. Ne pas inventer l'option manquante — ajouter un statut est une décision de process, donc celle de Gautier.

### Zone réservée : 🗣️ Notes de Gautier

Chaque carte se termine par une section **« 🗣️ Notes de Gautier »** (décisions, contraintes, détails à ne pas oublier). L'IA la **lit en priorité** à chaque session sur la carte, en intègre le contenu dans les bonnes sections, et **n'y écrit JAMAIS**. Si elle manque sur une carte ancienne, l'IA l'ajoute vide.

⚠️ **Piège technique** : côté **API**, le corps d'un record se réécrit en **remplacement TOTAL** (`content` comme `sectionsBody` — seules les `properties` sont mergées, cf. *Conventions clés du modèle*). Une mise à jour partielle qui ne réémet pas la section **efface les notes de Gautier**. Toujours relire le corps existant et réémettre 🗣️ Notes de Gautier à l'identique.

⚠️ **Nuance MCP, vérifiée le 05/08** : l'outil `notes_update_record` **échappe à ce piège pour les corps SECTIONNÉS** — son paramètre `sections_body` fait une mise à jour **PARTIELLE par libellé** (les sections non citées gardent leur contenu, leurs ids sont préservés). C'est donc la porte à privilégier sur une carte sectionnée : ne citer que les libellés à modifier, ne jamais citer « 🗣️ Notes de Gautier ». En revanche `content` (corps LIBRE, la plupart des fiches Discovery et certaines cartes) reste bien en remplacement total, MCP compris : là, il faut relire et tout réémettre.

### Tiering de risque T1/T2/T3 — posé au schéma, PAS actif

Classement par **rayon d'impact**, décidé le 2026-07-17 : **T3** = auth, paiement, migration ou suppression de données, irréversible, sécurité (quelle que soit la taille) · **T1** = UI, copie, doc, ajout isolé, zéro surface données/sécurité · **T2** = tout le reste. Intention cible : T1 = auto-merge / deploy sans recette.

⚠️ **État vérifié au 2026-08-05 — l'exception T1 est INACTIVE, ne t'en réclame pas.** Les cartes sont désormais **qualifiées** (34 des 35 tickets du board portent un `Risque` : 8 T1, 13 T2, 13 T3) et l'option de statut « Déployé T1 / à contrôler » existe, désormais rangée juste avant « Terminé » sur les 20 boards — mais **aucune règle par tier n'est écrite** : une étiquette T1 ne dispense de rien tant que le circuit correspondant n'est pas décidé, sinon on s'autoriserait un déploiement sur la foi d'une couleur. Les deux tickets qui le porteraient (« Propriété Risque … + circuits par tier », « DoR à géométrie variable ») sont toujours **au Backlog**, non cadrés.

**La règle qui s'applique aujourd'hui, sans exception : jamais de push sur `main` sans go explicite de Gautier**, parce qu'un push sur `main` déclenche un déploiement réel en production (seuls les pushes ne touchant **que** des `.md` en sont exemptés — `deploy.yml`, `paths-ignore`). Unique dérogation accordée à ce jour : l'**auto-merge des petits correctifs low-risk** (retours de recette, tweaks UI sans surface données ni sécurité), une fois la **CI verte**. Le go explicite reste requis pour l'auth, les données, les migrations, le schéma Prisma, la sécurité et tout changement de taille.

### Discipline git

- **Toujours `git push` la branche AVANT `gh pr create`.** `gh` ouvre la PR depuis l'état **distant** : l'oublier produit une PR amputée des commits locaux — c'est arrivé le 2026-07-16, et la prod est partie incomplète.
- Branche par ticket, PR systématique. Pas de commit direct sur `main`.

## Ce qu'il NE faut PAS faire

- Pas de migration vers Postgres tant que SQLite suffit.
- Pas de framework CSS autre que Tailwind.
- Pas de state management global.
- Pas de tRPC, GraphQL. Des `fetch` sur des routes Next.js.
- Pas de `any` en TypeScript. Utiliser `unknown` + narrowing. **Unique exception tolérée aujourd'hui** : le `initialContent: … as any` passé à `useCreateBlockNote({ schema: pageLinkSchema, … })` — 3 occurrences (`Editor.tsx`, `RecordPanel.tsx` ×2), toutes annotées `eslint-disable-next-line`, dues au typage de `initialContent` avec un schéma BlockNote custom. N'en ajoute pas d'autre, et ne prends pas ces 3 lignes pour une autorisation générale.
- Pas de commentaires inutiles. Les commentaires expliquent le *pourquoi*, jamais le *quoi*.

## Commandes

```bash
npm ci --legacy-peer-deps   # ⚠️ OBLIGATOIRE : conflit de peer-deps connu
                            #   (@blocknote/mantine veut @mantine/core@^8, le projet est en v9).
                            #   Le lockfile ET l'install locale en dépendent — un `npm ci` nu échoue.
npm run dev          # dev server. Next 16 utilise Turbopack PAR DÉFAUT (inutile d'ajouter --turbo) ;
                     #   `npx next dev --webpack` pour repasser à webpack en cas de doute sur le bundler.
npm run build        # build prod
npm start            # sert le build prod. ⚠️ En NODE_ENV=production le cookie de session est `secure`
                     #   → invisible sur http://localhost : pour tester l'auth en local, reste sur `npm run dev`.
npm run db:push      # applique le schema Prisma à la DB (pas de migrations versionnées)
npm run db:studio    # UI Prisma pour inspecter la DB
npm test             # tests unitaires + API (Vitest, DB SQLite jetable)
npm run test:watch   # idem, en mode watch
npm run test:e2e     # tests E2E (Playwright, next dev sur DB jetable hors projet)
npx tsc --noEmit     # typecheck — il n'y a PAS de script `lint`/`typecheck`, ni de linter configuré
                     #   (aucun ESLint/Biome/Prettier dans le repo). La CI vérifie via `npm run build`.
```

- `postinstall` = `prisma generate` (jamais `db push` : aucune opération destructive à l'install). Après un changement de `schema.prisma` : `npx prisma generate`, puis **`npx prisma migrate dev --name <intitulé>`** pour produire la migration versionnée (la CI échoue sinon). `npm run db:push` ne reste bon que pour bricoler une base LOCALE jetable.
- ⚠️ **Scripts d'exploitation : SQL direct (`better-sqlite3`), jamais le client Prisma généré** — le client (`provider "prisma-client"`) est du TS aux imports sans extension, que le résolveur ESM de Node REFUSE. `scripts/normalize-emails.mjs` est d'ailleurs **inexécutable en l'état** pour cette raison (il importe un `client.js` inexistant ; il n'a plus vocation à être rejoué, passé en prod le 2026-07-11 quand le générateur émettait du JS). Modèles à suivre : `scripts/create-service-account.mjs` (compte de service idempotent), `scripts/backfill-service-memberships.mjs` (rattrapage des comptes de service sur les espaces existants, essai à blanc par défaut, chiffre ce qu'il ouvre) et `scripts/migrate-main-a-to-user.mjs` (migration de type de propriété : colonne neuve + backfill + remap des vues + suppression, en UNE transaction, essai à blanc par défaut). ⚠️ **Horodatage : toujours `prismaNow()`, jamais `CURRENT_TIMESTAMP`** — cf. « Rattachement d'office ». Sur le Pi, exécution via le service **`migrate`** du compose (image builder), jamais `docker exec gotyeah_notes` (le runner n'a ni `scripts/` ni les node_modules complets).
- **« Main à » est une propriété `user` PARTOUT depuis le 05/08/2026** (22 databases migrées, 259 valeurs, 24 vues recâblées — snapshot `pre-main-a-20260805-014523.db`). Plus AUCUN select Gautier/IA : l'assignation passe par les membres. Au passage, les vues « ⏳ Ton go » qui portaient l'opérateur `is` (hors `FilterOperator`, ignoré par `applyFilters` → elles ne filtraient RIEN) ont été normalisées en `contains`.

## Socle de test

- **Vitest** (`npm test`) : unitaires (`tests/unit/`) + API (`tests/api/`, import direct des Route Handlers, DB SQLite jetable `tests/.tmp/vitest.db` via `tests/setup/global-setup.ts`, auth mockée par `vi.mock("@/lib/session")`, seed via `tests/helpers/seed.ts`). Alias `@/` résolu par `vite-tsconfig-paths`.
- **Playwright** (`npm run test:e2e`, tests dans `e2e/`) : `tests/e2e-server.mjs` lance `next dev` (et non `next start` : le cookie de session est `secure` en prod → invisible sur http) sur une DB jetable **hors projet** (`os.tmpdir`, évite le watcher WAL).
- Toute évolution d'un test E2E doit être reflétée dans la database **Cahier de tests** (règle DoD).

## Règles pour Claude Code

1. **Lis le code existant avant d'éditer.** Ne réinvente pas une fonction qui existe dans `lib/`.
2. **Petits changements cohérents.** Une feature = une série de modifications logiques. Ne touche pas 12 fichiers pour une micro-modif.
3. **Propose avant de casser.** Si tu dois changer un contrat (schéma DB, forme d'une API route), explique pourquoi et attends validation.
4. **TypeScript strict.** Pas de `any`.
5. **Si tu hésites sur un choix, demande.** Mieux vaut une question qu'une refacto à défaire.
6. **Teste tes modifications.** Lance les curl ou les vérifications manuelles et donne les résultats. Ne dis pas juste "à tester".
7. **Utilise les helpers existants.** `parse*/serialize*` de `lib/db.ts`, `check*Access` de `lib/workspace.ts`, `nextPosition` de `lib/positions.ts`, `applyViewConfig` de `lib/client/viewFilters.ts`, `validateRelationValues` de `lib/relations.ts`, `validateUserValues` de `lib/assignees.ts`, `trash*/purge*` de `lib/trash.ts`. Ne réimplémente pas ces logiques — et vérifie leur signature exacte dans *Architecture > Signatures des helpers* avant de les appeler.
8. **zod v4** : utiliser `z.record(z.string(), z.unknown())` et non `z.record(z.unknown())` (le premier arg est la clé, pas la valeur).