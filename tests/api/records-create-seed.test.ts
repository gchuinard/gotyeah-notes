import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";

// Mock PARTIEL : seul getSession est simulé. Le module exporte aussi hashToken
// et createSession, dont dépendent des chemins réels (ex. les jetons de
// connexion par email) — un mock total les remplacerait par undefined.
vi.mock("@/lib/session", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/session")>()),
  getSession: vi.fn(),
}));

import { getSession } from "@/lib/session";
import { POST } from "@/app/api/databases/[id]/records/route";
import { prisma } from "@/lib/prisma";
import { seedUserWithWorkspace } from "../helpers/seed";

const mockGetSession = vi.mocked(getSession);

let userId: string;
let workspaceId: string;

function asMe() {
  mockGetSession.mockResolvedValue({
    id: userId,
    email: "u",
    displayName: "U",
    currentWorkspaceId: workspaceId,
    isService: false,
  });
}

const postReq = (dbId: string, body: unknown) =>
  new Request(`http://localhost/api/databases/${dbId}/records`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
const params = (id: string) => ({ params: Promise.resolve({ id }) });

async function mkDatabase(ownerId = userId, wsId = workspaceId) {
  const page = await prisma.page.create({
    data: { title: "db", workspaceId: wsId, ownerId, visibility: "team", position: 1000 },
  });
  return prisma.database.create({ data: { pageId: page.id } });
}

beforeAll(async () => {
  const seeded = await seedUserWithWorkspace(`recseed-${Date.now()}@x.tld`);
  userId = seeded.user.id;
  workspaceId = seeded.workspace.id;
  asMe();
});

afterAll(async () => {
  await prisma.$disconnect();
});

// Le pré-remplissage à la création depuis une vue filtrée envoie un `properties`
// enrichi { [P]: value } dans le POST. Ce test verrouille le contrat serveur :
// la valeur est bien persistée (parseRecord) et le garde-fou relation reste actif.
describe("POST /api/databases/[id]/records — properties de pré-remplissage (vue filtrée)", () => {
  it("persiste un properties enrichi { [P]: value } (parseRecord round-trip)", async () => {
    asMe();
    const db = await mkDatabase();
    const prop = await prisma.databaseProperty.create({
      data: {
        databaseId: db.id,
        name: "Projet",
        type: "select",
        position: 1000,
        config: JSON.stringify({
          type: "select",
          options: [{ id: "opt1", name: "Notes", color: "blue" }],
        }),
      },
    });

    const res = await POST(
      postReq(db.id, { title: "", properties: { [prop.id]: "opt1" } }),
      params(db.id)
    );
    expect(res.status).toBe(201);
    const created = await res.json();
    expect(created.properties).toEqual({ [prop.id]: "opt1" });

    // Persistance réelle en base (pas seulement l'écho de la réponse).
    const row = await prisma.record.findUnique({ where: { id: created.id } });
    expect(JSON.parse(row!.properties)).toEqual({ [prop.id]: "opt1" });
  });

  it("accepte plusieurs clés de pré-remplissage (select + text)", async () => {
    asMe();
    const db = await mkDatabase();
    const sel = await prisma.databaseProperty.create({
      data: {
        databaseId: db.id,
        name: "Projet",
        type: "select",
        position: 1000,
        config: JSON.stringify({
          type: "select",
          options: [{ id: "opt1", name: "Notes", color: "blue" }],
        }),
      },
    });
    const txt = await prisma.databaseProperty.create({
      data: {
        databaseId: db.id,
        name: "Note",
        type: "text",
        position: 2000,
        config: JSON.stringify({ type: "text" }),
      },
    });

    const res = await POST(
      postReq(db.id, { title: "", properties: { [sel.id]: "opt1", [txt.id]: "à relire" } }),
      params(db.id)
    );
    expect(res.status).toBe(201);
    const created = await res.json();
    expect(created.properties).toEqual({ [sel.id]: "opt1", [txt.id]: "à relire" });
  });

  it("body sans properties (aucun filtre dérivable) → record avec properties vide (non-régression)", async () => {
    asMe();
    const db = await mkDatabase();
    const res = await POST(postReq(db.id, { title: "" }), params(db.id));
    expect(res.status).toBe(201);
    const created = await res.json();
    expect(created.properties).toEqual({});
  });

  it("garde-fou relation : un id de pré-remplissage hors database cible est rejeté (400)", async () => {
    asMe();
    const target = await mkDatabase();
    const db = await mkDatabase();
    const rel = await prisma.databaseProperty.create({
      data: {
        databaseId: db.id,
        name: "Liens",
        type: "relation",
        position: 1000,
        config: JSON.stringify({ type: "relation", targetDatabaseId: target.id }),
      },
    });

    const res = await POST(
      postReq(db.id, { title: "", properties: { [rel.id]: ["rec-inexistant"] } }),
      params(db.id)
    );
    expect(res.status).toBe(400);
  });
});
