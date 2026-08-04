import { describe, it, expect, beforeAll, afterAll } from "vitest";
import Database from "better-sqlite3";
import { prisma } from "@/lib/prisma";
import { seedUserWithWorkspace } from "../helpers/seed";
import {
  remapViewConfig,
  backfillValue,
  runMigration,
} from "../../scripts/migrate-main-a-to-user.mjs";
import { dbPathFromUrl } from "../../scripts/create-service-account.mjs";

// Même stratégie que create-service-account : le script écrit en SQL direct sur
// la base des tests, Prisma relit — deux vues concordantes = SQL conforme.

let db: InstanceType<typeof Database>;
let workspaceId: string;
let gautierId: string;
let iaId: string;
const GAUTIER_EMAIL = `mig-g-${Date.now()}@x.tld`;
const IA_EMAIL = `mig-ia-${Date.now()}@gotyeah.local`;

const MAP = { "9e9fb151": "user-g", "632f2650": "user-ia" };

beforeAll(async () => {
  const seeded = await seedUserWithWorkspace(GAUTIER_EMAIL);
  workspaceId = seeded.workspace.id;
  gautierId = seeded.user.id;
  iaId = (
    await prisma.user.create({
      data: {
        email: IA_EMAIL,
        firstName: "IA",
        lastName: "",
        displayName: "IA",
        passwordHash: "x",
        isService: true,
      },
    })
  ).id;
  db = new Database(dbPathFromUrl(process.env.DATABASE_URL));
  db.pragma("foreign_keys = ON");
});

afterAll(async () => {
  db.close();
  await prisma.$disconnect();
});

// ─── Helpers purs ─────────────────────────────────────────────────────────────

describe("remapViewConfig", () => {
  const ctx = { oldPropertyId: "old", newPropertyId: "new", optionIdToUserId: MAP };

  it("filtre « is » (héritage HORS FilterOperator, ne filtrait rien) → contains + userId", () => {
    const { config, changed } = remapViewConfig(
      { filters: [{ propertyId: "old", operator: "is", value: "9e9fb151" }] },
      ctx
    );
    expect(changed).toBe(true);
    expect(config.filters).toEqual([
      { propertyId: "new", operator: "contains", value: "user-g" },
    ]);
  });

  it("eq → contains, neq/isNot → notContains, isEmpty inchangé", () => {
    const { config } = remapViewConfig(
      {
        filters: [
          { propertyId: "old", operator: "eq", value: "632f2650" },
          { propertyId: "old", operator: "neq", value: "9e9fb151" },
          { propertyId: "old", operator: "isEmpty" },
        ],
      },
      ctx
    );
    expect(config.filters.map((f: { operator: string }) => f.operator)).toEqual([
      "contains",
      "notContains",
      "isEmpty",
    ]);
    expect(config.filters[0].value).toBe("user-ia");
  });

  it("un filtre sur une AUTRE propriété n'est pas touché — même si sa valeur ressemble à une option", () => {
    const other = { propertyId: "statut", operator: "eq", value: "9e9fb151" };
    const { config, changed } = remapViewConfig({ filters: [other] }, ctx);
    expect(changed).toBe(false);
    expect(config.filters[0]).toEqual(other);
  });

  it("sorts, groupBy, visiblePropertyIds et les CLÉS de columnWidths suivent", () => {
    const { config, changed } = remapViewConfig(
      {
        sorts: [{ propertyId: "old", direction: "asc" }],
        groupByPropertyId: "old",
        visiblePropertyIds: ["a", "old", "b"],
        columnWidths: { old: 180, a: 250 },
      },
      ctx
    );
    expect(changed).toBe(true);
    expect(config.sorts[0].propertyId).toBe("new");
    expect(config.groupByPropertyId).toBe("new");
    expect(config.visiblePropertyIds).toEqual(["a", "new", "b"]);
    expect(config.columnWidths).toEqual({ new: 180, a: 250 });
  });

  it("un config étranger ressort à l'identique (changed=false)", () => {
    const config = { groupByPropertyId: "statut", filters: [{ propertyId: "x", operator: "eq" }] };
    const res = remapViewConfig(config, ctx);
    expect(res.changed).toBe(false);
    expect(res.config).toEqual(config);
  });
});

describe("backfillValue", () => {
  it("optionId → [userId] ; vide → rien ; inconnu → signalé", () => {
    expect(backfillValue("9e9fb151", MAP)).toEqual({ value: ["user-g"], unknown: false });
    expect(backfillValue(null, MAP)).toEqual({ value: null, unknown: false });
    expect(backfillValue("", MAP)).toEqual({ value: null, unknown: false });
    expect(backfillValue("option-morte", MAP)).toEqual({ value: null, unknown: true });
    expect(backfillValue(["tableau"], MAP)).toEqual({ value: null, unknown: true });
  });
});

// ─── Migration de bout en bout ────────────────────────────────────────────────

async function mkBoard(tag: string, opts: { gautierOpt?: string; iaOpt?: string } = {}) {
  const g = opts.gautierOpt ?? `g-${tag}`;
  const ia = opts.iaOpt ?? `ia-${tag}`;
  const page = await prisma.page.create({
    data: { title: `Board ${tag}`, workspaceId, ownerId: gautierId, visibility: "private", position: 1000 },
  });
  const database = await prisma.database.create({ data: { pageId: page.id } });
  const prop = await prisma.databaseProperty.create({
    data: {
      databaseId: database.id,
      name: "Main à",
      type: "select",
      position: 5000,
      config: JSON.stringify({
        type: "select",
        options: [
          { id: g, name: "Gautier", color: "blue" },
          { id: ia, name: "IA", color: "green" },
        ],
      }),
    },
  });
  return { database, prop, gOpt: g, iaOpt: ia };
}

