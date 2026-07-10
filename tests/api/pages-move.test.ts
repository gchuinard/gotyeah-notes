import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";

vi.mock("@/lib/session", () => ({ getSession: vi.fn() }));

import { getSession } from "@/lib/session";
import { PATCH } from "@/app/api/pages/[id]/route";
import { setPageSection } from "@/lib/pages";
import { prisma } from "@/lib/prisma";
import { seedUserWithWorkspace } from "../helpers/seed";

const mockGetSession = vi.mocked(getSession);

let userId: string;
let workspaceId: string;
let privateSectionId: string;
let teamSectionId: string;

async function makeTree(visibility: "team" | "private", sectionId: string) {
  const root = await prisma.page.create({
    data: { title: "root", workspaceId, ownerId: userId, sectionId, visibility, position: 1000 },
  });
  const child = await prisma.page.create({
    data: { title: "child", workspaceId, ownerId: userId, parentId: root.id, visibility, position: 1000 },
  });
  const grandchild = await prisma.page.create({
    data: { title: "gc", workspaceId, ownerId: userId, parentId: child.id, visibility, position: 1000 },
  });
  return { root, child, grandchild };
}

const vis = async (id: string) =>
  (await prisma.page.findUniqueOrThrow({ where: { id }, select: { visibility: true } })).visibility;

function patchParams(id: string) {
  return { params: Promise.resolve({ id }) };
}
function patchReq(body: unknown) {
  return new Request("http://localhost/api/pages/x", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeAll(async () => {
  const seeded = await seedUserWithWorkspace(`move-${Date.now()}@x.tld`);
  userId = seeded.user.id;
  workspaceId = seeded.workspace.id;
  const ps = await prisma.section.create({ data: { name: "Privé", type: "private", position: 0, workspaceId } });
  const ts = await prisma.section.create({ data: { name: "Équipe", type: "team", position: 1, workspaceId } });
  privateSectionId = ps.id;
  teamSectionId = ts.id;
  mockGetSession.mockResolvedValue({ id: userId, email: "u", displayName: "U", currentWorkspaceId: workspaceId });
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe("setPageSection", () => {
  it("racine private → section team : propage visibility=team à tout le sous-arbre", async () => {
    const t = await makeTree("private", privateSectionId);
    const res = await setPageSection(t.root.id, { sectionId: teamSectionId });
    expect(res.ok).toBe(true);
    expect(await vis(t.root.id)).toBe("team");
    expect(await vis(t.child.id)).toBe("team");
    expect(await vis(t.grandchild.id)).toBe("team");
  });

  it("anti-cycle : parent = descendant ou soi-même → code cycle, rien écrit", async () => {
    const t = await makeTree("team", teamSectionId);
    expect(await setPageSection(t.root.id, { parentId: t.grandchild.id })).toEqual({ ok: false, code: "cycle" });
    expect(await setPageSection(t.root.id, { parentId: t.root.id })).toEqual({ ok: false, code: "cycle" });
    // parentId inchangé
    expect((await prisma.page.findUniqueOrThrow({ where: { id: t.root.id } })).parentId).toBeNull();
  });

  it("sectionId sur une page enfant → code section_on_child", async () => {
    const t = await makeTree("team", teamSectionId);
    expect(await setPageSection(t.child.id, { sectionId: privateSectionId })).toEqual({
      ok: false,
      code: "section_on_child",
    });
  });

  it("section d'un autre workspace → code target_not_found", async () => {
    const t = await makeTree("team", teamSectionId);
    const other = await seedUserWithWorkspace(`other-${Date.now()}@x.tld`);
    const otherSection = await prisma.section.create({
      data: { name: "X", type: "team", position: 0, workspaceId: other.workspace.id },
    });
    expect(await setPageSection(t.root.id, { sectionId: otherSection.id })).toEqual({
      ok: false,
      code: "target_not_found",
    });
  });

  it("enfant déplacé en racine (parentId=null) sans sectionId : section privée par défaut, visibility private", async () => {
    const t = await makeTree("team", teamSectionId);
    const res = await setPageSection(t.child.id, { parentId: null });
    expect(res.ok).toBe(true);
    const moved = await prisma.page.findUniqueOrThrow({ where: { id: t.child.id } });
    expect(moved.parentId).toBeNull();
    expect(moved.sectionId).toBe(privateSectionId);
    expect(moved.visibility).toBe("private");
  });
});

describe("PATCH /api/pages/[id]", () => {
  it("400 sur type invalide (parentId numérique)", async () => {
    const t = await makeTree("team", teamSectionId);
    const res = await PATCH(patchReq({ parentId: 123 }), patchParams(t.root.id));
    expect(res.status).toBe(400);
  });

  it("200 déplacement cross-section avec visibility propagée en DB", async () => {
    const t = await makeTree("private", privateSectionId);
    const res = await PATCH(patchReq({ sectionId: teamSectionId }), patchParams(t.root.id));
    expect(res.status).toBe(200);
    expect(await vis(t.grandchild.id)).toBe("team");
  });

  it("400 section_on_child ; 400 cycle", async () => {
    const t = await makeTree("team", teamSectionId);
    expect((await PATCH(patchReq({ sectionId: privateSectionId }), patchParams(t.child.id))).status).toBe(400);
    expect((await PATCH(patchReq({ parentId: t.grandchild.id }), patchParams(t.root.id))).status).toBe(400);
  });

  it("régression : PATCH title seul ne touche ni section ni visibility", async () => {
    const t = await makeTree("private", privateSectionId);
    const res = await PATCH(patchReq({ title: "Renommée" }), patchParams(t.root.id));
    expect(res.status).toBe(200);
    const after = await prisma.page.findUniqueOrThrow({ where: { id: t.root.id } });
    expect(after.title).toBe("Renommée");
    expect(after.sectionId).toBe(privateSectionId);
    expect(after.visibility).toBe("private");
  });
});
