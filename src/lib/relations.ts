import { prisma } from "./prisma";
import { parseManyDatabaseProperties } from "./db";
import type { RecordProperties } from "./db";

export type RelationCheck = { ok: true } | { ok: false; error: string };

/**
 * Garde-fou d'intégrité référentielle des propriétés `relation`.
 *
 * `Record.properties` est un JSON libre : sans ce contrôle, l'API accepterait
 * n'importe quel id. On exige donc que toute valeur écrite sur une propriété
 * relation soit un TABLEAU d'ids de records appartenant réellement à la
 * database cible (`config.targetDatabaseId`).
 *
 * `null`/`undefined` sont laissés passer : c'est la suppression de la clé
 * (convention de mergeRecordProperties).
 */
export async function validateRelationValues(
  databaseId: string,
  properties: RecordProperties
): Promise<RelationCheck> {
  const keys = Object.keys(properties);
  if (keys.length === 0) return { ok: true };

  const rows = await prisma.databaseProperty.findMany({
    where: { databaseId, id: { in: keys } },
  });
  const relationProps = parseManyDatabaseProperties(rows).filter((p) => p.type === "relation");
  if (relationProps.length === 0) return { ok: true };

  for (const prop of relationProps) {
    const value = properties[prop.id];
    if (value === null || value === undefined) continue;

    if (!Array.isArray(value) || value.some((v) => typeof v !== "string")) {
      return { ok: false, error: `La propriété « ${prop.name} » attend un tableau d'ids de records.` };
    }

    const ids = [...new Set(value as string[])];
    if (ids.length === 0) continue;

    const targetDatabaseId = (prop.config as { targetDatabaseId?: string }).targetDatabaseId;
    if (!targetDatabaseId) {
      return { ok: false, error: `La propriété « ${prop.name} » n'a pas de database cible.` };
    }

    const found = await prisma.record.count({
      where: { databaseId: targetDatabaseId, id: { in: ids }, trashedAt: null },
    });
    if (found !== ids.length) {
      return {
        ok: false,
        error: `Certains records liés n'appartiennent pas à la database cible de « ${prop.name} ».`,
      };
    }
  }

  return { ok: true };
}