describe("runMigration — bout en bout", () => {
  it("migre plusieurs databases, corbeille comprise, et recâble les vues", async () => {
    const a = await mkBoard("A");
    const b = await mkBoard("B");

    const mk = (databaseId: string, title: string, props: object, trashedAt: Date | null = null) =>
      prisma.record.create({
        data: { databaseId, title, position: 1000, properties: JSON.stringify(props), trashedAt },
      });
    await mk(a.database.id, "à Gautier", { [a.prop.id]: a.gOpt });
    await mk(a.database.id, "à IA", { [a.prop.id]: a.iaOpt });
    await mk(a.database.id, "sans valeur", {});
    await mk(a.database.id, "en corbeille", { [a.prop.id]: a.gOpt }, new Date());
    await mk(b.database.id, "b1", { [b.prop.id]: b.iaOpt });

    const tonGo = await prisma.view.create({
      data: {
        databaseId: a.database.id,
        name: "⏳ Ton go",
        type: "table",
        position: 3000,
        config: JSON.stringify({
          filters: [{ propertyId: a.prop.id, operator: "is", value: a.gOpt }],
          visiblePropertyIds: [a.prop.id],
          columnWidths: { [a.prop.id]: 160 },
        }),
      },
    });

    const { totals, reports } = runMigration(db, {
      name: "Main à",
      emailByOption: { Gautier: GAUTIER_EMAIL, IA: IA_EMAIL },
      execute: true,
    });

    expect(totals.databases).toBe(2);
    expect(totals.valuesBefore).toBe(4); // 3 sur A (corbeille comprise) + 1 sur B
    expect(totals.valuesAfter).toBe(4);

    // Relecture PRISMA — la colonne est bien du type user, au même rang.
    const propsA = await prisma.databaseProperty.findMany({ where: { databaseId: a.database.id } });
    expect(propsA).toHaveLength(1);
    expect(propsA[0].type).toBe("user");
    expect(propsA[0].name).toBe("Main à");
    expect(propsA[0].position).toBe(5000);

    const newId = reports!.find((r: { databaseId: string }) => r.databaseId === a.database.id)!
      .newPropertyId;
    const records = await prisma.record.findMany({ where: { databaseId: a.database.id } });
    const byTitle = Object.fromEntries(
      records.map((r) => [r.title, JSON.parse(r.properties)])
    );
    expect(byTitle["à Gautier"]).toEqual({ [newId]: [gautierId] });
    expect(byTitle["à IA"]).toEqual({ [newId]: [iaId] });
    expect(byTitle["sans valeur"]).toEqual({});
    expect(byTitle["en corbeille"]).toEqual({ [newId]: [gautierId] }); // la corbeille suit

    const view = await prisma.view.findUniqueOrThrow({ where: { id: tonGo.id } });
    expect(JSON.parse(view.config)).toEqual({
      filters: [{ propertyId: newId, operator: "contains", value: gautierId }],
      visiblePropertyIds: [newId],
      columnWidths: { [newId]: 160 },
    });
  });

  it("l'essai à blanc n'écrit RIEN", async () => {
    const c = await mkBoard("C");
    await prisma.record.create({
      data: {
        databaseId: c.database.id,
        title: "intacte",
        position: 1000,
        properties: JSON.stringify({ [c.prop.id]: c.gOpt }),
      },
    });

    const { totals, reports } = runMigration(db, {
      name: "Main à",
      databaseId: c.database.id,
      emailByOption: { Gautier: GAUTIER_EMAIL, IA: IA_EMAIL },
      execute: false,
    });
    expect(totals.databases).toBe(1);
    expect(totals.valuesBefore).toBe(1);
    expect(reports).toBeNull();

    const prop = await prisma.databaseProperty.findUniqueOrThrow({ where: { id: c.prop.id } });
    expect(prop.type).toBe("select"); // rien n'a bougé
  });

  it("une valeur inconnue annule TOUT — y compris les databases déjà traitées", async () => {
    const d1 = await mkBoard("D1");
    const d2 = await mkBoard("D2");
    await prisma.record.create({
      data: {
        databaseId: d1.database.id,
        title: "saine",
        position: 1000,
        properties: JSON.stringify({ [d1.prop.id]: d1.gOpt }),
      },
    });
    await prisma.record.create({
      data: {
        databaseId: d2.database.id,
        title: "corrompue",
        position: 1000,
        properties: JSON.stringify({ [d2.prop.id]: "option-fantome" }),
      },
    });

    expect(() =>
      runMigration(db, {
        name: "Main à",
        emailByOption: { Gautier: GAUTIER_EMAIL, IA: IA_EMAIL },
        execute: true,
      })
    ).toThrow(/sans correspondance/);

    // d1, pourtant saine et traitée AVANT d2, est intacte : transaction unique.
    const prop = await prisma.databaseProperty.findUniqueOrThrow({ where: { id: d1.prop.id } });
    expect(prop.type).toBe("select");
    const rec = await prisma.record.findFirstOrThrow({
      where: { databaseId: d1.database.id },
    });
    expect(JSON.parse(rec.properties)).toEqual({ [d1.prop.id]: d1.gOpt });

    // Nettoyage : d2 ne doit pas polluer les autres tests du fichier.
    await prisma.record.deleteMany({ where: { databaseId: d2.database.id } });
    await prisma.databaseProperty.delete({ where: { id: d2.prop.id } });
    await prisma.databaseProperty.delete({ where: { id: d1.prop.id } });
  });

  it("refuse un email sans compte plutôt que de migrer vers le vide", async () => {
    expect(() =>
      runMigration(db, {
        name: "Main à",
        emailByOption: { Gautier: "fantome@x.tld" },
        execute: true,
      })
    ).toThrow(/Aucun compte/);
  });
});
