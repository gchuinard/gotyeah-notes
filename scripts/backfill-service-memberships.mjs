// One-shot IDEMPOTENT : rattache les comptes de SERVICE (User.isService) aux
// espaces qui existent DÉJÀ. Le rattachement automatique posé dans
// `createWorkspaceWithDefaults` ne vaut que pour les espaces créés APRÈS lui —
// sans ce rattrapage, le pont MCP reste muet sur tout l'existant.
//
//   node scripts/backfill-service-memberships.mjs [--email=…] [--workspace=…] [--execute]
//
// SANS --execute, c'est un ESSAI À BLANC : le plan complet est affiché, rien
// n'est écrit. Sur le Pi, passer par le service builder (cf. README §Migrations),
// PAS `docker exec gotyeah_notes` — l'image d'app n'embarque ni scripts/ ni les
// dépendances :
//
//   docker compose run --rm --entrypoint sh migrate -c \
//     "node scripts/backfill-service-memberships.mjs --execute"
//
// ⚠️ CE QUE ÇA OUVRE, et pourquoi le plan le chiffre. Un compte de service voit
// les pages PRIVÉES des espaces où il est membre (lib/workspace.ts >
// isPageAccessible) — c'est son exemption, et c'est tout l'intérêt du pont, mais
// ça veut dire que rattacher un espace y donne accès aux pages privées de TOUS
// ses membres, pas seulement à celles de qui lance le script. Le plan affiche
// donc, par espace, combien de pages privées et de qui. Lis-le avant --execute.
//
// ⚠️ SQL direct et pas le client Prisma : le client généré (provider
// "prisma-client") est du TypeScript aux imports sans extension, que le
// résolveur ESM de Node refuse. Même raison que create-service-account.mjs.

import Database from "better-sqlite3";
import { cuid, dbPathFromUrl, prismaNow } from "./create-service-account.mjs";

const DEFAULT_ROLE = "admin";

// ─── Planification (pure lecture, importée par les tests) ─────────────────────

/**
 * Une ligne de plan. Les champs sont optionnels parce qu'une ligne est de l'une
 * de deux natures : « déjà membre » (porte `skip`) ou « à rattacher » (porte le
 * reste). Le typedef est explicite plutôt qu'inféré — sans lui, TypeScript
 * déduit une union depuis les littéraux et refuse l'accès à `.skip` côté tests.
 *
 * @typedef {object} BackfillRow
 * @property {{ id: string, email: string, displayName: string }} service
 * @property {{ id: string, name: string }} workspace
 * @property {string} [skip] Rôle déjà en place — rien à faire.
 * @property {string} [role] Rôle à poser.
 * @property {boolean} [orphan] Le compte n'a AUCUNE membership : son espace par défaut se joue ici.
 * @property {number} [privatePages] Pages privées que le rattachement rendrait lisibles.
 * @property {string[]} [privateOwners] À qui elles appartiennent.
 */

/**
 * Établit, sans rien écrire, la liste des rattachements manquants.
 *
 * Renvoie une ligne par couple (compte de service, espace) : soit `skip` avec le
 * rôle déjà en place, soit un rattachement à créer, chiffré par ce qu'il ouvre.
 *
 * @param {{ email?: string, workspaceId?: string, role?: string }} [options]
 * @returns {BackfillRow[]}
 */
