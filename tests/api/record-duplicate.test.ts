import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";

vi.mock("@/lib/session", () => ({ getSession: vi.fn() }));

import { getSession } from "@/lib/session";
import { POST } from "@/app/api/records/[id]/duplicate/route";
import { prisma } from "@/lib/prisma";
import { seedUserWithWorkspace } from "../helpers/seed";

const mockGetSession = vi.mocked(getSession);

let userId: string;
let workspaceId: string;

function asMe() {
  mockGetSession.mockResolvedValue({ id: userId, email: "u", displayName: "U", currentWorkspaceId: workspaceId , isService: false});
}

const req = () => new Request("http://localhost/api/records/x/duplicate", { method: "POST" });
const params = (id: string) => ({ params: Promise.resolve({ id }) });

async function mkDatabase(ownerId = userId, wsId = workspaceId) {
  const page = await prisma.page.create({
    data: { title: "db", workspaceId: wsId, ownerId, visibility: "team", position: 1000 },
  });
  return prisma.database.create({ data: { pageId: page.id } });
}

beforeAll(async () => {
  const seeded = await seedUserWithWorkspace(`recdup-${Date.now()}@x.tld`);
  userId = seeded.user.id;
  workspaceId = seeded.workspace.id;
  asMe();
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe("POST /api/records/[id]/duplicate — copie atomique serveur", () => {
  it("AC1 : copie title+« (copie) », icon, properties, content, sectionsBody, sprintId ; nouveau id + position en fin", async () => {
    asMe();
    const db = await mkDatabase();
    const sprint = await prisma.sprint.create({ data: { databaseId: db.id } });
    const src = await prisma.record.create({
      data: {
        databaseId: db.id,
        title: "Ticket A",
        icon: "🎯",
        content: '[{"type":"paragraph","content":"x"}]',
        properties: '{"p1":"v1"}',
        sectionsBody: '[{"id":"s","label":"L","content":[]}]',
        sprintId: sprint.id,
        position: 1000,
      },
    });

    const res = await POST(req(), params(src.id));
    expect(res.status).toBe(201);
    const copy = await res.json();

    expect(copy.id).not.toBe(src.id);
    expect(copy.title).toBe("Ticket A (copie)");
    expect(copy.icon).toBe("🎯");
    expect(copy.content).toBe('[{"type":"paragraph","content":"x"}]');
    expect(copy.properties).toEqual({ p1: "v1" });
    expect(copy.sectionsBody).toBe('[{"id":"s","label":"L","content":[]}]');
    expect(copy.sprintId).toBe(sprint.id);
    expect(copy.position).toBeGreaterThan(src.position);

    // Original intact, 2 records au total.
    const all = await prisma.record.findMany({ where: { databaseId: db.id } });
    expect(all.length).toBe(2);
    const original = all.find((r) => r.id === src.id);
    expect(original?.title).toBe("Ticket A");
  });

  it("AC2 : titre vide → « (copie) »", async () => {
    asMe();
    const db = await mkDatabase();
    const src = await prisma.record.create({
      data: { databaseId: db.id, title: "", properties: "{}", position: 1000 },
    });
    const res = await POST(req(), params(src.id));
    expect(res.status).toBe(201);
    expect((await res.json()).title).toBe("(copie)");
  });

  it("AC3 : 401 sans session ; 404 sans accès ou record inexistant", async () => {
    asMe();
    const db = await mkDatabase();
    const src = await prisma.record.create({ data: { databaseId: db.id, title: "r", properties: "{}", position: 1000 } });

    mockGetSession.mockResolvedValueOnce(null);
    expect((await POST(req(), params(src.id))).status).toBe(401);

    // Record d'un autre workspace → 404 (pas de leak d'existence).
    const stranger = await seedUserWithWorkspace(`recdup-str-${Date.now()}@x.tld`);
    const otherDb = await mkDatabase(stranger.user.id, stranger.workspace.id);
    const otherRec = await prisma.record.create({ data: { databaseId: otherDb.id, title: "o", properties: "{}", position: 1000 } });
    asMe();
    expect((await POST(req(), params(otherRec.id))).status).toBe(404);

    // Record inexistant → 404.
    expect((await POST(req(), params("does-not-exist"))).status).toBe(404);
  });
});
