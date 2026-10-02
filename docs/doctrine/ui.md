# Doctrine : UI

Périmètre : composants et contextes React, pages de `src/app`, fetch client (SWR et fetcher), rendu des états de chargement, mises à jour optimistes, portals et dialogues, glisser-déposer, mobile, thème, éditeurs BlockNote, tests E2E Playwright. Les vues de database relèvent de la doctrine `vues`, le RecordPanel et l'autosave de `records`.
Invariants courts : `.claude/rules/ui.md` · Décisions datées : `docs/adr/`

## Fichiers

- `src/app/layout.tsx` : pose `data-theme` sur `<html>` depuis le cookie `app-theme`, monte `DialogProvider`, puis `WorkspaceProvider` > `AppShell` seulement quand une session existe. Sans session (login, register, invitation vue par un non-connecté), la page est rendue sans `AppShell` ni `WorkspaceProvider` : un écran public ne compte pas sur la barre latérale, et `useWorkspace()` y rend la valeur par défaut du contexte (aucun espace, rôle inconnu).
- `src/app/not-found.tsx` : le seul écran 404. Il rend le même texte pour une page absente, en corbeille, d'un espace dont on n'est pas membre ou privée d'autrui ; ne pas le différencier (invariant 5 du CLAUDE.md).
- `src/app/globals.css` : thèmes, mapping BlockNote, règle de curseur (voir « Thème »).
- `src/app/settings/SettingsPage.tsx` : Réglages. Apparence = choix du thème (liste `THEMES`). Profil et Membres : doctrine `auth-invitations` ; Stockage : doctrine `uploads`.
- `src/contexts/` : `WorkspaceContext.tsx` (espaces, espace actif, `switchWorkspace`, rôle côté client, doctrine `roles-permissions`) et `DialogContext.tsx` (`useDialog`).
- `src/components/AppShell.tsx` : `Sidebar` + `Header` + `SearchPalette` ; `EmptyWorkspaceScreen` quand l'utilisateur n'a aucun espace. Sous `md`, la barre latérale est un tiroir dont l'ouverture est un état local du shell.
- `src/components/Header.tsx` (fil d'Ariane, recherche, réglages, `NotificationBell`, avatar) et `Breadcrumb.tsx` (`buildBreadcrumb`).
- `src/components/Sidebar.tsx` : sections, arbre des pages (`TreeItem`, il n'existe pas de `PageTree.tsx`), Récents, glisser-déposer des pages, repli de branche (Maj+clic, `e2e/sidebar-collapse.spec.ts`). Trois boutons par ligne, au survol : Options, sous-page, Supprimer.
- `src/components/PageOptionsPanel.tsx` : réglages d'un élément de l'arbre (renommer ; si c'est un tableau, règles de transition des colonnes). `e2e/page-options-panel.spec.ts`.
- `src/components/SearchPalette.tsx` : palette Cmd/Ctrl+K, pages et records avec leur chemin (`searchResultPathSegments`). `e2e/cmd-k.spec.ts`, `e2e/search-path.spec.ts`.
- `src/components/TrashSection.tsx` (corbeille de la barre latérale), `Editor.tsx` + `EditorClient.tsx` (éditeur de page : autosave, images, liens `@page`, conversion en database), `EmojiPicker.tsx` (icône de page, monté par `Editor`), `WorkspaceSelector.tsx` (barre latérale), `VisitRecorder.tsx` (monté par `pages/[id]/page.tsx`, envoie `POST /api/pages/[id]/visit` pour Récents), `NotificationBell.tsx` (doctrine `notifications`), `ui/Dialog.tsx`, `templates/TemplatesManager.tsx`.
- `src/components/databases/` : doctrine `vues` (shell, vues, `CardActions`, `portal.tsx`), `records` (`RecordPanel`, `RecordComments`, `Cell`, `BulkActionBar`), `uploads` (`RecordAttachments`), `roles-permissions` (`TransitionRulesEditor`), `sprints-backlog` (`BacklogView`).
- `src/lib/client/` : `fetcher.ts` (fetcher SWR, `HttpError`, `loadErrorMessage`, `noRetryOn4xx`), `blocknoteSchema.tsx`, `upload.ts`, `dialogController.ts`, `useThemeMode.ts`, `reorder.ts` (`intermediatePosition`), `useRecordDeepLink.ts`, `debouncedSaver.ts` (doctrine `records`), `viewFilters.ts`, `kanban.ts`, `useWorkspaceMembers.ts` (doctrine `vues`).
- `src/lib/tree.ts` (`buildTree`, `buildBreadcrumb`, `collectSubtreeIds`, `toggleBranchCollapsed`, `searchResultPathSegments`, `truncatePathEnd`) et `src/lib/avatar.ts` (`getAvatarColor`, `getInitials`) : fonctions pures consommées par l'UI. Gardes : `tests/unit/tree.test.ts`, `breadcrumb.test.ts`, `searchResultPath.test.ts` ; `avatar.ts` non testé.

## Composants et état

- Server Component par défaut ; `"use client"` seulement pour de l'état, des effets ou des handlers. Non testé.
- Rappel du CLAUDE.md : Tailwind en classes inline, pas d'état global. Les deux contextes (`WorkspaceContext`, `DialogContext`) sont les seuls ; le reste est SWR et `useState` local, y compris un état qui ne sert qu'au shell.
- Rappel du CLAUDE.md (invariant 15) : `lib/client/**` n'est jamais importé par une route API ni par un Server Component, sauf `viewFilters.ts`, qui reste pur.
- BlockNote ne rend pas au SSR : l'éditeur de page passe par `EditorClient` (`dynamic(…, { ssr: false })`).
- Un composant utile à plusieurs écrans est monté à chacun, jamais recopié : `TransitionRulesEditor` est monté par `PropertyPopover` et par `PageOptionsPanel` (doctrine `roles-permissions`).
- Une fonctionnalité a une porte d'UI atteignable depuis toutes les vues où elle sert, un board pouvant n'avoir qu'un kanban. Sans porte, elle reste inutilisée (ADR 0042).
- `useRecordDeepLink` adosse la carte ouverte à l'URL (`?r=<recordId>`, les autres paramètres sont préservés). Lui passer la liste complète des records, non filtrée : une carte hors du filtre de la vue s'ouvre, un `?r` périmé est nettoyé sans erreur. Gardes : `tests/unit/recordDeepLink.test.ts`, `e2e/deep-link.spec.ts`.

## Fetch client : SWR et fetcher

- Le fetch client passe par SWR, avec pour clé l'URL de l'API. Après une mutation, `mutate(key)`. Les clés records se réconcilient localement, sans refetch (doctrine `records`).
- Un seul fetcher : `fetcher` de `lib/client/fetcher.ts`, qui lève `HttpError` sur toute réponse non ok. Ne pas en écrire un autre ni passer `fetch(url).then(r => r.json())` à SWR : la réponse d'erreur deviendrait la donnée (`data = { error }`), le défaut `= []` ne s'appliquerait pas (un objet n'est pas `undefined`), `data.map` lèverait au rendu, et faute d'`error.tsx` ou d'ErrorBoundary dans `src/app`, le GlobalError de Next remplacerait tout le layout racine, barre latérale et en-tête compris (ADR 0043). Garde : `tests/unit/fetcher.test.ts`, pour la logique du fetcher ; aucun méta-test n'interdit un second fetcher.
- Une clé partagée par plusieurs composants n'a qu'un fetcher. Exception connue : `SettingsPage.tsx` lit `/members`, `/invitations` et `/idp` avec son propre `membersFetcher` (erreur sans `.status`), alors que `/members` est aussi la clé de `useWorkspaceMembers` (fiche Discovery « Fin de l'unification du fetcher (membersFetcher, noRetryOn4xx) »).
- `HttpError` porte `.status`, qui distingue une session expirée (401) d'un élément disparu (404) sans re-parser un message. Le fetcher ne lit jamais le corps d'une réponse en échec : le récupérer inviterait à l'afficher. À l'écran, `loadErrorMessage(err)` rend une phrase, jamais un code nu. Garde : `tests/unit/fetcher.test.ts`.
- `noRetryOn4xx` en troisième argument de `useSWR` sur toute clé qui peut légitimement répondre 4xx (session expirée, élément en corbeille, accès perdu) : on réessaie une panne (5xx ou réseau, trois fois au plus), pas un refus. Garde : `tests/unit/fetcher.test.ts`, pour la logique seulement. Exception connue : les clés records des cinq vues, les sprints (Kanban, Backlog), `useWorkspaceMembers`, les deux clés de `NotificationBell` et les trois clés de `SettingsPage.tsx` ne l'ont pas (fiche Discovery « Fin de l'unification du fetcher (membersFetcher, noRetryOn4xx) »).
- Le lien de page `pageLink` (`blocknoteSchema.tsx`) ne rend pas son échec, à dessein : un lien vers une page supprimée dégrade en libellé « page », et `noRetryOn4xx` empêche ce 404 de tourner en boucle.
- Un `fetch` impératif teste `res.ok` avant d'utiliser le corps. Écart connu, sans fiche : `StorageSection` (`SettingsPage.tsx`) lit `GET /api/config` sans ce test et affiche 10 Mo sur un échec, comme si c'était la valeur réglée. `InvitationClient` fait de même, mais un échec y aboutit à l'écran « lien invalide ».

## Rendu d'une donnée chargée

- Ordre : erreur, puis chargement, puis vide, puis liste. Un « Aucun élément » affiché après un échec est faux (sur les pièces jointes, dont le retrait est définitif, il se lit comme une suppression) ; et SWR efface l'erreur de son cache au premier `mutate()` réussi, donc une liste testée avant l'erreur ferait disparaître la bannière au premier ajout et laisserait, par exemple, un fil d'un seul commentaire, complet en apparence. Non testé pour l'état d'erreur.
- Écarts connus, sans fiche : `RecordComments` et `RecordAttachments` n'ont pas d'état de chargement (`data = []` par défaut) et affichent « Aucun commentaire » ou « Aucun document » pendant le premier chargement ; les cinq vues testent `isLoading` avant `error` (doctrine `vues`). D'autres écarts sont tenus dans leur doctrine : le panneau de `NotificationBell` (doctrine `notifications`), la clé `/sprints` du kanban et du backlog (doctrine `sprints-backlog`).
- L'échec de lecture (`error` de SWR) et le refus d'une action (état local, qui peut afficher le message `error` renvoyé par le serveur) sont deux états distincts, sinon l'un écrase l'autre (`RecordComments`, `RecordAttachments`).
- Dans un contexte monté en permanence (`WorkspaceContext`), l'écran d'échec se déclenche sur `error && data === undefined`, jamais sur `error` seul : un échec de revalidation garde la liste précédente et l'app reste utilisable. Cet écran remplace l'application, sinon `AppShell`, recevant une liste vide, afficherait « aucun espace » et proposerait d'en créer un. Non testé.

## Mises à jour

- Mise à jour optimiste : muter le cache SWR avant le fetch, rollback si la réponse n'est pas ok. Gardes : `e2e/kanban-inline-edit.spec.ts` (AC2, PATCH en 500 puis rollback du titre) et `e2e/view-tabs-reorder.spec.ts` (AC6, PATCH en échec puis retour de l'ordre des onglets) ; les autres portes ne sont pas testées.
- Liste append-only (commentaires) : insérer la ligne rendue par le serveur, `mutate((prev = []) => [cree, ...prev], { revalidate: false })`, pas un `mutate()` nu : sur deux envois rapprochés, SWR dédupliquerait le second pendant que la requête du premier est en vol, et le message n'apparaîtrait qu'à la revalidation suivante. La liste étant append-only, la réponse du serveur est la vérité : rien à réconcilier, aucun rollback (doctrine `records`).
- Autosave des corps (page et carte) et réconciliation du cache après un saver : doctrine `records`. Exception connue : `Editor.tsx` affiche « Enregistré ✓ » même sur un échec et n'envoie rien sur `pagehide` (fiche Discovery « Autosave des pages : état d'échec visible et flush sur pagehide »).

## Portals et dialogues

- Menus, dropdowns et popovers passent par `components/databases/portal.tsx` (`createPortal` vers `document.body`, en `position: fixed`) : sans portal, l'`overflow` des conteneurs coupe l'élément. Le composant bascule le panneau au-dessus du déclencheur quand la place manque et suit le clavier virtuel. `closeOnEscape` vaut `false` par défaut, parce que les consommateurs existants gèrent déjà Échap : un nouveau panneau le demande explicitement.
- Dialogues : `useDialog().confirm()` et `.alert()`, qui renvoient une Promise ; jamais `window.confirm`, `alert` ni `prompt` (ADR 0010). Une seule modale (`ui/Dialog.tsx` : portal, piège de focus, focus rendu à l'élément d'origine à la fermeture), rendue par `DialogProvider` à la racine ; `dialogController.ts` sérialise les demandes, deux appels rapprochés ne s'écrasent pas. `tone: "danger"` place le focus initial sur « Annuler ». La modale capte Échap et les raccourcis globaux (Ctrl+K) avant `RecordPanel` et `SearchPalette`. `useDialog()` hors du provider lève. Gardes : `tests/unit/dialogController.test.ts`, `e2e/dialogs.spec.ts`.

## Glisser-déposer (dnd-kit)

- Capteurs : `MouseSensor` (`distance: 6`) + `TouchSensor` (`delay: 250, tolerance: 6`), partout (barre latérale, table, kanban, backlog, options select de `PropertyPopover`). Jamais `PointerSensor` : au doigt, le navigateur prend le geste pour le défilement et émet `pointercancel`. Le `delay` sépare l'appui long (déplacer) du glissement (défiler) (ADR 0028). Non testé au doigt : Playwright ne tourne qu'en Chromium desktop.
- Exception : les onglets de vues de `DatabaseShell` gardent `MouseSensor` seul, pour que la bande d'onglets reste défilable au doigt (doctrine `vues`).
- `touch-none` seulement sur une poignée dédiée, seule cible du drag (ligne de table, ligne de backlog, option select). Jamais sur une surface qui porte les listeners et couvre la zone de défilement (lignes de l'arbre de la barre latérale, cartes kanban) : elle interdirait de faire défiler, et le `TouchSensor` pose lui-même son listener non passif une fois le drag armé.
- Position après un dépôt : seul l'élément déplacé est écrit, à mi-chemin de ses voisins (en bout de liste : moitié du premier, ou dernier + 1000). La formule est `intermediatePosition` (`lib/client/reorder.ts`, `tests/unit/reorder.test.ts`), à utiliser pour tout nouveau glisser-déposer de records ou de vues. Écart connu, sans fiche : seul `DatabaseShell` l'importe ; `TableView`, `KanbanView` et `BacklogView` recopient la formule en ligne. La barre latérale a son propre calcul (milieu entre voisins, ±1 en bout de liste, fratrie des racines limitée à leur section), à l'échelle du MAX+1 des pages (doctrine `modele`).

## Mobile et survol

- Un contrôle révélé au survol reste visible sous `md` (`opacity-100 md:opacity-0 md:group-hover:opacity-100`) : il n'y a pas de survol au doigt, et `opacity-0` ne bloque pas un appui. Ne pas ajouter `pointer-events-none` à la branche masquée : Playwright refuse de cliquer une cible sans pointer-events. Détail et exception du calendrier pour `CardActions` : doctrine `vues`.
- Titre d'une carte kanban : un clic simple ouvre la carte après `DOUBLE_CLICK_DELAY_MS`, un double-clic renomme (arbitrage par `e.detail`) ; ne pas retirer ce report (ADR 0044, détail dans la doctrine `vues`). Garde : `e2e/kanban-title-dblclick.spec.ts`.

## Thème et couleurs

- Un seul système : l'attribut `data-theme` de `<html>`, posé au SSR par `app/layout.tsx` depuis le cookie `app-theme`. Réglages → Apparence pose l'attribut (retour immédiat), écrit le cookie (lu par le layout au rechargement) puis appelle `router.refresh()` (ADR 0001). Non testé.
- Un thème est un bloc `[data-theme="…"]` de `globals.css` qui définit huit variables : `--bg`, `--surface`, `--surface-hover`, `--surface-active`, `--border`, `--text`, `--text-muted`, `--accent`. `:root` porte les valeurs du thème `light`. Ajouter un thème, c'est un bloc dans `globals.css` et une entrée dans `THEMES` (`SettingsPage.tsx`), qui n'est pas dérivée du CSS : son drapeau `dark` (rangement clair ou sombre) et ses quatre couleurs d'aperçu sont recopiés à la main. Liste : `grep '^\[data-theme=' src/app/globals.css`.
- `--bg` s'écrit en hexadécimal à six chiffres : `useThemeMode` en calcule la luminance, et toute autre forme retombe sur « clair ».
- Jamais de classe `dark:` : sans `@custom-variant dark`, elle suit le `prefers-color-scheme` de l'OS, pas le thème choisi. Surfaces, fonds, bordures et textes s'écrivent `bg-[var(--surface)]`, `text-[var(--text)]`, etc. Non testé.
- Restent écrits en dur, hors thème : les boutons primaires (`bg-blue-500 text-white` ou `bg-[var(--accent)] text-white`), les erreurs (`text-red-500`), les anneaux de focus (`blue-400`) et les pastilles d'options select (`SELECT_COLORS`, couleur choisie par l'utilisateur, qui ne suit pas le thème). Une surface, un fond, une bordure ou un texte courant écrit en dur est un défaut.
- Contraste : du texte blanc sur `var(--accent)` descend sous 4,5:1 sur plusieurs thèmes (light, dark, rose), et `bg-blue-500 text-white` est à 3,7:1 sur tous. Un nouveau lien ou bouton secondaire s'écrit en neutre (`bg-[var(--surface)] text-[var(--text)]` et bordure), comme `not-found.tsx`. Écart connu, sans fiche : les boutons primaires et pastilles existants gardent ces couples (`grep -rn 'text-white' src --include=*.tsx | grep -E 'accent|blue-500'`).
- BlockNote suit le thème par la prop `theme={useThemeMode()}` (clair ou sombre selon la luminance de `--bg`, réévalué quand `data-theme` change) ; ses `--bn-colors-*` sont mappées sur la palette dans `globals.css`, sous `html[data-theme] .bn-root`, sélecteur qui passe devant `.bn-root[data-color-scheme="dark"]`.
- Tailwind v4 ne pose plus `cursor: pointer` sur `<button>` : la règle de base de `globals.css` (`button:not(:disabled)`, `[role="button"]:not(:disabled)`, `summary`, dans `@layer base`) le rétablit, et une classe `cursor-*` posée sur un élément l'emporte.

## Éditeurs BlockNote

- Deux composants, trois instances `useCreateBlockNote` : la page (`Editor.tsx`), le corps libre d'une carte et l'éditeur par section (`RecordPanel.tsx`). Toutes prennent `schema: pageLinkSchema`, `uploadFile` et le dictionnaire `fr`. Une évolution de l'éditeur se fait dans `lib/client/blocknoteSchema.tsx` ou `lib/client/upload.ts`, jamais en la recopiant dans les deux composants. Non testé.
- `blocknoteSchema.tsx` porte l'inline content `pageLink` (lien `@page`, qui ne stocke que `pageId` ; titre et icône sont lus à l'affichage) et son menu de suggestion.
- `uploadFile` envoie à `POST /api/upload`, qui n'accepte que des images, et rend l'URL `/api/files/<nom>` (doctrine `uploads`).
- Les trois `initialContent … as any` sont la seule exception au `any` du projet. Leurs `eslint-disable-next-line` sont inertes faute de linter : seule la revue tient la règle.

## Tests

- Vitest tourne en environnement `node`, sans jsdom ni Testing Library. La logique d'un composant s'extrait en fonction pure, dans `lib/` ou `lib/client/` (`dialogController`, `kanban`, `reorder`) ou exportée à côté du composant (`withStopPropagation` de `CardActions.tsx`) ; la structure d'un composant se vérifie au besoin par `renderToStaticMarkup` (`tests/unit/cardActions.test.ts`) ; le comportement, en Playwright.
- Harnais E2E (`tests/e2e-server.mjs`) : `next dev` et non `next start`, car le cookie de session est `secure` en production et ne circule pas sur http://localhost. Base jetable hors du dépôt (`gotyeah-notes-e2e.db` dans `os.tmpdir()`), recréée par `prisma db push` à chaque lancement : dans le dépôt, le watcher de `next dev` couperait les écritures SQLite (doctrine `deploiement`, ADR 0006).
- Le harnais ouvre `REGISTRATION` et `LEGACY_LOGIN` (les specs créent leurs comptes par `POST /api/auth/register`, `e2e/helpers/auth.ts`) et vide `BREVO_API_KEY` et `KEYCLOAK_ADMIN_CLIENT_*` : un test n'envoie aucun email et ne crée aucun compte IdP.
- `playwright.config.ts` : Chromium desktop seul, un worker, specs en série sur une base partagée, une relance en CI, port 3100 par défaut (`E2E_PORT`). Hors CI, un serveur déjà à l'écoute sur ce port est réutilisé (`reuseExistingServer`), avec sa propre base.
- Cibler un élément par son rôle ou son texte (`getByRole`, `getByText`) et, quand ça ne suffit pas, par un attribut `data-*` posé pour le test (`data-kanban-column`, `data-card-title-input`, `data-save-state`, `data-comment-list`) ; jamais par une classe de présentation, qui change sans que le comportement change, ni par `input[value=…]`, qui cesse de correspondre à la première frappe. Écart connu, sans fiche : `e2e/select-checkbox.spec.ts` cible les cartes kanban par `.group.cursor-pointer`.
- Un test d'autosave rouvre la carte sans recharger (doctrine `records`).
- Tout test E2E ajouté ou modifié est reporté dans la database « Cahier de tests » (DoD du CLAUDE.md).
