# Doctrine : Routes API

Périmètre : les route handlers de `src/app/api/**`, le middleware `src/proxy.ts` et le harnais des tests d'API (`tests/api/**`, `tests/setup/`, `tests/helpers/`).
Invariants courts : `.claude/rules/api.md` · Décisions datées : `docs/adr/`

## Squelette d'un handler

- Un handler s'écrit `export async function GET|POST|PATCH|DELETE(req, { params })`, avec `params: Promise<{ id: string }>` et `const { id } = await params` (Next 16). Pas de `export const POST = …` : le méta-test de `tests/api/role-gates.test.ts` ne reconnaît que la forme `export async function`, et un handler écrit autrement échapperait à sa déclaration.
- L'ordre des refus est fixe : `getSession()` absent → 401 `{ error: "Non authentifié" }`, puis accès → 404 `{ error: "Not found" }`, puis rôle → 403 `{ error: "Rôle insuffisant" }`. Un défaut d'accès rend 404, jamais 403, pour ne pas révéler à un non-membre qu'une ressource existe (page privée d'autrui comprise). Garde : `tests/api/role-gates.test.ts` (describe « Exemptions lecteur et précédence 404/403 »).
- La validation du corps (400) peut précéder le contrôle d'accès, mais rien ne s'écrit avant le dernier refus : ni ligne en base, ni compteur de rate-limit. `POST /api/workspaces/[id]/members` place ses compteurs après le contrôle de rôle pour ne pas débiter un non-admin. Gardes des écritures en base : `tests/api/role-gates.test.ts` (describe « Gates de rôle : 403 sous le rôle requis, sans effet de bord » : la fixture partagée survit à toute la table) et `tests/api/invitations.test.ts` (« un non-admin est refusé (403) avant tout effet ») ; le placement des compteurs n'est pas testé.
- Viennent ensuite les gardes métier (400, 409, 422), les écritures, puis la réponse (voir « Réponses »).

## Proxy et routes publiques

