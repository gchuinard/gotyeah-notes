import { prisma } from "./prisma";

type PositionModel = "databaseProperty" | "record" | "view" | "sprint";

type AggregateDelegate = {
  // `position: true` (littéral, pas `boolean`) pour rester assignable depuis les délégués
  // Prisma réels — ceux du client global comme ceux d'un client de transaction.
  aggregate(args: {
    where: { databaseId: string };
    _max: { position: true };
  }): Promise<{ _max: { position: number | null } }>;
};

// Client Prisma OU client de transaction : les deux exposent les mêmes délégués.
type PositionClient = Record<PositionModel, AggregateDelegate>;

/**
 * Calcule la prochaine position pour un modèle ordonné (DatabaseProperty,
 * Record, View, Sprint) dans une database donnée.
 * Formule : MAX(position) + 1000, ou 1000 si la database est vide.
 * Le gap de 1000 permet d'insérer entre deux items sans renuméroter.
 *
 * `client` : passer le client de `$transaction` pour que le MAX(position) et le
 * create qui suit soient atomiques — sinon deux créations concurrentes lisent le
 * même MAX et obtiennent la même position (tri instable). Défaut : le client global.
 */
export async function nextPosition(
  model: PositionModel,
  where: { databaseId: string },
  client: PositionClient = prisma as unknown as PositionClient
): Promise<number> {
  const delegate = client[model] as unknown as AggregateDelegate;
  const result = await delegate.aggregate({ where, _max: { position: true } });
  return (result._max.position ?? 0) + 1000;
}
