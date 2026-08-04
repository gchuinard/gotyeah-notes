import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";

vi.mock("@/lib/session", () => ({ getSession: vi.fn() }));

import { getSession } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { seedUserWithWorkspace } from "../helpers/seed";
import { purgeCutoff, TRASH_PURGE_DAYS } from "@/lib/trash";
import { GET as pagesGET } from "@/app/api/pages/route";
import { DELETE as pageDELETE } from "@/app/api/pages/[id]/route";
import { POST as pageRestore } from "@/app/api/pages/[id]/restore/route";
import { GET as trashGET } from "@/app/api/trash/route";
import { GET as recordsGET } from "@/app/api/databases/[id]/records/route";
import { DELETE as recordDELETE } from "@/app/api/records/[id]/route";
import { POST as recordRestore } from "@/app/api/records/[id]/restore/route";
import { GET as searchGET } from "@/app/api/search/route";

const mockGetSession = vi.mocked(getSession);
let userId: string;
let workspaceId: string;
let sectionId: string;

function asMe() {
  mockGetSession.mockResolvedValue({ id: userId, email: "u", displayName: "U", currentWorkspaceId: workspaceId , isService: false});
}
const P = (id: string) => ({ params: Promise.resolve({ id }) });
const req = (url: string, method = "GET") => new Request(`http://localhost${url}`, { method });

async function mkPage(title: string, parentId: string | null = null) {
  return prisma.page.create({
    data: { title, workspaceId, ownerId: userId, visibility: "team", position: 1000, parentId, sectionId: parentId ? null : sectionId },
  });
}
async function mkDatabaseOn(pageId: string) {
  return prisma.database.create({ data: { pageId } });
}

beforeAll(async () => {
  const seeded = await seedUserWithWorkspace(`trash-${Date.now()}@x.tld`);
  userId = seeded.user.id;
  workspaceId = seeded.workspace.id;
  const sec = await prisma.section.create({ data: { name: "S", type: "team", position: 0, workspaceId } });
  sectionId = sec.id;
  asMe();
});
afterAll(async () => { await prisma.$disconnect(); });

async function listPageIds() {
  const res = await pagesGET(req(`/api/pages?workspaceId=${workspaceId}`));
  return (await res.json()).map((p: { id: string }) => p.id);
}

describe("purgeCutoff (pur)", () => {
  it("recule de 30 jours", () => {
    const now = new Date("2026-07-10T00:00:00Z");
    expect(purgeCutoff(now).toISOString()).toBe("2026-06-10T00:00:00.000Z");
    expect(TRASH_PURGE_DAYS).toBe(30);
  });
});

describe("Corbeille — pages (soft delete, cascade, restore, permanent)", () => {
  it("soft delete cascade tout le sous-arbre et les cache de la liste ; restore les ramène", async () => {
    asMe();
    const root = await mkPage("root");
    const child = await mkPage("child", root.id);
    const grand = await mkPage("grand", child.id);

    let ids = await listPageIds();
    expect(ids).toEqual(expect.arrayContaining([root.id, child.id, grand.id]));

    const del = await pageDELETE(req(`/api/pages/${root.id}`, "DELETE"), P(root.id));
    expect(del.status).toBe(200);

    // Sous-arbre entier trashé (soft), plus rien en DB n'est perdu.
    for (const id of [root.id, child.id, grand.id]) {
      expect((await prisma.page.findUnique({ where: { id } }))?.trashedAt).not.toBeNull();
    }
    ids = await listPageIds();
    expect(ids).not.toContain(root.id);
    expect(ids).not.toContain(child.id);
    expect(ids).not.toContain(grand.id);

    // Restore → sous-arbre revient.
    const res = await pageRestore(req(`/api/pages/${root.id}/restore`, "POST"), P(root.id));
    expect(res.status).toBe(200);
    ids = await listPageIds();
    expect(ids).toEqual(expect.arrayContaining([root.id, child.id, grand.id]));
  });

  it("permanent=1 supprime définitivement (hard delete)", async () => {
    asMe();
    const p = await mkPage("perm");
    await pageDELETE(req(`/api/pages/${p.id}`, "DELETE"), P(p.id)); // soft d'abord
    const res = await pageDELETE(req(`/api/pages/${p.id}?permanent=1`, "DELETE"), P(p.id));
    expect(res.status).toBe(200);
    expect(await prisma.page.findUnique({ where: { id: p.id } })).toBeNull();
  });

  it("supprimer une page déjà en corbeille reste 404 en accès normal (getPageWithMembership)", async () => {
    asMe();
    const p = await mkPage("hidden");
    await pageDELETE(req(`/api/pages/${p.id}`, "DELETE"), P(p.id));
    // La route de suppression NORMALE (soft) ne retrouve plus une page trashée.
    const again = await pageDELETE(req(`/api/pages/${p.id}`, "DELETE"), P(p.id));
    expect(again.status).toBe(404);
  });
});

