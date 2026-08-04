// One-shot : migre les propriétés « Main à » (select Gautier/IA) vers le type
// « utilisateur », sur TOUTES les databases qui en portent une.
//
//   node scripts/migrate-main-a-to-user.mjs \
//     --map="Gautier=gautierchuinard@gmail.com" --map="IA=ia@gotyeah.local" \
//     [--name="Main à"] [--database=<id>] [--execute]
//
// SANS --execute, c'est un ESSAI À BLANC : le plan complet est affiché, rien
// n'est écrit. Sur le Pi, passer par le service builder (cf. README §Migrations) :
//
//   docker compose run --rm --entrypoint sh migrate -c \
//     "node scripts/migrate-main-a-to-user.mjs --map=... --map=... --execute"
//
// Pourquoi ce script existe : l'API refuse tout changement de type d'une
// propriété (400). La seule voie est : créer une colonne `user` neuve, recopier
// les valeurs (optionId → [userId]), recâbler les View.config, supprimer
// l'ancienne colonne, renommer la neuve. L'étape de suppression est
// IRRÉVERSIBLE (DatabaseProperty n'a pas de corbeille) : tout se joue dans UNE
// transaction, avec vérification de comptes avant commit — un écart annule tout.
//
// Choix assumés, alignés sur le ticket :
// - les records en CORBEILLE sont backfillés aussi (une restauration ramènerait
//   sinon une valeur orpheline) ;
// - les opérateurs de filtre « is »/« eq » deviennent « contains » (et
//   « isNot »/« neq » → « notContains ») : applyFilters IGNORE eq/neq sur un
//   type multi-valeurs — et ignorait déjà « is », un héritage hors du type
//   FilterOperator, si bien que certaines vues « ⏳ Ton go » ne filtraient
//   plus rien. La migration les répare au passage.
// - les RecordRevision gardent l'ANCIEN id de propriété : rétention indéfinie,
//   pas de réécriture rétroactive — l'Historique affichera un libellé non
//   résolu sur ces vieilles lignes (accepté au cadrage).

import Database from "better-sqlite3";
import { cuid, dbPathFromUrl } from "./create-service-account.mjs";

// ─── Helpers PURS (importés par les tests) ────────────────────────────────────

/**
 * Recâble un View.config : tout ce qui pointait vers l'ancienne propriété
 * pointe vers la nouvelle, et les valeurs d'option deviennent des userIds.
 *
 * Champs porteurs d'un id de propriété (inventaire vérifié dans lib/db.ts) :
 * filters[].propertyId, sorts[].propertyId, groupByPropertyId,
 * visiblePropertyIds[], columnWidths (les CLÉS), calendarPropertyId,
 * pointsPropertyId, statusPropertyId, epicPropertyId. Porteurs d'un id
 * d'option : filters[].value, doneStatusOptionId.
 *
 * Un filtre resté sur l'ancien id n'échouerait pas : il serait SILENCIEUSEMENT
 * ignoré par applyFilters — la vue montrerait tout, sans un mot.
 */
export function remapViewConfig(config, { oldPropertyId, newPropertyId, optionIdToUserId }) {
  let changed = false;
  const out = { ...config };

  const mapValue = (v) => {
    if (typeof v === "string" && v in optionIdToUserId) return optionIdToUserId[v];
    if (Array.isArray(v)) return v.map((x) => (x in optionIdToUserId ? optionIdToUserId[x] : x));
    return v;
  };

  if (Array.isArray(out.filters)) {
    out.filters = out.filters.map((f) => {
      if (f.propertyId !== oldPropertyId) return f;
      changed = true;
      const next = { ...f, propertyId: newPropertyId };
      if (next.value !== undefined) next.value = mapValue(next.value);
      // eq/neq sont sans effet sur un type multi-valeurs ; « is »/« isNot »
      // n'ont JAMAIS été dans FilterOperator (héritage) et ne filtraient rien.
      if (next.operator === "eq" || next.operator === "is") next.operator = "contains";
      else if (next.operator === "neq" || next.operator === "isNot") next.operator = "notContains";
      return next;
    });
  }

  if (Array.isArray(out.sorts)) {
    out.sorts = out.sorts.map((s) => {
      if (s.propertyId !== oldPropertyId) return s;
      changed = true;
      return { ...s, propertyId: newPropertyId };
    });
  }

  for (const field of [
    "groupByPropertyId",
    "calendarPropertyId",
    "pointsPropertyId",
    "statusPropertyId",
    "epicPropertyId",
  ]) {
    if (out[field] === oldPropertyId) {
      out[field] = newPropertyId;
      changed = true;
    }
  }

  if (Array.isArray(out.visiblePropertyIds) && out.visiblePropertyIds.includes(oldPropertyId)) {
    out.visiblePropertyIds = out.visiblePropertyIds.map((id) =>
      id === oldPropertyId ? newPropertyId : id
    );
    changed = true;
  }

  // ⚠️ Ici l'id est une CLÉ d'objet, pas une valeur.
  if (out.columnWidths && oldPropertyId in out.columnWidths) {
    const { [oldPropertyId]: width, ...rest } = out.columnWidths;
    out.columnWidths = { ...rest, [newPropertyId]: width };
    changed = true;
  }

  if (typeof out.doneStatusOptionId === "string" && out.doneStatusOptionId in optionIdToUserId) {
    out.doneStatusOptionId = optionIdToUserId[out.doneStatusOptionId];
    changed = true;
  }

  return { config: out, changed };
}

