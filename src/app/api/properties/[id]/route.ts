import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/session";
import { checkPropertyAccess, hasRole } from "@/lib/workspace";
import type { TransitionRule } from "@/lib/permissionRules";
import {
  serializeDatabaseProperty,
  parseDatabaseProperty,
  parseManyRecords,
  parseManyViews,
  removePropertyKey,
  type PropertyConfig,
  type ParsedDatabaseProperty,
  type SelectOption,
} from "@/lib/db";
import {
  validatePropertyConfig,
  removedOptionIds,
  findReferencedOptionIds,
} from "@/lib/propertyConfig";

const patchPropertySchema = z.object({
  name: z.string().min(1).max(100).optional(),
  config: z.record(z.string(), z.unknown()).optional(),
  position: z.number().optional(),
});

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getSession();
  if (!user) return NextResponse.json({ error: "Non authentifié" }, { status: 401 });

  const { id } = await params;

  const body = await req.json().catch(() => null);

  if (body && typeof body === "object" && "type" in body) {
    return NextResponse.json({ error: "type cannot be changed" }, { status: 400 });
  }

  const result = patchPropertySchema.safeParse(body);
  if (!result.success) {
    return NextResponse.json(
      { error: "Validation failed", details: result.error.flatten() },
      { status: 400 }
    );
  }

  const access = await checkPropertyAccess(id, user.id);
  if (!access) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (!hasRole(access.membership, "editor")) {
    return NextResponse.json({ error: "Rôle insuffisant" }, { status: 403 });
  }

  const { name, config: rawConfig, position } = result.data;

  // Config EFFECTIF = ce qu'on s'apprête réellement à écrire. Tout doit porter
  // dessus — validation, protection des options, écriture — sinon on persiste un
  // objet qui échoue sa propre validation (cf. le report des `rules` plus bas).
  let effectiveConfig = rawConfig as PropertyConfig | undefined;

  if (rawConfig !== undefined) {
    const existingRow = await prisma.databaseProperty.findUnique({ where: { id } });
    if (!existingRow) return NextResponse.json({ error: "Not found" }, { status: 404 });

    const cfgType = (rawConfig as { type?: unknown }).type;
    if (cfgType !== existingRow.type) {
      return NextResponse.json(
        { error: "config.type must match type" },
        { status: 400 }
      );
    }

    const prevConfig = parseDatabaseProperty(existingRow).config as {
      options?: SelectOption[];
      rules?: TransitionRule[];
    };
    const incoming = rawConfig as { rules?: TransitionRule[]; options?: SelectOption[] };

    // ⚠️ EXCEPTION ASSUMÉE au « config = remplacement TOTAL » du projet, et
    // seulement sur la clé `rules` : le MCP (notes_add_select_option…) et le
    // popover reconstruisent le config sans la connaître, et l'effaceraient.
    // Une clé `rules` ABSENTE reporte donc l'existant ; pour retirer une règle,
    // il faut envoyer un tableau explicite.
    const nextRules = incoming.rules ?? prevConfig.rules;
    if (nextRules !== undefined) {
      effectiveConfig = { ...(rawConfig as object), rules: nextRules } as unknown as PropertyConfig;
    }

    // TROU DE SÉCURITÉ SANS CE GATE : la route est ouverte aux ÉDITEURS et le
    // config s'écrit en entier. Un éditeur restreint pourrait donc réécrire les
    // règles et se dé-restreindre lui-même. On gate au CHAMP plutôt que la route
    // (un éditeur doit continuer à renommer une option), et sur la DIFFÉRENCE
    // plutôt que la présence — le popover réémet `{...config}` à chaque
    // renommage, gater la présence lui vaudrait un 403 systématique.
    const rulesChanged =
      JSON.stringify(prevConfig.rules ?? []) !== JSON.stringify(nextRules ?? []);
    if (rulesChanged && !hasRole(access.membership, "admin")) {
      return NextResponse.json(
        { error: "Rôle insuffisant : seuls les administrateurs modifient les règles d'accès." },
        { status: 403 }
      );
    }

    // Cas particulier du report : un client qui ignore les règles (le MCP, qui
    // ne les expose pas) retire une option encore gouvernée. Le config effectif
    // est alors invalide — mais un « Validation failed » brut ne lui dirait pas
    // quoi faire. On nomme le motif AVANT la validation générique.
    if (incoming.rules === undefined && nextRules?.length) {
      const optionIds = new Set(
        ((rawConfig as { options?: SelectOption[] }).options ?? []).map((o) => o.id)
      );
      const orphaned = nextRules.filter((r) => !optionIds.has(r.toOptionId));
      if (orphaned.length > 0) {
        return NextResponse.json(
          {
            error:
              "Option protégée par une règle d'accès : retire d'abord la règle (menu de la colonne, réservé aux administrateurs).",
            details: { optionIds: orphaned.map((r) => r.toOptionId) },
          },
          { status: 400 }
        );
      }
    }

    const validation = validatePropertyConfig(effectiveConfig);
    if (!validation.ok) {
      return NextResponse.json(
        { error: "Validation failed", details: validation.details },
        { status: 400 }
      );
    }

    // v1 : add / rename / recolor seulement. Retirer une option ENCORE référencée
    // (record, View.config.doneStatusOptionId, filtre de vue ou RÈGLE d'accès)
    // orphelinerait la donnée → 400.
    if (existingRow.type === "select" || existingRow.type === "multiselect") {
      const nextOptions = (rawConfig as { options: SelectOption[] }).options;
      const removed = removedOptionIds(prevConfig.options ?? [], nextOptions);

      if (removed.length > 0) {
        const [recordRows, viewRows] = await Promise.all([
          prisma.record.findMany({ where: { databaseId: access.databaseId } }),
          prisma.view.findMany({ where: { databaseId: access.databaseId } }),
        ]);
        const referenced = findReferencedOptionIds(
          id,
          removed,
          parseManyRecords(recordRows),
          parseManyViews(viewRows),
          nextRules ?? []
        );
        if (referenced.length > 0) {
          // Le motif « règle » est distingué : sans ça, le MCP reçoit un 400 sans
          // issue possible (aucun outil notes_* n'expose les règles) — exactement
          // le mensonge de description que le lot du 30/07 a corrigé ailleurs.
          const blockedByRule = referenced.filter((o) =>
            (nextRules ?? []).some((r) => r.toOptionId === o)
          );
          return NextResponse.json(
            {
              error:
                blockedByRule.length === referenced.length
                  ? "Option protégée par une règle d'accès : retire d'abord la règle (menu de la colonne, réservé aux administrateurs)."
                  : "Option référencée : impossible de la supprimer",
              details: { optionIds: referenced },
            },
            { status: 400 }
          );
        }
      }
    }
  }

  const updateData: Partial<ParsedDatabaseProperty> = {};
  if (name !== undefined) updateData.name = name;
  if (rawConfig !== undefined) updateData.config = effectiveConfig as PropertyConfig;
  if (position !== undefined) updateData.position = position;

  const updated = await prisma.databaseProperty.update({
    where: { id },
    data: serializeDatabaseProperty(updateData),
  });

  return NextResponse.json(parseDatabaseProperty(updated));
}

export async function DELETE(
  _: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getSession();
  if (!user) return NextResponse.json({ error: "Non authentifié" }, { status: 401 });

  const { id } = await params;

  const access = await checkPropertyAccess(id, user.id);
  if (!access) return NextResponse.json({ error: "Not found" }, { status: 404 });
  // Suppression DÉFINITIVE + purge de la clé dans tous les records : admin.
  if (!hasRole(access.membership, "admin")) {
    return NextResponse.json({ error: "Rôle insuffisant" }, { status: 403 });
  }

  const property = await prisma.databaseProperty.findUnique({
    where: { id },
    select: { type: true },
  });
  if (property?.type === "title") {
    return NextResponse.json({ error: "Cannot delete the title property" }, { status: 400 });
  }

  await prisma.$transaction(async (tx) => {
    const records = await tx.record.findMany({
      where: { databaseId: access.databaseId },
    });

    const updates = removePropertyKey(records, id);

    await Promise.all(
      updates.map((u) =>
        tx.record.update({
          where: { id: u.id },
          data: { properties: u.properties },
        })
      )
    );

    await tx.databaseProperty.delete({ where: { id } });
  });

  return NextResponse.json({ ok: true });
}
