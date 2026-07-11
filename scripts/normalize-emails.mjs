// One-shot : normalise User.email (trim + minuscules) sur la base EXISTANTE.
// À lancer une fois, côté prod, dans le conteneur (client Prisma + DATABASE_URL présents) :
//   docker exec -w /app gotyeah_notes node scripts/normalize-emails.mjs
// Refuse d'agir s'il détecte des collisions de casse (2 comptes → même email) : à
// trancher à la main d'abord (sinon violation de la contrainte @unique).
import { PrismaClient } from "../generated/prisma/client.js";
import { planEmailNormalization } from "../src/lib/oidc.ts";

const prisma = new PrismaClient();

async function main() {
  const users = await prisma.user.findMany({ select: { id: true, email: true } });
  const { updates, collisions } = planEmailNormalization(users);

  if (collisions.length > 0) {
    console.error("❌ Collisions de casse — corrige-les à la main AVANT de relancer :");
    for (const n of collisions) {
      const conflicting = users.filter((u) => u.email.trim().toLowerCase() === n);
      console.error(`   ${n} ← ${conflicting.map((u) => `${u.email} (${u.id})`).join(", ")}`);
    }
    process.exitCode = 1;
    return;
  }

  for (const u of updates) {
    await prisma.user.update({ where: { id: u.id }, data: { email: u.email } });
  }
  console.log(`✅ ${updates.length} email(s) normalisé(s) sur ${users.length}.`);
}

main().finally(() => prisma.$disconnect());
