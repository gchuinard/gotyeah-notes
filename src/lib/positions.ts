import { prisma } from "./prisma";

type PositionModel = "databaseProperty" | "record" | "view" | "sprint";

type AggregateDelegate = {
  aggregate(args: {
    where: { databaseId: string };
    _max: { position: boolean };
  }): Promise<{ _max: { position: number | null } }>;
};

/**
 * Calcule la prochaine position pour un modèle ordonné (DatabaseProperty,
 * Record, View, Sprint) dans une database donnée.
 * Formule : MAX(position) + 1000, ou 1000 si la database est vide.
 * Le gap de 1000 permet d'insérer entre deux items sans renuméroter.
 */
export async function nextPosition(
  model: PositionModel,
  where: { databaseId: string }
): Promise<number> {
  const delegate = prisma[model] as unknown as AggregateDelegate;
  const result = await delegate.aggregate({ where, _max: { position: true } });
  return (result._max.position ?? 0) + 1000;
}
