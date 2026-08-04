import { prisma } from "./prisma";
import { parseManyDatabaseProperties } from "./db";
import type { RecordProperties } from "./db";

export type AssigneeCheck = { ok: true } | { ok: false; error: string };

/**
 * Garde-fou des propriétés `user` (assignés), pendant de validateRelationValues.
 *
 * `Record.properties` est un JSON libre : sans ce contrôle, n'importe quel id —
 * y compris celui d'un membre d'un AUTRE espace — deviendrait un assigné, et
 * l'UI afficherait ensuite son nom (fuite d'identité inter-espaces). On exige
 * donc un TABLEAU d'ids d'utilisateurs réellement membres de l'espace hôte.
 *
 * ⚠️ À n'appeler que sur le patch ENTRANT, jamais sur le résultat du merge :
 * sinon un membre retiré rendrait impossible toute écriture ultérieure sur le
 * record (400 sur une valeur qu'on n'a pas touchée). C'est ce qui rend le
 * « lien mort toléré » gratuit — même choix que pour relation.
 *
 * `null`/`undefined` passent : c'est la suppression de la clé (mergeRecordProperties).
 */
export async function validateUserValues(
  workspaceId: string,
  databaseId: string,
  properties: RecordProperties
): Promise<AssigneeCheck> {
  const keys = Object.keys(properties);
  if (keys.length === 0) return { ok: true };

  const rows = await prisma.databaseProperty.findMany({
    where: { databaseId, id: { in: keys } },
  });
  const userProps = parseManyDatabaseProperties(rows).filter((p) => p.type === "user");
  if (userProps.length === 0) return { ok: true };

  for (const prop of userProps) {
    const value = properties[prop.id];
    if (value === null || value === undefined) continue;

    if (!Array.isArray(value) || value.some((v) => typeof v !== "string")) {
      return {
        ok: false,
        error: `La propriété « ${prop.name} » attend un tableau d'identifiants de membres.`,
      };
    }

    const ids = [...new Set(value as string[])];
    if (ids.length === 0) continue;

    const found = await prisma.membership.count({
      where: { workspaceId, userId: { in: ids } },
    });
    if (found !== ids.length) {
      return {
        ok: false,
        error: `Certains utilisateurs assignés à « ${prop.name} » ne sont pas membres de cet espace.`,
      };
    }
  }

  return { ok: true };
}
