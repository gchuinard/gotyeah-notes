# CLAUDE.md

Cadre du travail de Claude Code sur gotyeah-notes. Ce fichier est court à dessein : le détail vit dans la doctrine, qui se lit à la demande (voir « Avant de toucher à… »).

## Projet

gotyeah-notes est un clone de Notion self-hosted : espaces multi-membres avec rôles, pages en arborescence, databases à vues multiples (table, kanban, calendrier, galerie, backlog), éditeur de blocs BlockNote. Il tourne sur un Raspberry Pi et se pilote aussi par un pont MCP, dont les outils `notes_*` vivent dans le dépôt `gotyeah-mcp`.

## Stack

- Next.js 16 (App Router, Server Components par défaut), React 19, TypeScript strict.
- Tailwind CSS v4 : classes inline, ni `@apply` ni CSS modules.
- Prisma 7 + SQLite (better-sqlite3 via `@prisma/adapter-better-sqlite3`), client généré dans `generated/prisma`.
- BlockNote + Mantine 9 (éditeur), dnd-kit (drag & drop), SWR (fetch client), zod v4 (validation), lucide-react (icônes).
- Auth : OIDC (jose) contre Keycloak, bcryptjs pour le login de secours, emails via l'API Brevo.
- Aucune autre dépendance sans raison forte : se demander d'abord si on peut s'en passer.

## Commandes

```bash
npm ci               # .npmrc pose legacy-peer-deps=true (peers BlockNote/Mantine) : ne pas le supprimer
npm run dev          # Turbopack par défaut ; `npx next dev --webpack` en cas de doute sur le bundler
npm run build        # build prod ; c'est aussi le contrôle de types de la CI
npm start            # cookie `secure` en prod : tester l'auth en local avec `npm run dev`
npx tsc --noEmit     # typecheck ; il n'y a ni linter ni script lint
npm test             # Vitest : tests/unit + tests/api, base SQLite jetable (`npm run test:watch` en continu)
npm run db:studio    # UI Prisma pour inspecter la base
npm run test:e2e     # Playwright : next dev sur une base jetable hors du dépôt
npx prisma migrate dev --name <intitulé>   # après toute modification de schema.prisma
npm run db:push      # base locale jetable uniquement ; la prod applique `prisma migrate deploy`
```

## Carte

