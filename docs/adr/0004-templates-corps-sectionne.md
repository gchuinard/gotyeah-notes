# 0004 : Templates par espace et corps de carte sectionné

- Date : 2026-06-30
- Référence : commit `a8dc5e6` (daté du 2026-06-29 à 23 h 57), documenté par `1ad8fa8` le 2026-06-30 ; précédé de `d2f2812` et `eb235e2` (modèles ticket et bug codés en dur)
- Statut : acceptée

## Contexte
Les premiers modèles (ticket, puis bug) étaient codés en dur et ne donnaient qu'un corps libre pré-rempli (`Database.recordTemplate`), dont les titres de zone étaient des blocs BlockNote ordinaires.
Il fallait des modèles gérables par espace, qui fixent les colonnes, le regroupement kanban et la structure du corps d'une carte.

## Décision
Un `Template` appartient à un espace et définit `columns`, `kanbanGroupProperty` et des `sections` à libellés fixes ; `POST /api/databases { templateId }` scaffolde colonnes et kanban et estampe `Database.recordSections`.
Une carte d'une database templatée a un corps sectionné (`Record.sectionsBody` = `[{id,label,content}]`) : libellés rendus hors de l'éditeur, un éditeur BlockNote par section.
C'est un opt-in : sans template, la carte garde son corps libre `content`. Les templates fournis vivent en code (`lib/templates.ts`, id `builtin-*`) et sont en lecture seule.

## Conséquences
Aucune migration destructive : les cartes existantes restent en corps libre, et le menu « modèle » du panneau change le template carte par carte, indépendamment du kanban.
Comme `content`, `sectionsBody` s'écrit en remplacement total : une mise à jour qui omet une section l'efface, d'où la relecture du corps avant toute écriture.
