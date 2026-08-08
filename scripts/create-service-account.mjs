// One-shot IDEMPOTENT : crée (ou remet en état) un compte de SERVICE et sa
// membership sur un espace donné.
//
//   node scripts/create-service-account.mjs --workspace=<id> [--email=…] [--name=…]
//
// Sur le Pi, PAS `docker exec gotyeah_notes` : l'image d'app (stage runner) ne
// contient ni scripts/ ni les dépendances nécessaires. Passer par le service
// one-shot bâti sur le stage builder, qui a déjà le volume et DATABASE_URL :
//
//   docker compose run --rm --entrypoint sh migrate -c \
//     "node scripts/create-service-account.mjs --workspace=<id>"
//
// ⚠️ Pourquoi du SQL direct et pas le client Prisma : le client généré
// (provider "prisma-client") est du TypeScript dont les imports internes n'ont
// pas d'extension — le résolveur ESM de Node les REFUSE. C'est ce qui rend
// scripts/normalize-emails.mjs inexécutable en l'état. better-sqlite3 et
// bcryptjs sont, eux, des dépendances de production importables telles quelles.

import Database from "better-sqlite3";
import bcrypt from "bcryptjs";
import { randomBytes } from "node:crypto";

const DEFAULT_EMAIL = "ia@gotyeah.local";
const DEFAULT_NAME = "IA";

/** Chemin du fichier SQLite depuis un DATABASE_URL Prisma (`file:/data/dev.db`). */
export function dbPathFromUrl(url) {
  if (!url) throw new Error("DATABASE_URL absente.");
  return url.startsWith("file:") ? url.slice("file:".length) : url;
}

/**
 * Identifiant au format cuid v1 (25 caractères, préfixe « c »).
 *
 * Le format n'a aucune portée fonctionnelle — `User.id` est une String — mais
 * un id visuellement différent des autres sauterait aux yeux dans les exports
 * et les logs. Reproduit donc la forme, sans dépendance.
 */
export function cuid() {
  const block = (n) => randomBytes(n).toString("hex").slice(0, n);
  return "c" + Date.now().toString(36) + block(4) + block(4) + block(8);
}

/**
 * Horodatage au format EXACT de Prisma sur SQLite.
 *
 * ⚠️ Ne jamais écrire `CURRENT_TIMESTAMP` dans une colonne DateTime. Prisma y
 * stocke du TEXTE ISO-8601 avec un « T » et un décalage
 * (`2026-08-08T11:02:42.575+00:00`) ; CURRENT_TIMESTAMP écrit
 * `2026-08-08 11:02:42`, séparateur ESPACE. La colonne étant du texte, la
 * comparaison est lexicographique : l'espace (0x20) passe avant le « T » (0x54),
 * donc une ligne écrite ainsi devient la PLUS ANCIENNE de la journée.
 *
 * Ce n'est pas cosmétique : le pont MCP fixe l'espace COURANT d'une identité
 * incarnée à sa membership la plus ancienne (lib/session.ts > firstWorkspaceId).
 * Une membership horodatée par CURRENT_TIMESTAMP déplace donc l'espace de
 * travail par défaut du compte de service, en silence et sans erreur.
 */
export function prismaNow() {
  return new Date().toISOString().replace("Z", "+00:00");
}

/**
 * Crée le compte de service et sa membership, ou remet en état ce qui manque.
 *
 * Idempotent par construction : chaque étape est conditionnée à l'état lu, et
 * la fonction renvoie ce qu'elle a réellement fait. La relancer ne crée jamais
 * de doublon — `User.email` est unique, mais on ne s'appuie pas sur l'erreur.
 *
 * ⚠️ La membership est créée AVANT toute autre : le pont MCP fixe le workspace
 * courant d'une identité incarnée à sa membership la PLUS ANCIENNE
 * (lib/session.ts > firstWorkspaceId, orderBy createdAt asc). Un compte de
 * service dont la première membership pointerait ailleurs travaillerait par
 * défaut dans le mauvais espace, sans erreur visible.
 */
export function createServiceAccount(db, { email, displayName, workspaceId, role = "admin" }) {
  const normalized = email.trim().toLowerCase();
  const actions = [];

  const workspace = db.prepare("SELECT id, name FROM Workspace WHERE id = ?").get(workspaceId);
  if (!workspace) throw new Error(`Workspace introuvable : ${workspaceId}`);

  const run = db.transaction(() => {
    let user = db.prepare("SELECT id, isService FROM User WHERE email = ?").get(normalized);

    if (!user) {
      const id = cuid();
      // Mot de passe local inutilisable — même pattern que le provisioning OIDC.
      const passwordHash = bcrypt.hashSync(randomBytes(32).toString("base64url"), 12);
      db.prepare(
        `INSERT INTO User (id, email, firstName, lastName, displayName, passwordHash, isService, createdAt)
         VALUES (?, ?, ?, ?, ?, ?, 1, ?)`
      ).run(id, normalized, displayName, "", displayName, passwordHash, prismaNow());
      user = { id, isService: 1 };
      actions.push("user_created");
    } else if (!user.isService) {
      // Compte préexistant : on ne le recrée pas, on le marque service.
      db.prepare("UPDATE User SET isService = 1 WHERE id = ?").run(user.id);
      actions.push("user_flagged_service");
    } else {
      actions.push("user_already_ok");
    }

    const membership = db
      .prepare("SELECT id, role FROM Membership WHERE userId = ? AND workspaceId = ?")
      .get(user.id, workspaceId);

    if (!membership) {
      db.prepare(
        `INSERT INTO Membership (id, userId, workspaceId, role, createdAt)
         VALUES (?, ?, ?, ?, ?)`
      ).run(cuid(), user.id, workspaceId, role, prismaNow());
      actions.push("membership_created");
    } else if (membership.role !== role) {
      db.prepare("UPDATE Membership SET role = ? WHERE id = ?").run(role, membership.id);
      actions.push("membership_role_updated");
    } else {
      actions.push("membership_already_ok");
    }

    return user.id;
  });

  const userId = run();
  return { userId, email: normalized, workspace: workspace.name, actions };
}

// ─── CLI ──────────────────────────────────────────────────────────────────────

function arg(name, fallback) {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
}

async function main() {
  const workspaceId = arg("workspace");
  const email = arg("email", DEFAULT_EMAIL);
  const displayName = arg("name", DEFAULT_NAME);

  const db = new Database(dbPathFromUrl(process.env.DATABASE_URL));
  db.pragma("foreign_keys = ON");

  // Aucun workspace par défaut : un identifiant codé en dur pointerait sur une
  // base de production depuis un dépôt public, et une faute de frappe créerait
  // le compte au mauvais endroit sans que rien ne le signale.
  if (!workspaceId) {
    console.error("--workspace=<id> est obligatoire. Espaces disponibles :");
    for (const w of db.prepare("SELECT id, name FROM Workspace ORDER BY createdAt").all()) {
      console.error(`   ${w.id}  ${w.name}`);
    }
    process.exitCode = 1;
    db.close();
    return;
  }

  const res = createServiceAccount(db, { email, displayName, workspaceId });
  console.log(`✅ ${res.email} → user ${res.userId} · espace « ${res.workspace} »`);
  console.log(`   ${res.actions.join(", ")}`);
  db.close();
}

// Exécuté seulement en CLI : le module est importé tel quel par les tests.
if (process.argv[1] && process.argv[1].endsWith("create-service-account.mjs")) {
  await main();
}
