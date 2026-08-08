import { describe, it, expect, beforeAll, afterAll } from "vitest";
import Database from "better-sqlite3";
import { prisma } from "@/lib/prisma";
import { seedUserWithWorkspace } from "../helpers/seed";
import { dbPathFromUrl } from "../../scripts/create-service-account.mjs";
import { planBackfill, applyBackfill } from "../../scripts/backfill-service-memberships.mjs";

/**
 * Rattrapage des espaces qui existaient AVANT le rattachement automatique.
 *
 * Comme create-service-account.test.ts : le script agit en SQL direct sur la
 * même base que les tests, on relit par Prisma — si les deux vues concordent, le
 * SQL est conforme au schéma.
 *
 * ⚠️ Toutes les planifications sont SCOPÉES (email + workspace). La base de test
 * est partagée par les autres fichiers, dont un qui crée aussi un compte de
 * service : un plan non scopé serait vert ou rouge selon l'ordre d'exécution.
 */

let db: InstanceType<typeof Database>;
let serviceId: string;
let orphanId: string;
let workspaceId: string;
let ownerId: string;

const EMAIL = `backfill-ia-${Date.now()}@gotyeah.local`;
const EMAIL_ORPHAN = `backfill-orphelin-${Date.now()}@gotyeah.local`;

beforeAll(async () => {
  const seeded = await seedUserWithWorkspace(`backfill-owner-${Date.now()}@x.tld`);
  workspaceId = seeded.workspace.id;
  ownerId = seeded.user.id;

  // Compte de service DÉJÀ rattaché ailleurs : c'est le cas réel (« IA » est
  // membre de Mon espace depuis le 05/08), et c'est ce qui protège son espace
  // par défaut — firstWorkspaceId prend la membership la plus ancienne.
  const ancre = await seedUserWithWorkspace(`backfill-ancre-${Date.now()}@x.tld`);
  const service = await prisma.user.create({
    data: {
      email: EMAIL,
      firstName: "IA",
      lastName: "",
      displayName: "IA backfill",
      passwordHash: "not-a-real-hash",
      isService: true,
      memberships: { create: { workspaceId: ancre.workspace.id, role: "admin" } },
    },
  });
  serviceId = service.id;

  const orphelin = await prisma.user.create({
    data: {
      email: EMAIL_ORPHAN,
      firstName: "IA",
      lastName: "",
      displayName: "IA orpheline",
      passwordHash: "not-a-real-hash",
      isService: true,
    },
  });
  orphanId = orphelin.id;

  // Deux pages privées et une d'équipe : le plan doit chiffrer ce qu'il OUVRE,
  // et ne compter que le privé.
  await prisma.page.createMany({
    data: [
      { title: "Privée 1", workspaceId, ownerId, visibility: "private", position: 0 },
      { title: "Privée 2", workspaceId, ownerId, visibility: "private", position: 1 },
      { title: "Équipe", workspaceId, ownerId, visibility: "team", position: 2 },
    ],
  });

  db = new Database(dbPathFromUrl(process.env.DATABASE_URL));
  db.pragma("foreign_keys = ON");
});

afterAll(async () => {
  db.close();
  await prisma.$disconnect();
});

describe("planBackfill — lecture seule", () => {
  it("planifie le rattachement manquant, en admin", () => {
    const rows = planBackfill(db, { email: EMAIL, workspaceId });
    expect(rows).toHaveLength(1);
    expect(rows[0].skip).toBeUndefined();
    expect(rows[0].role).toBe("admin");
    expect(rows[0].service.id).toBe(serviceId);
  });

  it("⚠️ chiffre ce que le rattachement OUVRE : les pages privées, et de qui", () => {
    // C'est le point du script. Rattacher un espace donne au compte de service
    // l'accès aux pages privées de TOUS ses membres — pas seulement celles de
    // qui lance la commande.
    const [row] = planBackfill(db, { email: EMAIL, workspaceId });
    expect(row.privatePages).toBe(2); // la page d'équipe n'est pas comptée
    expect(row.privateOwners).toEqual(["Test User"]);
  });

  it("signale le compte sans AUCUNE membership — son espace par défaut se joue ici", () => {
    // Le pont MCP fixe l'espace courant à la membership la plus ancienne : pour
    // un compte qui n'en a pas, c'est ce script qui décide, en silence.
    const [orphelin] = planBackfill(db, { email: EMAIL_ORPHAN, workspaceId });
    expect(orphelin.orphan).toBe(true);

    const [ancre] = planBackfill(db, { email: EMAIL, workspaceId });
    expect(ancre.orphan).toBe(false);
  });

  it("n'écrit rien", async () => {
    planBackfill(db, { email: EMAIL, workspaceId });
    const m = await prisma.membership.findUnique({
      where: { userId_workspaceId: { userId: serviceId, workspaceId } },
    });
    expect(m).toBeNull();
  });

  it("un email sans compte de service donne un plan vide", () => {
    expect(planBackfill(db, { email: "personne@nulle-part.tld", workspaceId })).toEqual([]);
  });
});

describe("applyBackfill — écriture, puis idempotence", () => {
  it("crée la membership, relue par Prisma", async () => {
    const rows = planBackfill(db, { email: EMAIL, workspaceId });
    expect(applyBackfill(db, rows)).toBe(1);

    const m = await prisma.membership.findUnique({
      where: { userId_workspaceId: { userId: serviceId, workspaceId } },
      select: { role: true },
    });
    expect(m).toEqual({ role: "admin" });
  });

  it("⚠️ relancé, il ne fait RIEN : le plan bascule en skip", () => {
    const rows = planBackfill(db, { email: EMAIL, workspaceId });
    expect(rows[0].skip).toBe("admin");
    expect(applyBackfill(db, rows)).toBe(0);
  });

  it("ne touche pas au rôle d'une membership existante", async () => {
    await prisma.membership.update({
      where: { userId_workspaceId: { userId: serviceId, workspaceId } },
      data: { role: "viewer" },
    });
    applyBackfill(db, planBackfill(db, { email: EMAIL, workspaceId }));

    const m = await prisma.membership.findUnique({
      where: { userId_workspaceId: { userId: serviceId, workspaceId } },
      select: { role: true },
    });
    // Une dégradation volontaire ne doit pas être écrasée par un rattrapage.
    expect(m!.role).toBe("viewer");
  });

  it("laisse intacte la membership d'ancrage, donc l'espace par défaut", async () => {
    const plus0ancien = await prisma.membership.findFirst({
      where: { userId: serviceId },
      orderBy: { createdAt: "asc" },
      select: { workspaceId: true },
    });
    expect(plus0ancien!.workspaceId).not.toBe(workspaceId);
    expect(orphanId).toBeTruthy();
  });
});
