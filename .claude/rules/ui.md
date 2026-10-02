---
paths:
  - "src/{components,contexts,lib/client}/**/*"
  - "src/app/{layout.tsx,globals.css,not-found.tsx}"
  - "e2e/**/*"
---

# L'interface : invariants

- Server Component par défaut, `"use client"` seulement pour de l'état, des effets ou des handlers ; Tailwind en classes inline ; deux contextes seulement (Workspace, Dialog), le reste est SWR et `useState`.
- Le fetch client passe par SWR et le `fetcher` unique de `lib/client/fetcher.ts`, qui lève `HttpError` : jamais `fetch(url).then(r => r.json())` comme fetcher ; `noRetryOn4xx` sur toute clé qui peut répondre 4xx ; un `fetch` impératif teste `res.ok`.
- Une donnée chargée se rend dans l'ordre erreur, chargement, vide, liste ; l'échec de lecture et le refus d'une action sont deux états distincts.
- Mise à jour optimiste : muter le cache avant le fetch, rollback si la réponse n'est pas ok ; liste append-only : `mutate((prev = []) => [cree, ...prev], { revalidate: false })`.
- Dialogues par `useDialog().confirm()` et `.alert()`, jamais `window.confirm`, `alert` ni `prompt` ; menus et popovers par `components/databases/portal.tsx`.
- Glisser-déposer : `MouseSensor` et `TouchSensor`, jamais `PointerSensor` ; `touch-none` seulement sur une poignée dédiée ; positions de records et de vues par `intermediatePosition` ; un contrôle révélé au survol reste visible sous `md`, sans `pointer-events-none`.
- Thème par `data-theme` seulement : jamais de classe `dark:`, surfaces et textes par `var(--…)` ; une fonctionnalité a une porte d'UI atteignable de toutes les vues où elle sert (ADR 0042).
- E2E : cibler par rôle, texte ou attribut `data-*`, jamais par classe de présentation ; tout test E2E ajouté ou modifié est reporté dans la database « Cahier de tests ».

Détail et gardes : `docs/doctrine/ui.md`.
