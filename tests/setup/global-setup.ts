import { execSync } from "node:child_process";
import { mkdirSync, rmSync } from "node:fs";

// Crée une DB SQLite jetable + applique le schéma Prisma AVANT les tests.
// Isolée de dev.db / prod : les tests API tapent une base propre à chaque run.
const DB_URL = "file:./tests/.tmp/vitest.db";

export default function setup() {
  mkdirSync("tests/.tmp", { recursive: true });
  for (const suffix of ["", "-wal", "-shm"]) {
    rmSync(`tests/.tmp/vitest.db${suffix}`, { force: true });
  }
  execSync(`npx prisma db push --url "${DB_URL}" --accept-data-loss`, {
    stdio: "inherit",
    env: { ...process.env, DATABASE_URL: DB_URL },
  });
}