- `src/proxy.ts` est le middleware (Next 16 a renommé `middleware` en `proxy`). Sans cookie `session_token`, il répond 401 sur `/api/*` et redirige une page vers `/login`. Il ne teste que la présence du cookie : c'est `getSession()`, dans le handler, qui valide la session.
- Routes publiques (`PUBLIC_PATHS`) : `/login`, `/register`, `/api/auth`, `/invitation`, `/api/invitations/claim`. Les routes d'auth créent la session, elles ne peuvent pas la lire ; l'écran d'invitation sert un invité qui n'a pas encore de compte. Le test est un préfixe (`startsWith`) sans `/` final : toute route créée sous `/api/auth` ou `/api/invitations/claim` est publique d'office et porte sa propre garde dans le handler, et un chemin comme `/api/authz` ou une page `/invitations` le serait aussi.
- Gardes des routes publiques : `LEGACY_LOGIN` (login → 403), `REGISTRATION` (register → 403), `MAGIC_LINK` (`POST /api/auth/magic` → 403, `GET /api/auth/magic/consume` → redirection `/login?magic_error=disabled`, `/api/invitations/claim` → 404), OIDC non configuré (`GET /api/auth/oidc/login` → redirection `/login?sso_error=disabled`), et le jeton du lien pour `/api/invitations/claim` (410 s'il est mort) (ADR 0035). Rate-limit : 429 sur login et magic. Détail des flags et des budgets : `docs/doctrine/auth-invitations.md`.
- Anti-CSRF : le proxy refuse en 403 `{ error: "Origine non autorisée" }` une mutation (`POST`, `PUT`, `PATCH`, `DELETE`) sur `/api/*` dont l'`Origin` ne correspond pas au `Host`, `/api/auth/*` compris. Passent : les `GET`, le same-origin, les requêtes sans `Origin` et le pont MCP. Garde : `tests/api/api-hardening.test.ts` (ADR 0011).
- Une auth par en-têtes est laissée passer par le proxy (aujourd'hui `x-mcp-secret` + `x-act-as-email`) et validée dans `lib/session.ts` (`getSession()` → `getServiceUser()`). Toute future auth par en-têtes suit ce partage : le proxy la laisse passer, `lib/session.ts` décide. Garde du passage : `tests/api/api-hardening.test.ts` ; la validation elle-même n'est pas testée. Détail : `docs/doctrine/mcp.md`.
- Les gates de rôle vivent dans le handler, pas dans le proxy : Vitest importe les handlers sans passer par lui, et le pont MCP le traverse sans cookie (ADR 0017).

## Accès

- Entités de database : `checkDatabaseAccess`, `checkPropertyAccess`, `checkRecordAccess`, `checkViewAccess`, `checkSprintAccess` (`lib/workspace.ts`). Ils rendent `null` (→ 404) pour un non-membre, pour une page hôte privée d'autrui (en cascade, sauf pour un compte de service, lu sur `membership.user.isService`) et pour un élément en corbeille ; sinon un objet dont le champ `membership` reçoit `hasRole`. `includeTrashed = true` (`checkDatabaseAccess` et `checkRecordAccess` seulement) ne sert qu'au cycle de la corbeille (restauration, `?permanent=1`). Gardes : `tests/api/access-isolation.test.ts` (page privée), `tests/api/trash.test.ts` (corbeille).
- Page, section, espace, corbeille, recherche : pas de helper dédié (`checkPageAccess` n'existe pas). Utiliser `getMembership(user.id, workspaceId)` (→ 404 si `null`), puis `isPageAccessible(page, user.id, user.isService)` pour un élément ou `pageVisibilityFilter(user.id, user.isService)` étalé dans le `where` d'une liste. Pas de test `visibility === "private"` réécrit : `tests/api/service-account.test.ts` refuse ce motif hors de `lib/workspace.ts` et vérifie que `isService` est passé. Détail : `docs/doctrine/roles-permissions.md`.
- Un `?workspaceId=` ne fait que désigner l'espace, dont l'appartenance se vérifie par `getMembership` (404). L'appelant vient de `getSession()` : aucune route ne lit un `userId` ou un email en paramètre pour le désigner, et il ne faut pas en ajouter, car un `?userId=` permettrait de lire l'appartenance des autres. Un `[userId]` de chemin (`members/[userId]`) désigne une cible, vérifiée comme membre de l'espace. Non testé ; contrôle : `grep -rnE 'searchParams\.get\("(userId|email)"\)' src/app/api` ne rend rien.
- Rattachement inter-espace : un id reçu pour rattacher (`parentId` et `sectionId` de `POST /api/pages`, `patchNotesPageId`, `config.targetDatabaseId` d'une relation) est vérifié sur l'espace contrôlé, sinon on écrirait dans un espace où l'on n'est que lecteur. Pour un parent de page s'ajoute `isPageAccessible` : le bon espace ne suffit pas (ADR 0039). Refus : 404 pour les pages, 400 pour la relation et `patchNotesPageId`. Gardes : `tests/api/role-gates.test.ts` (parent ou section d'un autre espace → 404), `tests/api/gardes-parent-et-rules.test.ts`, `tests/api/relation-property.test.ts`, `tests/api/database-patchnotes-mapping.test.ts`.

## Rôles

- `hasRole(access.membership, "editor" | "admin")` se teste dans le handler, après l'accès. Une route sans espace (`POST /api/upload`, `PATCH /api/config`) passe par `hasRoleInAnyWorkspace`. Tout `POST`, `PATCH`, `PUT` ou `DELETE` figure dans la table `DECLARED` de `tests/api/role-gates.test.ts`, gaté ou exempté ; un handler mutant non déclaré fait échouer ce test. La déclaration ne prouve pas le gate : le 403 se teste par un cas de la table des gates du même fichier, ou dans le test de la route. Matrice des rôles et exemptions : `docs/doctrine/roles-permissions.md`.
- Les 403 sont fonctionnels (le membre voit la ressource, l'action est refusée) :
  - `Rôle insuffisant`, et sa variante sur la clé `rules` d'une propriété (« Rôle insuffisant : seuls les administrateurs modifient les règles d'accès. ») ;
  - `{ error: "Transition non autorisée", details: { denied } }` : règle de transition refusée (`PATCH /api/records/[id]`, `lib/transitionGuard.ts` pour les créations) ;
  - appelant hors `IDP_ADMIN_EMAILS` sur `POST /api/workspaces/[id]/members/[userId]/idp` ;
  - fonctionnalité désactivée : login, register, magic ;
  - anti-CSRF du proxy.

## Validation

- zod v4, schéma déclaré en tête de fichier. Lecture du corps : `await req.json().catch(() => null)` puis `schema.safeParse(body)` ; échec → 400 `{ error: "Validation failed", details: parsed.error.flatten() }`. Un corps vide ou malformé rend 400, jamais 500. Garde : `tests/api/api-hardening.test.ts` (sections seulement ; les autres routes, non testé).
- Les params de query passent aussi par zod (`z.coerce` pour un nombre), comme dans `GET /api/databases/[id]/records`.
- Exceptions : `POST /api/upload` et `POST /api/records/[id]/attachments` lisent un `FormData` ; `POST /api/auth/login`, `POST /api/auth/register` et `POST /api/pages` valident à la main.
- `POST /api/auth/magic` passe par zod mais rend sa réponse neutre même pour une adresse malformée, jamais 400 : distinguer « mal écrite » de « inconnue » ferait de la route publique un oracle. Garde : `tests/api/magic-link.test.ts` (describe « POST /api/auth/magic : la route ne dit jamais qui a un compte »).

## Champs JSON

- Les champs JSON des modèles passent par les `parse*/serialize*` de `lib/db.ts` (`parseRecord`, `serializeView`, `parseSectionsBody`…), pas par `JSON.parse` ou `JSON.stringify` dans une route. Un champ sans helper reçoit d'abord son helper. Non testé ; contrôle : `grep -rnE 'JSON\.(parse|stringify)' src/app/api`.
- Exception connue : `templates/route.ts` et `templates/[id]/route.ts` (`columns`, `sections` : pas de helper pour `Template`), `POST /api/databases` et `POST /api/databases/[id]/records` (`Database.recordSections`), `PATCH /api/records/[id]` (`RecordRevision.before/after`), `PATCH /api/properties/[id]` (comparaison des `rules`), `GET /api/databases/[id]/records` (param `filter`), `auth/oidc/login` et `auth/oidc/callback` (cookie de transaction OIDC) (fiche Discovery « Routes API : viewFilters hors de lib/client, JSON.parse remplacés par des helpers »).

## Code client côté serveur

- Une route n'importe rien de `src/lib/client/**`. Exception connue : `GET /api/databases/[id]/records` importe `applyFilters` et `resolveFilterTokens` de `lib/client/viewFilters.ts`, qui doit rester pur (son seul import est `@/lib/db`) (fiche Discovery « Routes API : viewFilters hors de lib/client, JSON.parse remplacés par des helpers »). Non testé ; contrôle : `grep -rn '@/lib/client' src/app/api`.

## Réponses

- Succès : l'objet parsé tel quel, jamais enveloppé dans `{ data: … }`.
- 201 sur une création : database, record, duplicate, property, view, sprint, template, commentaire, pièce jointe, et l'invitation de `POST /api/workspaces/[id]/members`. Pages, sections, workspaces et `POST /api/auth/register` répondent 200 : c'est un contrat existant, qu'on n'aligne pas sans décision.
- Réponses non JSON : `GET /api/files/[name]` (octets), `GET /api/attachments/[id]` (flux), `GET /api/auth/oidc/login` et `GET /api/auth/oidc/callback` (redirections ; erreur → `/login?sso_error=<code>`), `GET /api/auth/magic/consume` (redirections ; erreur → `/login?magic_error=<code>`, invité sans compte → `/invitation?token=…`). Contrôle : `grep -rlE 'NextResponse\.redirect|new (Next)?Response\(' src/app/api`.
- Erreur : `{ error }`, complété d'un `details` dans ces cas : `Validation failed` (le flatten zod, ou un message), transition refusée (`{ denied }`), option select encore référencée (`{ optionIds }`). Un 401 dit « Non authentifié », sauf le login refusé qui garde son message unique anti-énumération ; un 404 dit « Not found ».
- Codes métier, par famille :
  - 400 : validation, ou invariant métier refusé (type d'une propriété ou d'une vue figé, dernière vue, propriété `title`, template fourni, option référencée, valeur de relation ou d'assigné invalide, sprint d'une autre database, rattachement refusé, adresse de confirmation non recopiée) ;
  - 409 : conflit avec l'état (page déjà database, sprint déjà actif, email déjà pris, dernière section de son type, carte restaurée sous une page en corbeille, dernier admin, déjà membre, compte de service visé ou appelant de `PATCH /api/me`, invitation déjà refusée ou expirée, SSO non configuré, suspension de son propre accès SSO) ;
  - 410 : jeton de lien mort, ou plus aucune invitation en attente (`POST /api/invitations/claim`) ;
  - 413 et 415 : fichier trop gros, type refusé (upload et pièces jointes) ;
  - 422 : clôture de sprint impossible (réconciliation des issues, page « Patch notes » illisible) ;
  - 429, toujours avec `Retry-After` : login, magic, `POST /api/workspaces/[id]/members`, création de compte SSO. Budgets : `docs/doctrine/auth-invitations.md`.

## Transactions et positions

- `nextPosition(model, where, tx)` (`databaseProperty`, `record`, `view`, `sprint`) s'appelle dans la `$transaction` de la création, avec `tx` : hors transaction, deux créations concurrentes lisent le même `MAX(position)`. Garde : `tests/api/concurrency.test.ts`. Page et Section ont leur propre MAX+1 : `docs/doctrine/modele.md`.
- Un contrôle d'état et l'écriture qu'il protège vivent dans la même transaction, sinon deux requêtes concurrentes passent le contrôle toutes les deux : un seul sprint actif (409), dernier admin (409). Gardes : `tests/api/concurrency.test.ts` (sprint, en concurrence), `tests/api/members.test.ts` (dernier admin : le 409, sans requêtes concurrentes).

## GET qui écrivent

- Sans cron en self-host, des GET purgent au passage. C'est un acte système, déclenché quel que soit le rôle de l'appelant, lecteur compris, puisque le délai est déjà consommé (ADR 0007). Le filtre de lecture reste l'autorité, la purge n'est que du ménage.
  - `GET /api/config` : `purgeOrphanUploads()` (`UPLOAD_PURGE_DAYS`), sur toute l'instance, pour tout appelant connecté. Dans l'UI, seul Réglages → Stockage l'appelle, écran masqué aux non-admins.
  - `GET /api/trash` : `purgeExpiredTrash()` (`TRASH_PURGE_DAYS`), sur toute l'instance et pas seulement l'espace demandé. La barre latérale l'appelle au montage pour tout éditeur ou admin (`TrashSection`), pas seulement à l'ouverture de la corbeille.
  - `GET /api/notifications` sans `?count=1` : purge des notifications de l'appelant seul (`NOTIFICATION_PURGE_DAYS`). Le compteur `?count=1`, appelé en boucle par la cloche, n'écrit rien : une purge ne va pas sur un GET chaud.
- Les GET d'authentification écrivent par nature : `GET /api/auth/magic/consume` consomme le jeton et ouvre une session, `GET /api/auth/oidc/callback` ouvre une session et peut créer le compte. Détail : `docs/doctrine/auth-invitations.md`.

## Filtrage : côté client, sauf la liste des records

- Les records d'une database sont renvoyés en entier (hors corbeille, par `position`) ; les filtres et tris d'une vue s'appliquent côté client par `applyViewConfig()`, pas dans la route (ADR 0009).
- Exception : `GET /api/databases/[id]/records` accepte des params optionnels, pour les consommateurs qui n'ont pas `applyViewConfig` :
  - `filter` : JSON `ViewFilter[]`, appliqué par `applyFilters` après `resolveFilterTokens` (le jeton `@me` désigne l'appelant) ;
  - `limit` (1 à 200) et `offset` : le corps reste un tableau nu, le total avant pagination part dans l'en-tête `X-Total-Count` (toujours présent) ;
  - `includeContent=false` : omet `content` et `sectionsBody` (`stripRecordBody`).
- Sans param, le corps est celui de toujours (tous les records hors corbeille, par `position`, corps compris) : le front en dépend. Gardes : `tests/api/records-list-query.test.ts` (AC1 à AC6), `tests/api/records-filter-me.test.ts`, `e2e/records-list-front-guard.spec.ts`. Le MCP n'utilise pas ces params : `docs/doctrine/mcp.md`.

## Carte des routes

Nombre : `find src/app/api -name route.ts | wc -l`. Méthodes exportées : `grep -rE '^export async function (GET|POST|PATCH|PUT|DELETE)' src/app/api`.

| `/api/…` | Méthodes | À savoir | Doctrine |
|---|---|---|---|
| `auth/login` · `auth/logout` · `auth/register` | POST | publiques ; 403 si désactivées, 429 sur login | auth-invitations |
| `auth/oidc/login` · `auth/oidc/callback` | GET | publiques, redirections | auth-invitations |
| `auth/magic` · `auth/magic/consume` | POST · GET | réponse uniforme ; consume redirige | auth-invitations |
| `invitations/claim` | GET · POST | publique, garde = jeton ; GET aperçu sans rôle ni id, POST `accept` ou `decline` | auth-invitations |
| `invitations/[id]` | POST | `accept` ou `decline` d'une invitation qui vise l'appelant ; exempté de rôle | auth-invitations |
| `me` | PATCH | profil de l'appelant ; email non modifiable ; 409 sur un compte de service | auth-invitations |
| `notifications` | GET · PATCH | liste (purge) ou `?count=1` ; PATCH marque tout lu | notifications |
| `workspaces` · `workspaces/[id]` · `workspaces/[id]/switch` | GET POST · DELETE · POST | créer son espace et changer d'espace sont exemptés ; DELETE admin | roles-permissions |
| `workspaces/[id]/members` · `members/[userId]` | GET POST · PATCH DELETE | POST invite (201) sans créer de membership ; dernier admin → 409 | auth-invitations, roles-permissions |
| `workspaces/[id]/idp` · `members/[userId]/idp` | GET · POST | comptes SSO ; admin, et `IDP_ADMIN_EMAILS` pour agir | auth-invitations |
| `workspaces/[id]/invitations` · `invitations/[invitationId]` | GET · DELETE | invitations en attente (admin) ; révocation définitive | auth-invitations |
| `sections` · `sections/[id]` | GET POST · PATCH DELETE | 409 sur la dernière section de son type | modele |
| `pages` · `pages/recent` · `pages/[id]` | GET POST · GET · GET PATCH DELETE | arbre hors corbeille ; 5 dernières visites ; GET expose `database: { id }` ; DELETE = corbeille | modele |
| `pages/[id]/restore` · `pages/[id]/visit` | POST · POST | restaure le sous-arbre ; la visite est exemptée de rôle | modele |
| `trash` · `search` | GET · GET | corbeille (purge) ; pages et records de l'espace, hors corbeille | modele |
| `config` · `upload` · `files/[name]` | GET PATCH · POST · GET | quota d'upload ; image → `{ url }` ; octets servis | uploads |
| `attachments/[id]` · `records/[id]/attachments` | GET DELETE · GET POST | pièces jointes, accès par la carte | uploads |
| `templates` · `templates/[id]` | GET POST · GET PATCH DELETE | templates fournis → 400 en écriture | records |
| `databases` · `databases/[id]` | POST · GET PATCH DELETE | scaffold depuis `templateId` ; GET expose `workspaceId` ; PATCH `recordTemplate` et `patchNotesPageId` | records, sprints-backlog |
| `databases/[id]/properties` · `properties/[id]` | POST · PATCH DELETE | type figé ; DELETE purge la clé des records | records |
| `databases/[id]/records` · `records/[id]` | GET POST · GET PATCH DELETE | params de liste ; PATCH écrit les révisions ; DELETE = corbeille | records |
| `records/[id]/duplicate` · `restore` · `revisions` · `comments` | POST · POST · GET · GET POST | copie atomique ; 409 sous une page en corbeille ; commentaires sans PATCH ni DELETE | records |
| `databases/[id]/views` · `views/[id]` | POST · PATCH DELETE | 400 sur la dernière vue | vues |
| `databases/[id]/sprints` · `sprints/[id]` | GET POST · PATCH DELETE | démarrer, clôturer | sprints-backlog |

## Tests d'API (Vitest)

- `npm test` lance `tests/unit/**` et `tests/api/**` en environnement node (`vitest.config.ts`) ; l'alias `@/` passe par `vite-tsconfig-paths`.
- Un test d'API importe le handler (`import { POST } from "@/app/api/…/route"`) et l'appelle avec un `Request` et `{ params: Promise.resolve({ id }) }` : il ne traverse ni le proxy ni un serveur. Le proxy se teste à part, en appelant `proxy()` (`tests/api/api-hardening.test.ts`).
- Session : `vi.mock("@/lib/session", async (importOriginal) => ({ ...(await importOriginal()), getSession: vi.fn() }))`, puis `vi.mocked(getSession).mockResolvedValue({ id, email, displayName, currentWorkspaceId, isService })`. Le mock est partiel : un mock total retirerait `hashToken` et `createSession`, dont dépendent les jetons de connexion (`lib/magicLink.ts`) et les sessions ouvertes par les routes.
- Données : `tests/helpers/seed.ts`, `seedUserWithWorkspace(email)` (un utilisateur admin de son espace) et `seedMember(workspaceId, role)` (un membre du rôle voulu).
- Base : `tests/setup/global-setup.ts` recrée `tests/.tmp/vitest.db` par `prisma db push`, une fois par run. Tous les fichiers la partagent et s'exécutent en série (`fileParallelism: false`, sinon leurs transactions se verrouillent). Chaque test crée ses propres données (emails uniques) et ne suppose ni une base vide ni l'état laissé par un autre fichier ; exemple : un destinataire déjà notifié plus haut absorbe une nouvelle notification par coalescence (`docs/doctrine/notifications.md`).
- `db push` ne joue pas les migrations : un test vert ne prouve pas qu'une migration s'applique. Le job CI « Migrations en phase avec le schéma » vérifie seulement qu'aucune migration ne manque au schéma (`docs/doctrine/deploiement.md`).
- Les compteurs de rate-limit vivent en mémoire de module et persistent d'un test à l'autre : un test qui en dépend appelle `_resetRateLimit()` en `beforeEach` (`tests/api/members.test.ts`).
- L'environnement de test vide `BREVO_API_KEY`, `KEYCLOAK_ADMIN_CLIENT_ID`, `KEYCLOAK_ADMIN_CLIENT_SECRET` et `MCP_SHARED_SECRET` : aucun email ne part, aucun compte IdP n'est créé, le pont MCP est coupé. La validation du pont n'est donc couverte par aucun test d'API.
- Des méta-tests lisent le source et échouent sur une route mal écrite : `role-gates.test.ts` (handler mutant absent de `DECLARED`), `service-account.test.ts` (test de confidentialité écrit à la main, `isService` omis), `service-account-autojoin.test.ts` (second appelant de `withServiceAccounts`).
