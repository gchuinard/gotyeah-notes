import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";

vi.mock("@/lib/session", () => ({ getSession: vi.fn() }));

import { getSession } from "@/lib/session";
import { DELETE } from "@/app/api/sections/[id]/route";
import { deleteSectionReassigningRoots } from "@/lib/pages";
import { prisma } from "@/lib/prisma";
import { seedUserWithWorkspace } from "../helpers/seed";

const mockGetSession = vi.mocked(getSession);

let userId: string;
let workspaceId: string;

async function mkSection(type: "team" | "private", position = 0) {
  return prisma.section.create({ data: { name: `${type}-${position}`, type, position, workspaceId } });
}
async function mkRoot(sectionId: string, visibility: "team" | "private") {
  return prisma.page.create({
    data: { title: "root", workspaceId, ownerId: userId, sectionId, visibility, position: 1000 },
  });
}
async function mkChild(parentId: string, visibility: "team" | "private") {
  return prisma.page.create({
    data: { title: "child", workspaceId, ownerId: userId, parentId, visibility, position: 1000 },
  });
}

function delParams(id: string) {
  return { params: Promise.resolve({ id }) };
}
const delReq = () => new Request("http://localhost/api/sections/x", { method: "DELETE" });

function asMe() {
  mockGetSession.mockResolvedValue({ id: userId, email: "u", displayName: "U", currentWorkspaceId: workspaceId , isService: false});
}

beforeAll(async () => {
  const seeded = await seedUserWithWorkspace(`secdel-${Date.now()}@x.tld`);
  userId = seeded.user.id;
  workspaceId = seeded.workspace.id;
  asMe();
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe("DELETE /api/sections/[id] — réaffectation des racines", () => {
  it("AC1/AC2 : 2 sections team, racines+enfants dans T1 → 200, T1 supprimée, racines vers repli, enfants et visibility inchangés", async () => {
    asMe();
    const t1 = await mkSection("team", 10);
    const t2 = await mkSection("team", 11);
    const rootA = await mkRoot(t1.id, "team");
    const childA = await mkChild(rootA.id, "team");
    const rootB = await mkRoot(t1.id, "team");

    const res = await DELETE(delReq(), delParams(t1.id));
    expect(res.status).toBe(200);

    // T1 supprimée.
    expect(await prisma.section.findUnique({ where: { id: t1.id } })).toBeNull();

    // Racines réaffectées au repli same-type, visibility inchangée.
    const a = await prisma.page.findUniqueOrThrow({ where: { id: rootA.id } });
    const b = await prisma.page.findUniqueOrThrow({ where: { id: rootB.id } });
    expect(a.sectionId).toBe(t2.id);
    expect(b.sectionId).toBe(t2.id);
    expect(a.visibility).toBe("team");

    // Enfant intact (hérite via la racine : sectionId null, parent inchangé), aucun orphelin.
    const c = await prisma.page.findUniqueOrThrow({ where: { id: childA.id } });
    expect(c.sectionId).toBeNull();
    expect(c.parentId).toBe(rootA.id);
    expect(c.visibility).toBe("team");
  });

  it("AC3 : section SEULE de son type → 409, section et pages intactes", async () => {
    // Workspace isolé : une seule section team, aucun repli possible.
    const solo = await seedUserWithWorkspace(`solo-${Date.now()}@x.tld`);
    mockGetSession.mockResolvedValue({
      id: solo.user.id,
      email: "solo",
      displayName: "Solo",
      currentWorkspaceId: solo.workspace.id,
      isService: false,
    });
    const lone = await prisma.section.create({
      data: { name: "team", type: "team", position: 0, workspaceId: solo.workspace.id },
    });
    const root = await prisma.page.create({
      data: { title: "root", workspaceId: solo.workspace.id, ownerId: solo.user.id, sectionId: lone.id, visibility: "team", position: 1000 },
    });

    const res = await DELETE(delReq(), delParams(lone.id));
    expect(res.status).toBe(409);
    expect((await res.json()).error).toMatch(/dernière section/i);

    // Rien modifié.
    expect(await prisma.section.findUnique({ where: { id: lone.id } })).not.toBeNull();
    expect((await prisma.page.findUniqueOrThrow({ where: { id: root.id } })).sectionId).toBe(lone.id);
  });

  it("AC4 : non-membre → 404 anti-leak, aucune donnée modifiée", async () => {
    const t1 = await mkSection("team", 30);
    const t2 = await mkSection("team", 31);
    const root = await mkRoot(t1.id, "team");

    const stranger = await seedUserWithWorkspace(`stranger-${Date.now()}@x.tld`);
    mockGetSession.mockResolvedValue({
      id: stranger.user.id,
      email: "s",
      displayName: "S",
      currentWorkspaceId: stranger.workspace.id,
      isService: false,
    });

    const res = await DELETE(delReq(), delParams(t1.id));
    expect(res.status).toBe(404);
    expect(await prisma.section.findUnique({ where: { id: t1.id } })).not.toBeNull();
    expect((await prisma.page.findUniqueOrThrow({ where: { id: root.id } })).sectionId).toBe(t1.id);
    void t2;
  });

  it("AC4 : id inexistant → 404", async () => {
    asMe();
    const res = await DELETE(delReq(), delParams("does-not-exist"));
    expect(res.status).toBe(404);
  });

  it("AC5 : erreur DB simulée en cours de transaction → rollback complet (section + racine intactes)", async () => {
    asMe();
    const t1 = await mkSection("team", 40);
    await mkSection("team", 41); // repli disponible
    const root = await mkRoot(t1.id, "team");
    const child = await mkChild(root.id, "team");

    // Enveloppe la vraie transaction et jette APRÈS les écritures → Prisma rollback.
    const realTx = prisma.$transaction.bind(prisma);
    const spy = vi
      .spyOn(prisma, "$transaction")
      .mockImplementation(((cb: unknown) =>
        realTx(async (tx: unknown) => {
          await (cb as (t: unknown) => Promise<unknown>)(tx);
          throw new Error("simulated DB error");
        })) as unknown as typeof prisma.$transaction);

    await expect(deleteSectionReassigningRoots(t1.id)).rejects.toThrow("simulated DB error");
    spy.mockRestore();

    // Rollback : rien n'a été committé.
    expect(await prisma.section.findUnique({ where: { id: t1.id } })).not.toBeNull();
    expect((await prisma.page.findUniqueOrThrow({ where: { id: root.id } })).sectionId).toBe(t1.id);
    expect(await prisma.page.findUnique({ where: { id: child.id } })).not.toBeNull();
  });

  it("AC6 : section vide (0 racine) avec un repli same-type → 200, suppression sans effet de bord", async () => {
    asMe();
    const t1 = await mkSection("team", 50);
    const t2 = await mkSection("team", 51);
    const untouched = await mkRoot(t2.id, "team");

    const res = await DELETE(delReq(), delParams(t1.id));
    expect(res.status).toBe(200);
    expect(await prisma.section.findUnique({ where: { id: t1.id } })).toBeNull();
    // La page d'une autre section n'a pas bougé.
    expect((await prisma.page.findUniqueOrThrow({ where: { id: untouched.id } })).sectionId).toBe(t2.id);
  });
});
