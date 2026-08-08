import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";

vi.mock("@/lib/session", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/session")>()),
  getSession: vi.fn(),
}));

import { getSession } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { PATCH as recordPATCH } from "@/app/api/records/[id]/route";
import { seedUserWithWorkspace, seedMember } from "../helpers/seed";

/**
 * Notification d'assignation — le « Main à » du Dev Loop.
 *
 * Les trois pièges que ce lot devait éviter : l'avalanche d'une action groupée,
 * la notification sur un retrait, et la fuite du titre d'une carte posée sur une
 * page privée.
 */

let workspaceId: string;
let ownerId: string;
let assigneeId: string;
let autreId: string;
let databaseId: string;
let userPropId: string;
let sectionId: string;

const as = (userId: string, displayName = "Acteur") =>
  vi.mocked(getSession).mockResolvedValue({
    id: userId,
    email: "x@x.tld",
    displayName,
    currentWorkspaceId: workspaceId,
    isService: false,
  });

const P = (id: string) => ({ params: Promise.resolve({ id }) });
const patch = (id: string, body: unknown) =>
  recordPATCH(
    new Request(`http://localhost/api/records/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
    P(id)
  );

/** Une carte neuve dans une page de la visibilité demandée. */
async function seedRecord(visibility: "team" | "private", titre: string) {
  const page = await prisma.page.create({
    data: { title: titre, workspaceId, ownerId, visibility, sectionId },
  });
  const db = await prisma.database.create({ data: { pageId: page.id } });
  const prop = await prisma.databaseProperty.create({
    data: { databaseId: db.id, name: "Main à", type: "user", position: 1000, config: '{"type":"user"}' },
  });
  const record = await prisma.record.create({ data: { databaseId: db.id, title: titre } });
  return { recordId: record.id, propId: prop.id };
}

const notifsFor = (userId: string) =>
  prisma.notification.findMany({
    where: { userId, type: "record_assigned" },
    orderBy: { createdAt: "desc" },
  });

beforeAll(async () => {
  const seeded = await seedUserWithWorkspace(`assign-owner-${Date.now()}@x.tld`);
  ownerId = seeded.user.id;
  workspaceId = seeded.workspace.id;
  assigneeId = (await seedMember(workspaceId, "editor")).user.id;
  autreId = (await seedMember(workspaceId, "editor")).user.id;

  const section = await prisma.section.create({
    data: { name: "S", type: "team", position: 0, workspaceId },
  });
  sectionId = section.id;

  const base = await seedRecord("team", "Carte de base");
  databaseId = (await prisma.record.findUnique({ where: { id: base.recordId } }))!.databaseId;
  userPropId = base.propId;
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe("Assignation sur une page d'équipe", () => {
  it("la personne AJOUTÉE est prévenue, avec le titre de la carte", async () => {
    const { recordId, propId } = await seedRecord("team", "Corriger la cloche");
    as(ownerId, "Ada");
    const res = await patch(recordId, { properties: { [propId]: [assigneeId] } });
    expect(res.status).toBe(200);

    const [n] = await notifsFor(assigneeId);
    expect(n).toBeTruthy();
    expect(n.actorId).toBe(ownerId);
    expect(n.payload).toContain("Corriger la cloche");
  });

  it("⚠️ RETIRER quelqu'un ne notifie personne", async () => {
    // Notifier sur « la propriété a changé » préviendrait tout le monde à chaque
    // retrait — et c'est ce qui rend une cloche inutile.
    const { recordId, propId } = await seedRecord("team", "Carte retrait");
    as(ownerId, "Ada");
    await patch(recordId, { properties: { [propId]: [assigneeId, autreId] } });
    const avant = (await notifsFor(autreId)).length;

    await patch(recordId, { properties: { [propId]: [assigneeId] } });
    expect((await notifsFor(autreId)).length).toBe(avant);
  });

  it("⚠️ on ne se notifie JAMAIS soi-même", async () => {
    const { recordId, propId } = await seedRecord("team", "Auto-assignation");
    as(ownerId, "Ada");
    const avant = (await notifsFor(ownerId)).length;
    await patch(recordId, { properties: { [propId]: [ownerId] } });
    expect((await notifsFor(ownerId)).length).toBe(avant);
  });

  it("réémettre la même valeur ne renotifie pas", async () => {
    // Le diff ne retient que les transitions RÉELLES : une valeur identique
    // n'est pas un changement.
    const { recordId, propId } = await seedRecord("team", "Carte idempotente");
    as(ownerId, "Ada");
    await patch(recordId, { properties: { [propId]: [assigneeId] } });
    const apres1 = (await notifsFor(assigneeId)).length;
    await patch(recordId, { properties: { [propId]: [assigneeId] } });
    expect((await notifsFor(assigneeId)).length).toBe(apres1);
  });
});

describe("⚠️ Avalanche — une action groupée ne fait pas 30 lignes", () => {
  it("cinq cartes assignées d'affilée fusionnent en UNE notification qui compte", async () => {
    // BulkActionBar envoie un PATCH INDÉPENDANT par carte : le serveur ne peut
    // pas savoir que c'était un seul clic. La fusion se fait donc en base.
    const cible = (await seedMember(workspaceId, "editor")).user.id;
    as(ownerId, "Ada");

    for (let i = 0; i < 5; i++) {
      const { recordId, propId } = await seedRecord("team", `Lot ${i}`);
      await patch(recordId, { properties: { [propId]: [cible] } });
    }

    const notifs = await notifsFor(cible);
    expect(notifs).toHaveLength(1);
    expect(JSON.parse(notifs[0].payload).count).toBe(5);
    // Le titre d'UNE carte ne veut plus rien dire quand il y en a cinq.
    expect(JSON.parse(notifs[0].payload).recordTitle).toBeUndefined();
  });

  it("un AUTRE acteur ne fusionne pas dans la ligne du premier", async () => {
    const cible = (await seedMember(workspaceId, "editor")).user.id;

    const a = await seedRecord("team", "Par Ada");
    as(ownerId, "Ada");
    await patch(a.recordId, { properties: { [a.propId]: [cible] } });

    const b = await seedRecord("team", "Par Bob");
    as(autreId, "Bob");
    await patch(b.recordId, { properties: { [b.propId]: [cible] } });

    expect(await notifsFor(cible)).toHaveLength(2);
  });
});

describe("⚠️ Confidentialité — une page privée ne fuit pas par la cloche", () => {
  it("assigner sur une page PRIVÉE d'autrui ne notifie pas", async () => {
    // Le message porte le titre de la carte. Prévenir quelqu'un d'une
    // assignation qu'il ne peut pas voir lui divulguerait ce titre et le
    // laisserait devant un 404.
    const { recordId, propId } = await seedRecord("private", "Secret du propriétaire");
    as(ownerId, "Ada");
    const avant = (await notifsFor(assigneeId)).length;

    const res = await patch(recordId, { properties: { [propId]: [assigneeId] } });
    expect(res.status).toBe(200); // l'assignation elle-même est valide

    expect((await notifsFor(assigneeId)).length).toBe(avant);
    // …et le titre n'a fuité nulle part.
    const toutes = await prisma.notification.findMany({ where: { userId: assigneeId } });
    expect(toutes.some((n) => n.payload.includes("Secret du propriétaire"))).toBe(false);
  });
});
