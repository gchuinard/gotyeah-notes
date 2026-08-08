import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";

vi.mock("@/lib/session", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/session")>()),
  getSession: vi.fn(),
}));

import { getSession } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { POST as createPage } from "@/app/api/pages/route";
import { POST as createProperty } from "@/app/api/databases/[id]/properties/route";
import { seedUserWithWorkspace, seedMember } from "../helpers/seed";

/**
 * Deux gardes qui manquaient, trouvées en cadrant les permissions par colonne.
 *
 * Aucune n'a de rapport avec ce lot : ce sont des trous préexistants, l'un de
 * confidentialité, l'autre d'escalade de privilège sur les règles d'accès.
 */

let ownerId: string;
let editeurId: string;
let adminId: string;
let workspaceId: string;
let sectionId: string;
let pagePriveeId: string;
let pageEquipeId: string;
let databaseId: string;

const as = (userId: string, isService = false) =>
  vi.mocked(getSession).mockResolvedValue({
    id: userId,
    email: "x@x.tld",
    displayName: "Acteur",
    currentWorkspaceId: workspaceId,
    isService,
  });

const postPage = (body: unknown) =>
  createPage(
    new Request("http://localhost/api/pages", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    })
  );

const postProperty = (body: unknown) =>
  createProperty(
    new Request(`http://localhost/api/databases/${databaseId}/properties`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ id: databaseId }) }
  );

beforeAll(async () => {
  const seeded = await seedUserWithWorkspace(`gardes-owner-${Date.now()}@x.tld`);
  ownerId = seeded.user.id;
  workspaceId = seeded.workspace.id;
  adminId = ownerId;
  editeurId = (await seedMember(workspaceId, "editor")).user.id;

  const section = await prisma.section.create({
    data: { name: "S", type: "team", position: 0, workspaceId },
  });
  sectionId = section.id;

  // La page PRIVÉE du propriétaire : l'éditeur ne doit pas pouvoir s'y greffer.
  pagePriveeId = (
    await prisma.page.create({
      data: { title: "Privée du proprio", workspaceId, ownerId, visibility: "private", sectionId },
    })
  ).id;

  pageEquipeId = (
    await prisma.page.create({
      data: { title: "Page d'équipe", workspaceId, ownerId, visibility: "team", sectionId },
    })
  ).id;

  const hote = await prisma.page.create({
    data: { title: "Board", workspaceId, ownerId, visibility: "team", sectionId },
  });
  databaseId = (await prisma.database.create({ data: { pageId: hote.id } })).id;
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe("⚠️ POST /api/pages — le parent doit être ACCESSIBLE, pas seulement du bon espace", () => {
  it("un éditeur ne crée PAS de sous-page sous la page privée d'un autre", async () => {
    // Le trou : createPage recopie la visibility du parent, donc l'enfant naissait
    // privé au nom du créateur, planté dans un arbre que le propriétaire ne verra
    // jamais — et remonté en racine orpheline chez le créateur.
    as(editeurId);
    const res = await postPage({ workspaceId, parentId: pagePriveeId, title: "Intrusion" });

    // 404, pas 403 : on ne révèle pas qu'une page privée existe.
    expect(res.status).toBe(404);
    expect(await prisma.page.count({ where: { parentId: pagePriveeId } })).toBe(0);
  });

  it("le PROPRIÉTAIRE, lui, crée bien sa sous-page", async () => {
    as(ownerId);
    const res = await postPage({ workspaceId, parentId: pagePriveeId, title: "La mienne" });
    expect(res.status).toBe(200);
    expect(await prisma.page.count({ where: { parentId: pagePriveeId } })).toBe(1);
  });

  it("une page d'ÉQUIPE reste ouverte à l'éditeur — on n'a rien cassé", async () => {
    as(editeurId);
    const res = await postPage({ workspaceId, parentId: pageEquipeId, title: "Normale" });
    expect(res.status).toBe(200);
  });

  it("le compte de SERVICE garde son exemption", async () => {
    // Sinon l'automatisation devient muette là où elle travaillait — c'est
    // exactement l'oubli du lot C, sur deux routes de app/api/databases.
    const service = await prisma.user.create({
      data: {
        email: `gardes-ia-${Date.now()}@gotyeah.local`,
        firstName: "IA",
        lastName: "",
        displayName: "IA gardes",
        passwordHash: "not-a-real-hash",
        isService: true,
        memberships: { create: { workspaceId, role: "admin" } },
      },
    });
    as(service.id, true);
    const res = await postPage({ workspaceId, parentId: pagePriveeId, title: "Par l'IA" });
    expect(res.status).toBe(200);
  });
});

describe("⚠️ POST /properties — les règles d'accès sont ADMIN, à la création aussi", () => {
  const avecRegles = (nom: string) => ({
    name: nom,
    type: "select",
    config: {
      type: "select",
      options: [{ id: "o1", name: "Fait", color: "green" }],
      rules: [{ toOptionId: "o1", roles: ["admin"] }],
    },
  });

  it("un éditeur ne crée PAS une colonne dont les règles sont déjà posées", async () => {
    // Le PATCH était gaté, la CRÉATION ne l'était pas : un éditeur posait ses
    // propres règles d'accès en fabriquant la colonne.
    as(editeurId);
    const res = await postProperty(avecRegles("Statut verrouillé"));

    expect(res.status).toBe(403);
    expect((await res.json()).error).toMatch(/administrateurs/i);
    expect(
      await prisma.databaseProperty.count({ where: { databaseId, name: "Statut verrouillé" } })
    ).toBe(0);
  });

  it("un admin le peut", async () => {
    as(adminId);
    const res = await postProperty(avecRegles("Statut admin"));
    expect(res.status).toBe(201);
  });

  it("un éditeur crée toujours une colonne ORDINAIRE — on n'a rien cassé", async () => {
    as(editeurId);
    const res = await postProperty({
      name: "Notes libres",
      type: "select",
      config: { type: "select", options: [{ id: "o2", name: "À voir", color: "blue" }] },
    });
    expect(res.status).toBe(201);
  });

  it("un tableau `rules` VIDE n'est pas un acte d'administration", async () => {
    // Sinon le moindre client qui sérialise `rules: []` prendrait un 403.
    as(editeurId);
    const res = await postProperty({
      name: "Sans règle",
      type: "select",
      config: { type: "select", options: [{ id: "o3", name: "X", color: "gray" }], rules: [] },
    });
    expect(res.status).toBe(201);
  });
});
