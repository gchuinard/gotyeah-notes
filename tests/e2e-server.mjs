// Serveur de l'app pour les tests E2E Playwright.
// Choix : `next dev` (et non `next start`) car le cookie de session est posé en
// `secure` dès NODE_ENV=production (login/register), ce qui l'empêche de circuler
// sur http://localhost. En dev, secure=false → le flux d'auth fonctionne en E2E.
// La DB est un fichier JETABLE HORS du dossier projet (os.tmpdir) : évite le bug
// connu du watcher next dev qui coupe les écritures SQLite (ECONNRESET).
import { execSync, spawn } from "node:child_process";
import { rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";

const dbFile = path.join(os.tmpdir(), "gotyeah-notes-e2e.db");
const DATABASE_URL = `file:${dbFile}`;
for (const suffix of ["", "-wal", "-shm"]) rmSync(dbFile + suffix, { force: true });

const env = {
  ...process.env,
  DATABASE_URL,
  LEGACY_LOGIN: "on",
  // Env de test jetable : les specs créent leurs users via POST /api/auth/register,
  // désactivé par défaut en prod (REGISTRATION=off). On le rouvre ici uniquement.
  REGISTRATION: "on",
  AUTH_SECRET: process.env.AUTH_SECRET ?? "e2e-secret-placeholder-0123456789-abcdefghij",
};

execSync(`npx prisma db push --url "${DATABASE_URL}" --accept-data-loss`, { stdio: "inherit", env });

const port = process.env.PORT ?? "3100";
const child = spawn("npx", ["next", "dev", "-p", port], { stdio: "inherit", env, shell: true });
child.on("exit", (code) => process.exit(code ?? 0));
