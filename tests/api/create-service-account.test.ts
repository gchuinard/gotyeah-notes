import { describe, it, expect, beforeAll, afterAll } from "vitest";
import Database from "better-sqlite3";
import { prisma } from "@/lib/prisma";
import { seedUserWithWorkspace } from "../helpers/seed";
import { createServiceAccount, cuid, dbPathFromUrl } from "../../scripts/create-service-account.mjs";

// Le script agit en SQL direct (le client Prisma généré n'est pas importable
// hors bundler) : on l'exécute donc sur LA MÊME base que les tests, ouverte par
// better-sqlite3, puis on relit par Prisma — si les deux vues concordent, le SQL
// est bien conforme au schéma.

let db: InstanceType<typeof Database>;
let workspaceId: string;

const EMAIL = `ia-test-${Date.now()}@gotyeah.local`;

beforeAll(async () => {
  const seeded = await seedUserWithWorkspace(`svc-script-${Date.now()}@x.tld`);
  workspaceId = seeded.workspace.id;
  db = new Database(dbPathFromUrl(process.env.DATABASE_URL));
  db.pragma("foreign_keys = ON");
});

afterAll(async () => {
  db.close();
  await prisma.$disconnect();
});

describe("dbPathFromUrl", () => {
  it("retire le préfixe file: des DATABASE_URL Prisma", () => {
    expect(dbPathFromUrl("file:/data/dev.db")).toBe("/data/dev.db");
    expect(dbPathFromUrl("/tmp/x.db")).toBe("/tmp/x.db");
  });

  it("refuse une URL absente plutôt que d'ouvrir une base au hasard", () => {
    expect(() => dbPathFromUrl(undefined)).toThrow(/DATABASE_URL/);
  });
});

describe("cuid", () => {
  it("produit la forme attendue et ne collisionne pas", () => {
    const ids = new Set(Array.from({ length: 500 }, () => cuid()));
    expect(ids.size).toBe(500);
    for (const id of ids) expect(id).toMatch(/^c[a-z0-9]{20,}$/);
  });
});

describe("createServiceAccount", () => {
  it("crée le compte, le marque service, et lui donne sa membership", async () => {
    const res = createServiceAccount(db, {
      email: EMAIL,
      displayName: "IA",
      workspaceId,
    });
    expect(res.actions).toEqual(["user_created", "membership_created"]);

    // Relecture par PRISMA : le SQL écrit est bien conforme au schéma.
    const user = await prisma.user.findUnique({ where: { email: EMAIL } });
    expect(user).not.toBeNull();
    expect(user!.isService).toBe(true);
    expect(user!.displayName).toBe("IA");
    expect(user!.passwordHash).toHaveLength(60); // bcrypt, inutilisable

    const membership = await prisma.membership.findUnique({
      where: { userId_workspaceId: { userId: user!.id, workspaceId } },
    });
    expect(membership?.role).toBe("admin");
  });

  it("rejoué, ne crée AUCUN doublon — c'est un script d'exploitation", async () => {
    const res = createServiceAccount(db, {
      email: EMAIL,
      displayName: "IA",
      workspaceId,
    });
    expect(res.actions).toEqual(["user_already_ok", "membership_already_ok"]);

    expect(await prisma.user.count({ where: { email: EMAIL } })).toBe(1);
    const user = await prisma.user.findUniqueOrThrow({ where: { email: EMAIL } });
    expect(await prisma.membership.count({ where: { userId: user.id } })).toBe(1);
  });

  it("normalise l'email : une casse différente ne crée pas un second compte", async () => {
    const res = createServiceAccount(db, {
      email: EMAIL.toUpperCase(),
      displayName: "IA",
      workspaceId,
    });
    expect(res.actions).toEqual(["user_already_ok", "membership_already_ok"]);
    expect(await prisma.user.count({ where: { email: EMAIL } })).toBe(1);
  });

  it("remet en état un compte existant NON marqué service", async () => {
    const email = `humain-${Date.now()}@x.tld`;
    await prisma.user.create({
      data: {
        email,
        firstName: "H",
        lastName: "U",
        displayName: "Humain",
        passwordHash: "x",
      },
    });

    const res = createServiceAccount(db, { email, displayName: "IA", workspaceId });
    expect(res.actions).toEqual(["user_flagged_service", "membership_created"]);
    expect((await prisma.user.findUniqueOrThrow({ where: { email } })).isService).toBe(true);
  });

  it("corrige un rôle de membership divergent sans toucher au compte", async () => {
    const email = `role-${Date.now()}@gotyeah.local`;
    createServiceAccount(db, { email, displayName: "IA", workspaceId, role: "viewer" });
    const res = createServiceAccount(db, { email, displayName: "IA", workspaceId, role: "admin" });
    expect(res.actions).toEqual(["user_already_ok", "membership_role_updated"]);
  });

  it("refuse un workspace inexistant plutôt que d'écrire une membership orpheline", () => {
    expect(() =>
      createServiceAccount(db, {
        email: `ko-${Date.now()}@gotyeah.local`,
        displayName: "IA",
        workspaceId: "workspace-fantome",
      })
    ).toThrow(/Workspace introuvable/);
  });

  it("rien n'est écrit quand le workspace est refusé (transaction)", async () => {
    const email = `atomic-${Date.now()}@gotyeah.local`;
    expect(() =>
      createServiceAccount(db, { email, displayName: "IA", workspaceId: "nope" })
    ).toThrow();
    expect(await prisma.user.count({ where: { email } })).toBe(0);
  });
});
