import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";

vi.mock("@/lib/session", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/session")>()),
  getSession: vi.fn(),
}));

import { getSession } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { GET as listComments, POST as addComment } from "@/app/api/records/[id]/comments/route";
import { seedUserWithWorkspace, seedMember } from "../helpers/seed";

/**
 * Fil de discussion d'une carte — APPEND-ONLY.
 *
 * Ce fichier vérifie surtout ce que le lot NE fait PAS : ni modification, ni
 * suppression, ni notification. Ce sont des décisions, pas des oublis, et un
 * test qui les fige empêche de les « compléter » par mégarde.
 */

let ownerId: string;
let editeurId: string;
let lecteurId: string;
let etrangerId: string;
let workspaceId: string;
let recordId: string;
let recordPriveId: string;

const as = (userId: string, displayName = "Acteur") =>
  vi.mocked(getSession).mockResolvedValue({
    id: userId,
    email: "x@x.tld",
    displayName,
    currentWorkspaceId: workspaceId,
    isService: false,
  });

const P = (id: string) => ({ params: Promise.resolve({ id }) });
const poster = (rid: string, body: unknown) =>
  addComment(
    new Request("http://x", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
    P(rid)
  );
const lire = (rid: string) => listComments(new Request("http://x"), P(rid));

async function carteDans(visibility: "team" | "private", proprio: string) {
  const section = await prisma.section.create({
    data: { name: `S${Date.now()}${Math.random()}`, type: "team", position: 0, workspaceId },
  });
  const page = await prisma.page.create({
    data: { title: "Hôte", workspaceId, ownerId: proprio, visibility, sectionId: section.id },
  });
  const db = await prisma.database.create({ data: { pageId: page.id } });
  return (await prisma.record.create({ data: { databaseId: db.id, title: "Carte" } })).id;
}

beforeAll(async () => {
  const seeded = await seedUserWithWorkspace(`com-owner-${Date.now()}@x.tld`);
  ownerId = seeded.user.id;
  workspaceId = seeded.workspace.id;
  editeurId = (await seedMember(workspaceId, "editor")).user.id;
  lecteurId = (await seedMember(workspaceId, "viewer")).user.id;
  etrangerId = (await seedUserWithWorkspace(`com-etranger-${Date.now()}@x.tld`)).user.id;
  recordId = await carteDans("team", ownerId);
  recordPriveId = await carteDans("private", ownerId);
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe("POST — publier", () => {
  it("un éditeur publie : 201, avec auteur et date", async () => {
    as(editeurId, "Ada");
    const res = await poster(recordId, { body: "Attention au plafond nginx." });
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.body).toBe("Attention au plafond nginx.");
    expect(body.author).toBe("Ada");
    expect(body.createdAt).toBeTruthy();
  });

  it("⚠️ un LECTEUR est refusé (403) — lecture seule TOTALE, non assouplie", async () => {
    as(lecteurId);
    expect((await poster(recordId, { body: "moi aussi" })).status).toBe(403);
  });

  it("⚠️ un étranger ne sait pas que la carte existe (404)", async () => {
    as(etrangerId);
    expect((await poster(recordId, { body: "coucou" })).status).toBe(404);
  });

  it("un corps vide ou blanc est refusé (400)", async () => {
    as(editeurId);
    expect((await poster(recordId, { body: "" })).status).toBe(400);
    expect((await poster(recordId, { body: "   " })).status).toBe(400);
    expect((await poster(recordId, {})).status).toBe(400);
  });

  it("un corps trop long est refusé (400)", async () => {
    as(editeurId);
    expect((await poster(recordId, { body: "x".repeat(4001) })).status).toBe(400);
  });

  it("les retours à la ligne sont conservés", async () => {
    as(editeurId);
    const body = await (await poster(recordId, { body: "ligne 1\nligne 2" })).json();
    expect(body.body).toBe("ligne 1\nligne 2");
  });
});

describe("GET — lire", () => {
  it("le plus récent d'abord, et JAMAIS l'email", async () => {
    const rid = await carteDans("team", ownerId);
    as(editeurId, "Ada");
    await poster(rid, { body: "premier" });
    await poster(rid, { body: "second" });

    const rows = await (await lire(rid)).json();
    expect(rows.map((r: { body: string }) => r.body)).toEqual(["second", "premier"]);
    expect(JSON.stringify(rows)).not.toContain("@x.tld");
  });

  it("un LECTEUR lit le fil — il ne peut simplement pas y écrire", async () => {
    as(lecteurId);
    expect((await lire(recordId)).status).toBe(200);
  });

  it("⚠️ le fil est scopé à la CARTE : une page privée d'autrui rend 404", async () => {
    as(ownerId);
    await poster(recordPriveId, { body: "secret" });
    as(editeurId);
    expect((await lire(recordPriveId)).status).toBe(404);
  });

  it("un auteur supprimé devient anonyme, sans casser la lecture", async () => {
    const rid = await carteDans("team", ownerId);
    const ephemere = await seedMember(workspaceId, "editor");
    as(ephemere.user.id, "Passager");
    await poster(rid, { body: "j'étais là" });

    await prisma.user.delete({ where: { id: ephemere.user.id } });
    // On relit avec un compte VIVANT : la session de l'auteur supprimé n'a plus
    // de membership, elle recevrait un 404 sans rapport avec le sujet du test.
    as(editeurId, "Ada");
    const rows = await (await lire(rid)).json();
    expect(rows).toHaveLength(1);
    expect(rows[0].author).toBeNull(); // l'UI affiche « Quelqu'un »
    expect(rows[0].body).toBe("j'étais là");
  });
});

describe("⚠️ Ce que le lot ne fait PAS — décisions, pas oublis", () => {
  it("aucune route de modification ni de suppression n'est exportée", async () => {
    const mod = await import("@/app/api/records/[id]/comments/route");
    expect(Object.keys(mod).sort()).toEqual(["GET", "POST"]);
  });

  it("le modèle n'a ni updatedAt ni deletedAt — c'est un journal", async () => {
    const rid = await carteDans("team", ownerId);
    as(editeurId);
    const { id } = await (await poster(rid, { body: "gravé" })).json();
    const row = await prisma.recordComment.findUniqueOrThrow({ where: { id } });
    expect(Object.keys(row).sort()).toEqual(
      ["authorId", "body", "createdAt", "id", "recordId"].sort()
    );
  });

  it("publier n'écrit AUCUNE notification", async () => {
    // Le message porterait un extrait de texte : on ne l'expédie à personne.
    const rid = await carteDans("team", ownerId);
    const avant = await prisma.notification.count();
    as(editeurId);
    await poster(rid, { body: "silencieux" });
    expect(await prisma.notification.count()).toBe(avant);
  });

  it("supprimer la carte emporte son fil (Cascade)", async () => {
    const rid = await carteDans("team", ownerId);
    as(editeurId);
    await poster(rid, { body: "éphémère" });
    await prisma.record.delete({ where: { id: rid } });
    expect(await prisma.recordComment.count({ where: { recordId: rid } })).toBe(0);
  });
});