/**
 * Nouvelle valeur de Record.properties : l'optionId (string) devient [userId].
 * `null` = rien à écrire (pas de valeur, ou valeur inconnue à signaler).
 */
export function backfillValue(raw, optionIdToUserId) {
  if (raw === undefined || raw === null || raw === "") return { value: null, unknown: false };
  if (typeof raw !== "string") return { value: null, unknown: true };
  const userId = optionIdToUserId[raw];
  return userId ? { value: [userId], unknown: false } : { value: null, unknown: true };
}

// ─── Migration d'une database (appelée DANS la transaction globale) ───────────

export function migrateDatabaseProperty(db, { property, optionIdToUserId, finalName }) {
  const newId = cuid();
  const report = {
    databaseId: property.databaseId,
    oldPropertyId: property.id,
    newPropertyId: newId,
    backfilled: 0,
    unknown: [],
    viewsRemapped: 0,
  };

  // (1) Colonne neuve, même position que l'ancienne : elle prend sa place
  // visuelle. Nom temporaire pour ne jamais avoir deux « Main à » visibles —
  // même si la transaction rend l'état intermédiaire invisible, un rollback
  // partiel raté ne doit pas laisser d'ambiguïté.
  db.prepare(
    `INSERT INTO DatabaseProperty (id, databaseId, name, type, position, config)
     VALUES (?, ?, ?, 'user', ?, '{"type":"user"}')`
  ).run(newId, property.databaseId, `${finalName} (migration)`, property.position);

  // (2) Backfill, corbeille INCLUSE (une restauration ramènerait sinon une
  // valeur orpheline). L'ancienne clé est retirée du même geste : c'est la
  // purge que ferait DELETE /api/properties/[id].
  const records = db
    .prepare("SELECT id, properties FROM Record WHERE databaseId = ?")
    .all(property.databaseId);
  const upd = db.prepare("UPDATE Record SET properties = ? WHERE id = ?");
  for (const r of records) {
    const props = JSON.parse(r.properties || "{}");
    if (!(property.id in props)) continue;
    const { value, unknown } = backfillValue(props[property.id], optionIdToUserId);
    if (unknown) {
      report.unknown.push({ recordId: r.id, raw: props[property.id] });
      continue; // on n'écrit RIEN : la transaction sera annulée plus haut.
    }
    delete props[property.id];
    if (value !== null) {
      props[newId] = value;
      report.backfilled++;
    }
    upd.run(JSON.stringify(props), r.id);
  }

  // (3) Recâblage des vues de la database.
  const views = db
    .prepare("SELECT id, config FROM View WHERE databaseId = ?")
    .all(property.databaseId);
  const updView = db.prepare("UPDATE View SET config = ? WHERE id = ?");
  for (const v of views) {
    const { config, changed } = remapViewConfig(JSON.parse(v.config || "{}"), {
      oldPropertyId: property.id,
      newPropertyId: newId,
      optionIdToUserId,
    });
    if (changed) {
      updView.run(JSON.stringify(config), v.id);
      report.viewsRemapped++;
    }
  }

  // (4) Suppression de l'ancienne colonne — le point de non-retour.
  db.prepare("DELETE FROM DatabaseProperty WHERE id = ?").run(property.id);

  // (5) La neuve prend le nom définitif.
  db.prepare("UPDATE DatabaseProperty SET name = ? WHERE id = ?").run(finalName, newId);

  return report;
}

// ─── Découverte + orchestration ───────────────────────────────────────────────

export function discover(db, { name, databaseId }) {
  const rows = db
    .prepare(
      `SELECT id, databaseId, name, type, position, config FROM DatabaseProperty
       WHERE name = ? ${databaseId ? "AND databaseId = ?" : ""} ORDER BY databaseId`
    )
    .all(...(databaseId ? [name, databaseId] : [name]));
  return rows.filter((p) => p.type === "select");
}

/**
 * @param {*} db
 * @param {{ name: string, databaseId?: string, emailByOption: Record<string,string>, execute: boolean }} opts
 */