describe("Corbeille — records + accès database", () => {
  it("soft delete d'un record le cache de la liste ; restore le ramène", async () => {
    asMe();
    const page = await mkPage("dbpage");
    const db = await mkDatabaseOn(page.id);
    const rec = await prisma.record.create({ data: { databaseId: db.id, title: "r", position: 1000, properties: "{}" } });

    let res = await recordsGET(req(`/api/databases/${db.id}/records`), P(db.id));
    expect((await res.json()).map((r: { id: string }) => r.id)).toContain(rec.id);

    const del = await recordDELETE(req(`/api/records/${rec.id}`, "DELETE"), P(rec.id));
    expect(del.status).toBe(200);
    expect((await prisma.record.findUnique({ where: { id: rec.id } }))?.trashedAt).not.toBeNull();

    res = await recordsGET(req(`/api/databases/${db.id}/records`), P(db.id));
    expect((await res.json()).map((r: { id: string }) => r.id)).not.toContain(rec.id);

    const restore = await recordRestore(req(`/api/records/${rec.id}/restore`, "POST"), P(rec.id));
    expect(restore.status).toBe(200);
    res = await recordsGET(req(`/api/databases/${db.id}/records`), P(db.id));
    expect((await res.json()).map((r: { id: string }) => r.id)).toContain(rec.id);
  });

  it("records d'une database sous une page trashée → 404 (checkDatabaseAccess gate)", async () => {
    asMe();
    const page = await mkPage("dbpage2");
    const db = await mkDatabaseOn(page.id);
    await prisma.record.create({ data: { databaseId: db.id, title: "r", position: 1000, properties: "{}" } });
    await pageDELETE(req(`/api/pages/${page.id}`, "DELETE"), P(page.id)); // trash la page hôte

    const res = await recordsGET(req(`/api/databases/${db.id}/records`), P(db.id));
    expect(res.status).toBe(404);
  });

  it("restaurer un record sous une page trashée → 409 (restaurer la page d'abord)", async () => {
    asMe();
    const page = await mkPage("dbpage3");
    const db = await mkDatabaseOn(page.id);
    const rec = await prisma.record.create({ data: { databaseId: db.id, title: "r", position: 1000, properties: "{}", trashedAt: new Date() } });
    await pageDELETE(req(`/api/pages/${page.id}`, "DELETE"), P(page.id));
    const res = await recordRestore(req(`/api/records/${rec.id}/restore`, "POST"), P(rec.id));
    expect(res.status).toBe(409);
  });
});

describe("Corbeille — liste + purge 30j", () => {
  it("la liste ne montre QUE les racines de suppression + records isolés ; purge > 30 j", async () => {
    asMe();
    const root = await mkPage("troot");
    const child = await mkPage("tchild", root.id);
    await pageDELETE(req(`/api/pages/${root.id}`, "DELETE"), P(root.id));

    const page = await mkPage("recpage");
    const db = await mkDatabaseOn(page.id);
    const rec = await prisma.record.create({ data: { databaseId: db.id, title: "solo", position: 1000, properties: "{}" } });
    await recordDELETE(req(`/api/records/${rec.id}`, "DELETE"), P(rec.id));

    const res = await trashGET(req(`/api/trash?workspaceId=${workspaceId}`));
    const body = await res.json();
    const trashedPageIds = body.pages.map((p: { id: string }) => p.id);
    expect(trashedPageIds).toContain(root.id);
    expect(trashedPageIds).not.toContain(child.id); // descendant masqué (racine seule)
    expect(body.records.map((r: { id: string }) => r.id)).toContain(rec.id);

    // Purge : antidater à > 30 j puis re-lister → l'élément disparaît définitivement.
    const old = new Date(Date.now() - (TRASH_PURGE_DAYS + 1) * 86400000);
    await prisma.record.update({ where: { id: rec.id }, data: { trashedAt: old } });
    await prisma.page.updateMany({ where: { id: { in: [root.id, child.id] } }, data: { trashedAt: old } });
    await trashGET(req(`/api/trash?workspaceId=${workspaceId}`)); // déclenche la purge paresseuse
    expect(await prisma.record.findUnique({ where: { id: rec.id } })).toBeNull();
    expect(await prisma.page.findUnique({ where: { id: root.id } })).toBeNull();
    expect(await prisma.page.findUnique({ where: { id: child.id } })).toBeNull(); // cascade FK
  });
});

describe("Corbeille — recherche exclut les éléments trashés", () => {
  it("une page et un record trashés ne remontent plus dans /api/search", async () => {
    asMe();
    const uniq = `zzsearch${Date.now()}`;
    const page = await mkPage(`${uniq}-page`);
    const db = await mkDatabaseOn(await mkPage(`${uniq}-host`).then((p) => p.id));
    const rec = await prisma.record.create({ data: { databaseId: db.id, title: `${uniq}-rec`, position: 1000, properties: "{}" } });

    let res = await searchGET(req(`/api/search?q=${uniq}&workspaceId=${workspaceId}`));
    let titles = (await res.json()).map((r: { title: string }) => r.title);
    expect(titles).toContain(`${uniq}-page`);
    expect(titles).toContain(`${uniq}-rec`);

    await pageDELETE(req(`/api/pages/${page.id}`, "DELETE"), P(page.id));
    await recordDELETE(req(`/api/records/${rec.id}`, "DELETE"), P(rec.id));

    res = await searchGET(req(`/api/search?q=${uniq}&workspaceId=${workspaceId}`));
    titles = (await res.json()).map((r: { title: string }) => r.title);
    expect(titles).not.toContain(`${uniq}-page`);
    expect(titles).not.toContain(`${uniq}-rec`);
  });
});
