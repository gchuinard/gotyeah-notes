import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";

vi.mock("@/lib/session", () => ({ getSession: vi.fn() }));

import { getSession } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { nextPosition } from "@/lib/positions";
import { seedUserWithWorkspace } from "../helpers/seed";
import { POST as postRecord } from "@/app/api/databases/[id]/records/route";
import { POST as postProperty } from "@/app/api/databases/[id]/properties/route";
import { POST as postView } from "@/app/api/databases/[id]/views/route";
import { POST as postSprint } from "@/app/api/databases/[id]/sprints/route";
import { PATCH as patchSprint } from "@/app/api/sprints/[id]/route";

const mockGetSession = vi.mocked(getSession);
let userId: string;
let workspaceId: string;

function asMe() {
  mockGetSession.mockResolvedValue({ id: userId, email: "u", displayName: "U", currentWorkspaceId: workspaceId , isService: false});
}
const dbParams = (id: string) => ({ params: Promise.resolve({ id }) });
function postReq(dbId: string, body: unknown, path: string) {
  return new Request(`http://localhost/api/databases/${dbId}/${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}
function patchReq(sprintId: string, body: unknown) {
  return new Request(`http://localhost/api/sprints/${sprintId}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function mkDatabase() {
  const page = await prisma.page.create({
    data: { title: "db", workspaceId, ownerId: userId, visibility: "team", position: 1000 },
  });
  return prisma.database.create({ data: { pageId: page.id } });
}

beforeAll(async () => {
  const seeded = await seedUserWithWorkspace(`concurrency-${Date.now()}@x.tld`);
  userId = seeded.user.id;
  workspaceId = seeded.workspace.id;
  asMe();
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe("Positions : nextPosition + create atomiques dans les 4 POST", () => {
  it("AC1 : deux POST successifs → positions MAX+1000 croissantes (record)", async () => {
    asMe();
    const db = await mkDatabase();
    const r1 = await (await postRecord(postReq(db.id, { title: "a" }, "records"), dbParams(db.id))).json();
    const r2 = await (await postRecord(postReq(db.id, { title: "b" }, "records"), dbParams(db.id))).json();
    expect(r1.position).toBe(1000);
    expect(r2.position).toBe(2000);
  });

  it("AC1 : idem property / view / sprint", async () => {
    asMe();
    const db = await mkDatabase();
    const p1 = await (await postProperty(postReq(db.id, { name: "A", type: "text" }, "properties"), dbParams(db.id))).json();
    const p2 = await (await postProperty(postReq(db.id, { name: "B", type: "text" }, "properties"), dbParams(db.id))).json();
    // La database a déjà une éventuelle propriété titre ? Non : mkDatabase ne scaffolde rien.
    expect(p2.position).toBe(p1.position + 1000);

    const v1 = await (await postView(postReq(db.id, { type: "table" }, "views"), dbParams(db.id))).json();
    const v2 = await (await postView(postReq(db.id, { type: "kanban" }, "views"), dbParams(db.id))).json();
    expect(v2.position).toBe(v1.position + 1000);

    const s1 = await (await postSprint(postReq(db.id, { name: "S1" }, "sprints"), dbParams(db.id))).json();
    const s2 = await (await postSprint(postReq(db.id, { name: "S2" }, "sprints"), dbParams(db.id))).json();
    expect(s2.position).toBe(s1.position + 1000);
  });

  it("AC2 : nextPosition accepte un client de transaction et rend MAX+1000", async () => {
    asMe();
    const db = await mkDatabase();
    await prisma.record.create({ data: { databaseId: db.id, title: "x", position: 5000, properties: "{}" } });
    const pos = await prisma.$transaction((tx) => nextPosition("record", { databaseId: db.id }, tx));
    expect(pos).toBe(6000);
    // Base vide (autre database) → 1000.
    const db2 = await mkDatabase();
    const pos2 = await prisma.$transaction((tx) => nextPosition("view", { databaseId: db2.id }, tx));
    expect(pos2).toBe(1000);
  });
});

describe("Sprint : garde-fou « un seul actif » atomique (check+update en transaction)", () => {
  it("AC3 : démarrer un 2e sprint alors qu'un est actif → 409, sans le passer actif", async () => {
    asMe();
    const db = await mkDatabase();
    const a = await (await postSprint(postReq(db.id, { name: "A" }, "sprints"), dbParams(db.id))).json();
    const b = await (await postSprint(postReq(db.id, { name: "B" }, "sprints"), dbParams(db.id))).json();

    const startA = await patchSprint(patchReq(a.id, { state: "active" }), dbParams(a.id));
    expect(startA.status).toBe(200);

    const startB = await patchSprint(patchReq(b.id, { state: "active" }), dbParams(b.id));
    expect(startB.status).toBe(409);

    // B n'a PAS été passé actif (l'update est dans la même transaction que le check).
    const bAfter = await prisma.sprint.findUnique({ where: { id: b.id } });
    expect(bAfter?.state).toBe("future");
  });

  it("AC3 : redémarrer LE sprint déjà actif (même id) reste 200 (pas de faux conflit)", async () => {
    asMe();
    const db = await mkDatabase();
    const a = await (await postSprint(postReq(db.id, { name: "A" }, "sprints"), dbParams(db.id))).json();
    await patchSprint(patchReq(a.id, { state: "active" }), dbParams(a.id));
    const again = await patchSprint(patchReq(a.id, { state: "active" }), dbParams(a.id));
    expect(again.status).toBe(200);
  });
});

describe("Sprint : clôture + renvoi des incomplètes au backlog (transaction préservée)", () => {
  it("AC4 : completed → les records non terminés repassent au backlog, les terminés restent", async () => {
    asMe();
    const db = await mkDatabase();
    const statusProp = await prisma.databaseProperty.create({
      data: {
        databaseId: db.id, name: "Statut", type: "select", position: 1000,
        config: JSON.stringify({ type: "select", options: [{ id: "done", name: "Fait", color: "green" }, { id: "wip", name: "En cours", color: "blue" }] }),
      },
    });
    const sprint = await (await postSprint(postReq(db.id, { name: "S" }, "sprints"), dbParams(db.id))).json();
    const doneRec = await prisma.record.create({
      data: { databaseId: db.id, title: "done", position: 1000, sprintId: sprint.id, properties: JSON.stringify({ [statusProp.id]: "done" }) },
    });
    const wipRec = await prisma.record.create({
      data: { databaseId: db.id, title: "wip", position: 2000, sprintId: sprint.id, properties: JSON.stringify({ [statusProp.id]: "wip" }) },
    });

    const res = await patchSprint(
      patchReq(sprint.id, { state: "completed", moveIncompleteToBacklog: true, statusPropertyId: statusProp.id, doneStatusOptionId: "done" }),
      dbParams(sprint.id)
    );
    expect(res.status).toBe(200);
    expect((await prisma.sprint.findUnique({ where: { id: sprint.id } }))?.state).toBe("completed");
    expect((await prisma.record.findUnique({ where: { id: wipRec.id } }))?.sprintId).toBeNull();
    expect((await prisma.record.findUnique({ where: { id: doneRec.id } }))?.sprintId).toBe(sprint.id);
  });
});