export function runMigration(db, { name, databaseId, emailByOption, execute }) {
  // Résolution des emails → userIds, une fois pour toutes.
  const userByEmail = {};
  for (const [option, email] of Object.entries(emailByOption)) {
    const u = db
      .prepare("SELECT id, displayName FROM User WHERE email = ?")
      .get(email.trim().toLowerCase());
    if (!u) throw new Error(`Aucun compte pour « ${option} » : ${email}`);
    userByEmail[option] = u;
  }

  const candidates = discover(db, { name, databaseId });
  const plans = candidates.map((p) => {
    const options = (JSON.parse(p.config || "{}").options ?? []);
    const optionIdToUserId = {};
    const unmappedOptions = [];
    for (const o of options) {
      const target = userByEmail[o.name];
      if (target) optionIdToUserId[o.id] = target.id;
      else unmappedOptions.push(o.name);
    }
    const withValue = db
      .prepare(`SELECT COUNT(*) AS n FROM Record WHERE databaseId = ? AND json_extract(properties, ?) IS NOT NULL`)
      .get(p.databaseId, `$."${p.id}"`).n;
    return { property: p, optionIdToUserId, unmappedOptions, withValue };
  });

  // Une option sans correspondance N'EST bloquante que si des cartes l'utilisent
  // — mais la détecter carte par carte coûte le même prix que le backfill : la
  // transaction échouera proprement le cas échéant. On refuse d'emblée le cas
  // certain : option inconnue ET des valeurs présentes sur la database.
  if (!execute) return { plans, reports: null, totals: summarize(plans, null) };

  const reports = [];
  const tx = db.transaction(() => {
    for (const plan of plans) {
      const report = migrateDatabaseProperty(db, {
        property: plan.property,
        optionIdToUserId: plan.optionIdToUserId,
        finalName: name,
      });
      if (report.unknown.length > 0) {
        throw new Error(
          `Valeurs sans correspondance sur ${plan.property.databaseId} : ` +
            report.unknown.map((u) => `${u.recordId}=${JSON.stringify(u.raw)}`).join(", ") +
            " — AUCUNE database n'a été migrée."
        );
      }
      // Vérification d'exhaustivité AVANT commit : autant de valeurs après
      // qu'avant, sinon tout est annulé. C'est le filet du point de non-retour.
      const after = db
        .prepare(`SELECT COUNT(*) AS n FROM Record WHERE databaseId = ? AND json_extract(properties, ?) IS NOT NULL`)
        .get(plan.property.databaseId, `$."${report.newPropertyId}"`).n;
      if (after !== plan.withValue) {
        throw new Error(
          `Compte incohérent sur ${plan.property.databaseId} : ${plan.withValue} avant, ${after} après — tout est annulé.`
        );
      }
      report.verified = after;
      reports.push(report);
    }

    // Plus AUCUNE vue de l'instance ne doit référencer un ancien id.
    for (const plan of plans) {
      const leak = db
        .prepare("SELECT COUNT(*) AS n FROM View WHERE config LIKE ?")
        .get(`%${plan.property.id}%`).n;
      if (leak > 0) {
        throw new Error(
          `${leak} vue(s) référencent encore ${plan.property.id} — tout est annulé.`
        );
      }
    }
  });
  tx();

  return { plans, reports, totals: summarize(plans, reports) };
}

function summarize(plans, reports) {
  return {
    databases: plans.length,
    valuesBefore: plans.reduce((s, p) => s + p.withValue, 0),
    valuesAfter: reports ? reports.reduce((s, r) => s + r.verified, 0) : null,
    viewsRemapped: reports ? reports.reduce((s, r) => s + r.viewsRemapped, 0) : null,
  };
}

// ─── CLI ──────────────────────────────────────────────────────────────────────

function parseArgs() {
  const maps = {};
  let name = "Main à";
  let databaseId;
  let execute = false;
  for (const a of process.argv.slice(2)) {
    if (a.startsWith("--map=")) {
      const [option, email] = a.slice(6).split("=");
      if (!option || !email) throw new Error(`--map invalide : ${a}`);
      maps[option] = email;
    } else if (a.startsWith("--name=")) name = a.slice(7);
    else if (a.startsWith("--database=")) databaseId = a.slice(11);
    else if (a === "--execute") execute = true;
    else throw new Error(`Argument inconnu : ${a}`);
  }
  return { maps, name, databaseId, execute };
}

async function main() {
  const { maps, name, databaseId, execute } = parseArgs();
  if (Object.keys(maps).length === 0) {
    console.error('Au moins un --map="Option=email" est requis, ex. --map="Gautier=g@x.tld" --map="IA=ia@gotyeah.local"');
    process.exitCode = 1;
    return;
  }

  const db = new Database(dbPathFromUrl(process.env.DATABASE_URL));
  db.pragma("foreign_keys = ON");

  try {
    const { plans, reports, totals } = runMigration(db, {
      name,
      databaseId,
      emailByOption: maps,
      execute,
    });

    for (const p of plans) {
      const flag = p.unmappedOptions.length > 0 ? `  ⚠️ options sans mapping : ${p.unmappedOptions.join(", ")}` : "";
      console.log(`— ${p.property.databaseId} : ${p.withValue} valeur(s), prop ${p.property.id}${flag}`);
    }
    console.log(
      `\n${totals.databases} database(s), ${totals.valuesBefore} valeur(s) à migrer.` +
        (execute
          ? ` Migré : ${totals.valuesAfter} valeur(s), ${totals.viewsRemapped} vue(s) recâblée(s). ✅`
          : " [essai à blanc — rien écrit ; ajouter --execute]")
    );
  } finally {
    db.close();
  }
}

if (process.argv[1] && process.argv[1].endsWith("migrate-main-a-to-user.mjs")) {
  await main();
}
