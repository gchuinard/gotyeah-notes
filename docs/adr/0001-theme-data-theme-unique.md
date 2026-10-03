# 0001 : Un seul système de thème : data-theme

- Date : 2026-06-26
- Référence : commit `0abbc1d` ; le curseur des boutons suit dans `138ed65`, le même jour
- Statut : acceptée

## Contexte
L'attribut `data-theme` de `<html>`, posé au SSR depuis le cookie `app-theme` et choisi dans Réglages → Apparence, cohabitait avec les restes d'un ancien mode sombre : `ThemeToggle.tsx`, déjà du code mort, et des classes Tailwind `dark:`.
Sans `@custom-variant dark`, ces classes suivent le `prefers-color-scheme` de l'OS et non le thème choisi ; l'éditeur BlockNote, lui, ne recevait aucune prop `theme`.

## Décision
Le thème est porté par le seul attribut `data-theme` et par les variables CSS que chaque thème définit dans `globals.css` (`--bg`, `--surface`, `--text`…) ; `ThemeToggle.tsx` et toutes les classes `dark:` sont supprimés.
BlockNote reçoit `theme={useThemeMode()}`, qui déduit clair ou sombre de la luminance de `--bg`, et ses variables `--bn-colors-*` sont mappées sur la palette du site.

## Conséquences
On stylise par `text-[var(--text)]` ou `bg-[var(--surface)]`, jamais par `dark:`, qui réintroduirait un thème piloté par l'OS.
Aucune garde automatique n'interdit `dark:` : la règle ne tient que par la doctrine `ui` et la relecture.
