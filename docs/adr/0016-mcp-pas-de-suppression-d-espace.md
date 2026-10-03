# 0016 : La suppression d'un espace n'est pas exposée au MCP

- Date : 2026-07-30
- Référence : commit `d7ee67c` du dépôt gotyeah-mcp (PR gotyeah-mcp #5) ; reflété ici par `cb9bd25` (PR #41)
- Statut : acceptée

## Contexte
Le lot CRUD du MCP comblait les trous de la matrice entité × verbe, espaces compris.
Or `DELETE /api/workspaces/[id]` (admin) supprime l'espace en cascade par clés étrangères, sans garde de vacuité, et `Workspace` n'a pas de `trashedAt` : rien ne se restaure.

## Décision
`delete_workspace` n'est pas exposé au MCP et ne le sera pas. Il figure comme `Gap` motivé dans `notes_entities.py`.
La suppression d'un espace reste un geste humain, fait dans l'interface web.

## Conséquences
Un agent ne peut pas détruire un espace entier en un appel, alors même que le compte « IA » est admin des espaces créés par `POST /api/workspaces` (cf. 0034).
`test_notes_entities.py` échoue si un outil enregistré n'est pas déclaré dans la table, et exige que `workspace.delete` reste un `Gap` dont la raison cite la cascade : exposer ce verbe oblige à modifier ce test, donc à revenir sur cette décision.
Le renommage d'un espace n'existe nulle part non plus, mais c'est un manque côté notes, pas une décision.