- `src/proxy.ts` : le middleware (Next 16 l'a renommé). 401 sur `/api` sans session, anti-CSRF, passage du pont MCP.
- `src/app/api/**/route.ts` : les routes (`find src/app/api -name route.ts | wc -l`).
- `src/app/` : pages en Server Components ; `settings/` (profil, membres, stockage, apparence), `invitation/` (acceptation, publique).
- `src/components/` : l'UI ; `databases/` porte les cinq vues, le RecordPanel et les cellules.
- `src/contexts/` : les deux seuls contextes React, Workspace et Dialog.
- `src/lib/` : logique serveur et logique pure (accès, pages, positions, corbeille, uploads, auth, notifications). Chercher ici avant d'écrire un helper.
- `src/lib/client/` : logique client (fetcher, filtres de vue, kanban, autosave).
- `prisma/` : schéma et migrations versionnées. `scripts/` : scripts d'exploitation, en SQL direct.
- `tests/` (Vitest), `e2e/` (Playwright), `deploy/pi-deploy.sh` (ce que le Pi exécute au déploiement).

## Helpers : ce que les types ne disent pas

Les signatures font foi dans le code, et tsc strict les vérifie. À savoir en plus :

- `check{Database,Property,Record,View,Sprint}Access` renvoient `null` pour un élément inaccessible ou en corbeille (donc 404). `includeTrashed` ne sert qu'au cycle de vie de la corbeille.
- Il n'existe pas de `checkPageAccess` : pour page, section, workspace, corbeille et recherche, c'est `getMembership()` puis `isPageAccessible()`.
- `hasRole` est pur : il renvoie `false`, il ne lève jamais.
- `setPageSection`, `updateMemberRole` et `removeMember` ne lèvent pas : ils renvoient une union `{ ok: true, … } | { ok: false, code }` à narrower.
- À ne jamais réimplémenter : `parse*/serialize*` et `mergeRecordProperties` (`lib/db.ts`), `validateRelationValues`, `validateUserValues`, `withoutUnknownIds`, `trash*/purge*` (`lib/trash.ts`), `applyViewConfig`, `fetcher` (`lib/client/fetcher.ts`).

## Invariants

1. ⚠️ **Tout merge sur `main` part en production dès que la CI est verte. Jamais de push ni de merge sur `main` sans le go explicite de Gautier.** Un changement qui ne touche que des `.md` ne reconstruit rien, mais il n'est pas exempt de go.
2. ⚠️ **Ne jamais écrire dans la section « 🗣️ Notes de Gautier » d'une carte.** Les statuts Validée, Prêt, À MEP et Terminé sont réservés à Gautier.
3. ⚠️ **`content` et `sectionsBody` d'un Record s'écrivent en remplacement TOTAL : relire le corps existant et tout réémettre, Notes de Gautier comprises.** Seules les `properties` sont mergées ; `null` y supprime une clé.
4. La confidentialité passe par `isPageAccessible(page, userId, isService)` ou `pageVisibilityFilter(userId, isService)`. Jamais de test `visibility` écrit à la main : `service-account.test.ts` le refuse.
5. Accès refusé = 404, jamais 403. L'ordre est fixe : accès (404), puis rôle (403 « Rôle insuffisant »). Les gates `hasRole` vivent dans le handler, jamais dans `proxy.ts`.
6. Toute lecture filtre `trashedAt: null`. Un DELETE de page ou de record met à la corbeille ; seul `?permanent=1` (admin) est définitif.
7. Tout id de rattachement reçu (parent, section, relation, page de patch notes) est vérifié : même espace que celui contrôlé, et parent accessible.
8. L'identité vient de `getSession()` et de rien d'autre : aucune route ne décide d'un accès sur un `userId` ou un email reçu en paramètre.
9. `nextPosition(model, where, tx)` s'appelle dans la `$transaction` de la création. Page et Section gardent leur propre MAX+1.
10. Les champs JSON passent par les `parse*/serialize*` de `lib/db.ts`. Les exceptions connues sont listées dans la doctrine `api`.
11. Le défaut sûr n'accorde rien : une option qui ouvre un droit (`grant`, `withServiceAccounts`) vaut `false` et se passe explicitement.
12. Écrire en base d'abord, prévenir ensuite. L'échec d'un email ou d'une notification n'annule jamais l'écriture, et il est remonté (`emailSent`, `emailReason`).
13. L'email d'un membre ne sort jamais vers un board, un fil ou le MCP : seul le `displayName` est exposé.
14. Tout email passe par `normalizeEmail` avant une recherche ou une écriture.
15. `src/lib/client/**` n'est jamais importé côté serveur. Exception connue : `viewFilters.ts`, qui doit rester pur.
16. Une variable d'env lue par `src/` entre, dans le même commit, dans `.env.example` et dans le bloc `environment:` du compose. Une garde n'est « livrée » qu'après lecture de sa valeur dans le conteneur.

## Avant de toucher à…

La doctrine (`docs/doctrine/<domaine>.md`) donne le détail de chaque domaine. Elle ne se charge jamais seule : lis-la avant de toucher au domaine concerné. Le pourquoi daté est dans `docs/adr/`. Les rules de `.claude/rules/` (une par doctrine, même nom, seul sous-dossier de `.claude/` suivi par git) rappellent les invariants du domaine dès qu'un de ses fichiers est lu : elles ne dispensent pas de lire la doctrine.

| Si tu touches à… | Lis d'abord `docs/doctrine/…` |
|---|---|
| Schéma Prisma, pages et arbre, positions, corbeille | `modele.md` |
| Une route API, le proxy, les tests d'API | `api.md` |
| Rôles, pages privées, compte de service, règles de transition | `roles-permissions.md` |
| Connexion, invitations, lien email, rate-limit, comptes SSO, profil | `auth-invitations.md` |
| La cloche (notifications) | `notifications.md` |
| Propriétés, révisions, templates, commentaires, autosave d'un record | `records.md` |
| Vues, filtres, jeton `@me`, kanban | `vues.md` |
| Sprints, backlog, notes de version | `sprints-backlog.md` |
| Images, pièces jointes, fichiers servis, quota d'upload | `uploads.md` |
| Composants, thème, drag & drop, dialogues, fetcher et SWR | `ui.md` |
| CI/CD, Pi, sauvegardes, migrations, variables d'env, scripts | `deploiement.md` |
| Pont MCP, outils `notes_*` | `mcp.md` |

## Dev Loop

- **Le process vit dans notes :** page Dev Loop (`cmrci2y9i000b01nnmkel8m61`), qui fait foi, et Guide du process (`cmrcjyk8w003w01nn3b0pkk7y`). Règle mère : les notes font foi, pas la conversation.
- **La boucle :** fiche Discovery (`cmrci44xz000c01nnbg5iumkc`) → Validée par Gautier → ticket dans le 📦 Board (`cmri206zi009r01juyyyly8he`) → branche → PR → merge, c'est-à-dire déploiement.
- **Statuts du Board :** Backlog · Cadrage · Prêt · En dev · Review / Tests · Recette préprod · À MEP · Déployé T1 / à contrôler · Terminé.
- **Permis à l'IA :**
  - Backlog → Cadrage, sur ordre explicite seulement ;
  - Prêt → En dev ;
  - En dev → Review / Tests → Recette préprod, sous la DoD : CI verte, chaque critère d'acceptation couvert par un test, self-review du diff, 🧾 Recette remplie, Cahier de tests à jour pour tout test E2E modifié.
  - Si la CI est rouge, retour en dev.
- **Fin de session ou blocage :** mettre à jour 🤝 État courant, passer `Main à = Gautier`, s'arrêter.
- **Ne jamais rien supprimer :** « 🗑️ Abandonnée » côté Discovery ; côté Board, la carte reste au Backlog avec la raison écrite, `Main à = Gautier`. Ne pas inventer de statut.
- **🗣️ Notes de Gautier :**
  - lire la section en priorité, intégrer son contenu au bon endroit, l'ajouter vide si elle manque ;
  - sur une carte sectionnée, `notes_update_record` avec `sections_body` met à jour par libellé : ne jamais citer celui des Notes de Gautier.
- **Tiering T1/T2/T3 :** posé sur les cartes, mais aucun circuit n'est actif. Une étiquette T1 ne dispense de rien.
- **Git :**
  - une branche par ticket, une PR à chaque fois, jamais de commit direct sur `main` ;
  - `git push` avant `gh pr create`, car gh ouvre la PR depuis l'état distant ;
  - auto-merge toléré pour un petit correctif low-risk à CI verte. Go explicite pour l'auth, les données, les migrations, le schéma, la sécurité et tout changement de taille.

## Ce qu'il ne faut pas faire

- Pas de Postgres tant que SQLite suffit ; pas d'autre framework CSS que Tailwind ; pas de state global (SWR + `useState`) ; pas de tRPC ni de GraphQL.
- Pas de `any` : `unknown` + narrowing. Seule exception : les trois `initialContent … as any` de BlockNote. Leurs `eslint-disable` sont inertes, faute de linter.
- Pas de classe Tailwind `dark:` (le thème est `data-theme`). Pas de `window.confirm` ni de `window.alert` (c'est `useDialog()`).
- Un commentaire explique le pourquoi, jamais le quoi.

## Règles pour Claude Code

1. Lire le code existant avant d'éditer ; ne pas réinventer ce qui existe dans `lib/`.
2. Faire de petits changements cohérents, pas douze fichiers pour une micro-modification.
3. Proposer avant de casser un contrat (schéma, forme d'une route) et attendre la validation.
4. En cas d'hésitation, demander.
5. Tester et donner les résultats : « à tester » ne suffit pas.
6. Ne rien annoncer (CI verte, déployé, corrigé) sans l'avoir constaté. Un test de non-régression se voit d'abord rouge sur l'ancien code.
7. Si la doc contredit le code, croire le code et corriger la doc dans le même lot.
8. zod v4 : `z.record(z.string(), z.unknown())`, jamais `z.record(z.unknown())`.
