import { NextResponse } from "next/server";
import { prisma } from "./prisma";
import { deniedTransitions, type TransitionActor, type TransitionRule } from "./permissionRules";
import { parseManyDatabaseProperties, type RecordProperties } from "./db";

/**
 * Garde de transition pour les routes qui CRÉENT une carte (POST records,
 * duplicate) — côté SERVEUR, contrairement à `lib/permissionRules.ts` qui est
 * pur et partagé avec le navigateur.
 *
 * Une création fait « entrer » chaque valeur posée : `before` vaut donc null.
 * Sans ce garde, créer une carte directement dans la colonne verrouillée — ou y
 * dupliquer une carte qui s'y trouve déjà — contournerait tout le lot d'un clic,
 * au rang éditeur, depuis les 5 vues.
 *
 * Retourne une réponse 403 prête à renvoyer, ou null si tout passe.
 */
export async function checkCreationTransitions(
  databaseId: string,
  properties: RecordProperties,
  actor: TransitionActor
): Promise<NextResponse | null> {
  const keys = Object.keys(properties ?? {});
  if (keys.length === 0) return null;

  const rows = await prisma.databaseProperty.findMany({
    where: { id: { in: keys }, databaseId },
  });
  const denied: { propertyId: string; optionIds: string[] }[] = [];

  for (const prop of parseManyDatabaseProperties(rows)) {
    const rules = (prop.config as { rules?: TransitionRule[] }).rules;
    if (!rules?.length) continue;
    const optionIds = deniedTransitions(rules, null, properties[prop.id], actor);
    if (optionIds.length > 0) denied.push({ propertyId: prop.id, optionIds });
  }

  if (denied.length === 0) return null;
  return NextResponse.json(
    { error: "Transition non autorisée", details: { denied } },
    { status: 403 }
  );
}