export function planBackfill(db, options = {}) {
  // Déstructuré DANS le corps et pas dans la signature : un `@param` JSDoc se
  // rattache par NOM, il ne voit pas un motif de déstructuration — et sans lui
  // TypeScript déduit le type du seul `= {}`, donc perd `email` et `workspaceId`.
  const { email, workspaceId, role = DEFAULT_ROLE } = options;

  const services = email
    ? db
        .prepare("SELECT id, email, displayName FROM User WHERE isService = 1 AND email = ?")
        .all(email.trim().toLowerCase())
    : db
        .prepare("SELECT id, email, displayName FROM User WHERE isService = 1 ORDER BY createdAt")
        .all();

  const workspaces = workspaceId
    ? db.prepare("SELECT id, name FROM Workspace WHERE id = ?").all(workspaceId)
    : db.prepare("SELECT id, name FROM Workspace ORDER BY createdAt").all();

  const existingCount = db.prepare("SELECT COUNT(*) AS n FROM Membership WHERE userId = ?");
  const membership = db.prepare("SELECT role FROM Membership WHERE userId = ? AND workspaceId = ?");
  const privatePages = db.prepare(
    `SELECT COUNT(*) AS n FROM Page
     WHERE workspaceId = ? AND visibility = 'private' AND trashedAt IS NULL`
  );
  const privateOwners = db.prepare(
    `SELECT DISTINCT u.displayName AS name FROM Page p
     JOIN User u ON u.id = p.ownerId
     WHERE p.workspaceId = ? AND p.visibility = 'private' AND p.trashedAt IS NULL
     ORDER BY u.displayName`
  );

  const rows = [];
  for (const s of services) {
    // ⚠️ Le pont MCP fixe l'espace COURANT d'une identité incarnée à sa
    // membership la plus ANCIENNE (lib/session.ts > firstWorkspaceId). Un compte
    // qui n'en a encore aucune verra donc son espace par défaut décidé par ce
    // script — on le signale plutôt que de le laisser se découvrir à l'usage.
    const orphan = existingCount.get(s.id).n === 0;
    for (const w of workspaces) {
      const already = membership.get(s.id, w.id);
      if (already) {
        rows.push({ service: s, workspace: w, skip: already.role });
        continue;
      }
      rows.push({
        service: s,
        workspace: w,
        role,
        orphan,
        privatePages: privatePages.get(w.id).n,
        privateOwners: privateOwners.all(w.id).map((r) => r.name),
      });
    }
  }
  return rows;
}

/**
 * Écrit les rattachements planifiés, en UNE transaction.
 *
 * ⚠️ L'horodatage passe par `prismaNow()`, JAMAIS par `CURRENT_TIMESTAMP` : le
 * format de ce dernier trie AVANT tout ce que l'ORM a écrit le même jour, ce qui
 * ferait du dernier espace rattrapé l'espace par DÉFAUT du compte de service.
 * Le commentaire complet est sur prismaNow, dans create-service-account.mjs.
 *
 * @param {BackfillRow[]} rows
 * @returns {number} Nombre de memberships réellement créées.
 */
export function applyBackfill(db, rows) {
  const todo = rows.filter((r) => !r.skip);
  const insert = db.prepare(
    `INSERT INTO Membership (id, userId, workspaceId, role, createdAt)
     VALUES (?, ?, ?, ?, ?)`
  );
  const run = db.transaction(() => {
    for (const r of todo) insert.run(cuid(), r.service.id, r.workspace.id, r.role, prismaNow());
    return todo.length;
  });
  return run();
}

// ─── CLI ──────────────────────────────────────────────────────────────────────

function arg(name, fallback) {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
}

async function main() {
  const db = new Database(dbPathFromUrl(process.env.DATABASE_URL));
  db.pragma("foreign_keys = ON");

  const rows = planBackfill(db, { email: arg("email"), workspaceId: arg("workspace") });
  if (rows.length === 0) {
    console.log("Aucun compte de service (User.isService) — rien à faire.");
    db.close();
    return;
  }

  const todo = rows.filter((r) => !r.skip);
  for (const r of rows) {
    if (r.skip) {
      console.log(`   = ${r.service.displayName} · « ${r.workspace.name} » — déjà membre (${r.skip})`);
      continue;
    }
    const qui = r.privateOwners.length ? ` de ${r.privateOwners.join(", ")}` : "";
    console.log(
      `   + ${r.service.displayName} · « ${r.workspace.name} » → ${r.role}` +
        `  [ouvre ${r.privatePages} page(s) privée(s)${qui}]` +
        (r.orphan ? "  ⚠️ AUCUNE membership existante : cet espace peut devenir son espace par défaut" : "")
    );
  }

  if (todo.length === 0) {
    console.log("\nRien à rattacher : tout est déjà en place.");
    db.close();
    return;
  }

  if (!process.argv.includes("--execute")) {
    console.log(`\nESSAI À BLANC — ${todo.length} rattachement(s) à créer. Relance avec --execute pour écrire.`);
    db.close();
    return;
  }

  const n = applyBackfill(db, rows);
  console.log(`\n✅ ${n} rattachement(s) créé(s).`);
  db.close();
}

// Exécuté seulement en CLI : le module est importé tel quel par les tests.
if (process.argv[1] && process.argv[1].endsWith("backfill-service-memberships.mjs")) {
  await main();
}
