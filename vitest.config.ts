import { defineConfig } from "vitest/config";
import tsconfigPaths from "vite-tsconfig-paths";

// Runner unitaire + API (Route Handlers). Environnement node, une DB SQLite
// JETABLE (tests/.tmp/vitest.db) créée par le globalSetup — jamais la dev.db.
export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    environment: "node",
    include: ["tests/unit/**/*.test.ts", "tests/api/**/*.test.ts"],
    globalSetup: ["tests/setup/global-setup.ts"],
    // DB SQLite unique et partagée : deux fichiers de tests lançant des
    // transactions interactives en parallèle se verrouillent mutuellement
    // (better-sqlite3 sérialise les écritures → "Operation has timed out").
    // On exécute donc les fichiers de tests séquentiellement.
    fileParallelism: false,
    env: {
      DATABASE_URL: "file:./tests/.tmp/vitest.db",
      AUTH_SECRET: "vitest-secret-placeholder-0123456789-abcdef",
      // Pont MCP OFF par défaut dans les tests (aucune surface ajoutée).
      MCP_SHARED_SECRET: "",
    },
  },
});
