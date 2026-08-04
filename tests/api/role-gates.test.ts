import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

vi.mock("@/lib/session", () => ({ getSession: vi.fn() }));

import { getSession } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { seedUserWithWorkspace, seedMember } from "../helpers/seed";

import { POST as pagesPOST } from "@/app/api/pages/route";
import { PATCH as pagePATCH, DELETE as pageDELETE } from "@/app/api/pages/[id]/route";
import { POST as pageRestorePOST } from "@/app/api/pages/[id]/restore/route";
import { POST as visitPOST } from "@/app/api/pages/[id]/visit/route";
import { POST as sectionsPOST } from "@/app/api/sections/route";
import { PATCH as sectionPATCH, DELETE as sectionDELETE } from "@/app/api/sections/[id]/route";
import { DELETE as workspaceDELETE } from "@/app/api/workspaces/[id]/route";
import { POST as membersPOST } from "@/app/api/workspaces/[id]/members/route";
import { PATCH as memberPATCH, DELETE as memberDELETE } from "@/app/api/workspaces/[id]/members/[userId]/route";
import { POST as databasesPOST } from "@/app/api/databases/route";
import { PATCH as databasePATCH, DELETE as databaseDELETE } from "@/app/api/databases/[id]/route";
import { POST as propertiesPOST } from "@/app/api/databases/[id]/properties/route";
import { POST as recordsPOST } from "@/app/api/databases/[id]/records/route";
import { POST as sprintsPOST } from "@/app/api/databases/[id]/sprints/route";
import { POST as viewsPOST } from "@/app/api/databases/[id]/views/route";
import { PATCH as propertyPATCH, DELETE as propertyDELETE } from "@/app/api/properties/[id]/route";
import { PATCH as recordPATCH, DELETE as recordDELETE } from "@/app/api/records/[id]/route";
import { POST as duplicatePOST } from "@/app/api/records/[id]/duplicate/route";
import { POST as recordRestorePOST } from "@/app/api/records/[id]/restore/route";
import { PATCH as viewPATCH, DELETE as viewDELETE } from "@/app/api/views/[id]/route";
import { PATCH as sprintPATCH, DELETE as sprintDELETE } from "@/app/api/sprints/[id]/route";
import { POST as templatesPOST } from "@/app/api/templates/route";
import { PATCH as templatePATCH, DELETE as templateDELETE } from "@/app/api/templates/[id]/route";
import { POST as uploadPOST } from "@/app/api/upload/route";
import { PATCH as configPATCH } from "@/app/api/config/route";

const mockGetSession = vi.mocked(getSession);

let workspaceId: string;
let adminId: string;
let editorId: string;
let viewerId: string;

let sectionId: string;
let pageId: string;
let dbPageId: string;
let databaseId: string;
let propertyId: string;
let recordId: string;
let viewId: string;
let sprintId: string;
let templateId: string;

// Espace étranger : le rôle se résout sur le workspace de la RESSOURCE,
// jamais sur currentWorkspaceId — un membre de W1 visant W2 doit voir 404.
let otherRecordId: string;

const as = (userId: string) =>
  mockGetSession.mockResolvedValue({
    id: userId,
    email: "x@x.tld",
    displayName: "X",
    currentWorkspaceId: workspaceId,
    isService: false,
  });

// Générique : le type des params est INFÉRÉ à l'appel ({ id } ou { id, userId }),
// sinon Record<string, string> n'est pas assignable aux params des handlers (tsc).
const P = <T extends Record<string, string>>(params: T) => ({ params: Promise.resolve(params) });
const req = (url: string, method = "GET") => new Request(`http://localhost${url}`, { method });
const jsonReq = (url: string, method: string, body: unknown) =>
  new Request(`http://localhost${url}`, {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

beforeAll(async () => {
  const seeded = await seedUserWithWorkspace(`roles-admin-${Date.now()}@x.tld`);
  adminId = seeded.user.id;
  workspaceId = seeded.workspace.id;
  editorId = (await seedMember(workspaceId, "editor")).user.id;
  viewerId = (await seedMember(workspaceId, "viewer")).user.id;

  // Fixtures sur une page TEAM : les check*Access passent pour les 3 rôles,
  // on teste donc bien le gate de rôle, pas le 404 d'accès.
  const section = await prisma.section.create({
    data: { name: "S", type: "team", position: 0, workspaceId },
  });
  sectionId = section.id;
  const page = await prisma.page.create({
    data: { title: "P", workspaceId, ownerId: adminId, visibility: "team", sectionId },
  });
  pageId = page.id;
  const dbPage = await prisma.page.create({
    data: { title: "DB", workspaceId, ownerId: adminId, visibility: "team", sectionId },
  });
  dbPageId = dbPage.id;
  const database = await prisma.database.create({ data: { pageId: dbPage.id } });
  databaseId = database.id;
  propertyId = (
    await prisma.databaseProperty.create({
      data: { databaseId, name: "Texte", type: "text", position: 2000, config: '{"type":"text"}' },
    })
  ).id;
  recordId = (await prisma.record.create({ data: { databaseId, title: "R" } })).id;
  viewId = (await prisma.view.create({ data: { databaseId, name: "V", type: "table" } })).id;
  sprintId = (await prisma.sprint.create({ data: { databaseId, name: "S1" } })).id;
  templateId = (await prisma.template.create({ data: { workspaceId, name: "T" } })).id;

  const other = await seedUserWithWorkspace(`roles-other-${Date.now()}@x.tld`);
  const otherPage = await prisma.page.create({
    data: { title: "O", workspaceId: other.workspace.id, ownerId: other.user.id, visibility: "team" },
  });
  const otherDb = await prisma.database.create({ data: { pageId: otherPage.id } });
  otherRecordId = (await prisma.record.create({ data: { databaseId: otherDb.id, title: "O" } })).id;
});
afterAll(async () => {
  await prisma.$disconnect();
});

// ─── Table des gates : un cas par handler mutant, 403 sous le rôle requis ─────
// Un refus 403 ne mute RIEN (gate avant toute écriture) → la fixture partagée
// survit à toute la table sans re-seed.

type GateCase = { name: string; minRole: "editor" | "admin"; call: () => Promise<Response> };

const cases: GateCase[] = [
  { name: "POST /api/pages", minRole: "editor", call: () => pagesPOST(jsonReq("/api/pages", "POST", { workspaceId, title: "x" })) },
  { name: "PATCH /api/pages/[id]", minRole: "editor", call: () => pagePATCH(jsonReq(`/api/pages/${pageId}`, "PATCH", { title: "x" }), P({ id: pageId })) },
  { name: "DELETE /api/pages/[id] (corbeille)", minRole: "editor", call: () => pageDELETE(req(`/api/pages/${pageId}`, "DELETE"), P({ id: pageId })) },
  { name: "DELETE /api/pages/[id]?permanent=1", minRole: "admin", call: () => pageDELETE(req(`/api/pages/${pageId}?permanent=1`, "DELETE"), P({ id: pageId })) },
  { name: "POST /api/pages/[id]/restore", minRole: "editor", call: () => pageRestorePOST(req(`/api/pages/${pageId}/restore`, "POST"), P({ id: pageId })) },
  { name: "POST /api/sections", minRole: "editor", call: () => sectionsPOST(jsonReq("/api/sections", "POST", { workspaceId, name: "x" })) },
  { name: "PATCH /api/sections/[id]", minRole: "editor", call: () => sectionPATCH(jsonReq(`/api/sections/${sectionId}`, "PATCH", { name: "S" }), P({ id: sectionId })) },
  { name: "DELETE /api/sections/[id]", minRole: "admin", call: () => sectionDELETE(req(`/api/sections/${sectionId}`, "DELETE"), P({ id: sectionId })) },
  { name: "DELETE /api/workspaces/[id]", minRole: "admin", call: () => workspaceDELETE(req(`/api/workspaces/${workspaceId}`, "DELETE"), P({ id: workspaceId })) },
  { name: "POST /api/workspaces/[id]/members", minRole: "admin", call: () => membersPOST(jsonReq(`/api/workspaces/${workspaceId}/members`, "POST", { email: "nobody@x.tld" }), P({ id: workspaceId })) },
  { name: "PATCH /api/workspaces/[id]/members/[userId]", minRole: "admin", call: () => memberPATCH(jsonReq(`/api/workspaces/${workspaceId}/members/${editorId}`, "PATCH", { role: "viewer" }), P({ id: workspaceId, userId: editorId })) },
  { name: "DELETE /api/workspaces/[id]/members/[userId] (autrui)", minRole: "admin", call: () => memberDELETE(req(`/api/workspaces/${workspaceId}/members/${adminId}`, "DELETE"), P({ id: workspaceId, userId: adminId })) },
  { name: "POST /api/databases", minRole: "editor", call: () => databasesPOST(jsonReq("/api/databases", "POST", { pageId })) },
  { name: "PATCH /api/databases/[id]", minRole: "editor", call: () => databasePATCH(jsonReq(`/api/databases/${databaseId}`, "PATCH", {}), P({ id: databaseId })) },
  { name: "DELETE /api/databases/[id]", minRole: "admin", call: () => databaseDELETE(req(`/api/databases/${databaseId}`, "DELETE"), P({ id: databaseId })) },
  { name: "POST /api/databases/[id]/properties", minRole: "editor", call: () => propertiesPOST(jsonReq(`/api/databases/${databaseId}/properties`, "POST", { name: "x", type: "text" }), P({ id: databaseId })) },
  { name: "POST /api/databases/[id]/records", minRole: "editor", call: () => recordsPOST(jsonReq(`/api/databases/${databaseId}/records`, "POST", { title: "x" }), P({ id: databaseId })) },
  { name: "POST /api/databases/[id]/sprints", minRole: "editor", call: () => sprintsPOST(jsonReq(`/api/databases/${databaseId}/sprints`, "POST", { name: "x" }), P({ id: databaseId })) },
  { name: "POST /api/databases/[id]/views", minRole: "editor", call: () => viewsPOST(jsonReq(`/api/databases/${databaseId}/views`, "POST", { type: "table" }), P({ id: databaseId })) },
  { name: "PATCH /api/properties/[id]", minRole: "editor", call: () => propertyPATCH(jsonReq(`/api/properties/${propertyId}`, "PATCH", { name: "x" }), P({ id: propertyId })) },
  { name: "DELETE /api/properties/[id]", minRole: "admin", call: () => propertyDELETE(req(`/api/properties/${propertyId}`, "DELETE"), P({ id: propertyId })) },
  { name: "PATCH /api/records/[id]", minRole: "editor", call: () => recordPATCH(jsonReq(`/api/records/${recordId}`, "PATCH", { title: "x" }), P({ id: recordId })) },
  { name: "DELETE /api/records/[id] (corbeille)", minRole: "editor", call: () => recordDELETE(req(`/api/records/${recordId}`, "DELETE"), P({ id: recordId })) },
  { name: "DELETE /api/records/[id]?permanent=1", minRole: "admin", call: () => recordDELETE(req(`/api/records/${recordId}?permanent=1`, "DELETE"), P({ id: recordId })) },
  { name: "POST /api/records/[id]/duplicate", minRole: "editor", call: () => duplicatePOST(req(`/api/records/${recordId}/duplicate`, "POST"), P({ id: recordId })) },
  { name: "POST /api/records/[id]/restore", minRole: "editor", call: () => recordRestorePOST(req(`/api/records/${recordId}/restore`, "POST"), P({ id: recordId })) },
  { name: "PATCH /api/views/[id]", minRole: "editor", call: () => viewPATCH(jsonReq(`/api/views/${viewId}`, "PATCH", { name: "x" }), P({ id: viewId })) },
  { name: "DELETE /api/views/[id]", minRole: "admin", call: () => viewDELETE(req(`/api/views/${viewId}`, "DELETE"), P({ id: viewId })) },
  { name: "PATCH /api/sprints/[id]", minRole: "editor", call: () => sprintPATCH(jsonReq(`/api/sprints/${sprintId}`, "PATCH", { name: "x" }), P({ id: sprintId })) },
  { name: "DELETE /api/sprints/[id]", minRole: "admin", call: () => sprintDELETE(req(`/api/sprints/${sprintId}`, "DELETE"), P({ id: sprintId })) },
  { name: "POST /api/templates", minRole: "editor", call: () => templatesPOST(jsonReq("/api/templates", "POST", { workspaceId, name: "x" })) },
  { name: "PATCH /api/templates/[id]", minRole: "editor", call: () => templatePATCH(jsonReq(`/api/templates/${templateId}`, "PATCH", { name: "x" }), P({ id: templateId })) },
  { name: "DELETE /api/templates/[id]", minRole: "admin", call: () => templateDELETE(req(`/api/templates/${templateId}`, "DELETE"), P({ id: templateId })) },
  // Routes SANS contexte workspace : gate « rôle requis quelque part ».
  { name: "POST /api/upload", minRole: "editor", call: () => uploadPOST(req("/api/upload", "POST")) },
  { name: "PATCH /api/config", minRole: "admin", call: () => configPATCH(jsonReq("/api/config", "PATCH", { uploadMaxMb: 10 })) },
];

const rolesBelow = { editor: ["viewer"], admin: ["viewer", "editor"] } as const;
const userFor = (role: "viewer" | "editor") => (role === "viewer" ? viewerId : editorId);

describe("Gates de rôle — 403 sous le rôle requis, sans effet de bord", () => {
  it.each(cases)("$name → 403 sous $minRole", async ({ minRole, call }) => {
    for (const role of rolesBelow[minRole]) {
      as(userFor(role));
      const res = await call();
      expect(res.status).toBe(403);
      expect(await res.json()).toEqual({ error: expect.any(String) });
    }
  });
});

// ─── Exemptions & précédence ──────────────────────────────────────────────────

describe("Exemptions lecteur et précédence 404/403", () => {
  it("POST /api/pages/[id]/visit reste ouvert au lecteur (section Récents)", async () => {
    as(viewerId);
    const res = await visitPOST(req(`/api/pages/${pageId}/visit`, "POST"), P({ id: pageId }));
    expect(res.status).toBe(200);
  });

  it("lecteur → 403 même sur SA page privée (lecture seule totale)", async () => {
    const own = await prisma.page.create({
      data: { title: "Priv", workspaceId, ownerId: viewerId, visibility: "private", sectionId },
    });
    as(viewerId);
    const res = await pagePATCH(jsonReq(`/api/pages/${own.id}`, "PATCH", { title: "x" }), P({ id: own.id }));
    expect(res.status).toBe(403);
  });

  it("POST /api/pages refuse un parent / une section d'un AUTRE espace → 404", async () => {
    const other = await seedUserWithWorkspace(`roles-cross-${Date.now()}@x.tld`);
    const foreignSection = await prisma.section.create({
      data: { name: "F", type: "team", position: 0, workspaceId: other.workspace.id },
    });
    const foreignPage = await prisma.page.create({
      data: { title: "F", workspaceId: other.workspace.id, ownerId: other.user.id, visibility: "team" },
    });
    // L'appelant est bien éditeur du workspaceId envoyé : seul le rattachement triche.
    as(editorId);
    const byParent = await pagesPOST(
      jsonReq("/api/pages", "POST", { workspaceId, title: "x", parentId: foreignPage.id })
    );
    expect(byParent.status).toBe(404);
    const bySection = await pagesPOST(
      jsonReq("/api/pages", "POST", { workspaceId, title: "x", sectionId: foreignSection.id })
    );
    expect(bySection.status).toBe(404);
  });

  it("membre de W1 visant W2 → 404 (jamais 403 : pas de leak d'existence)", async () => {
    as(viewerId);
    const res = await recordPATCH(
      jsonReq(`/api/records/${otherRecordId}`, "PATCH", { title: "x" }),
      P({ id: otherRecordId })
    );
    expect(res.status).toBe(404);
  });

  it("éditeur : créer, mettre à la corbeille et restaurer passent ; upload franchit le gate", async () => {
    as(editorId);
    const created = await recordsPOST(
      jsonReq(`/api/databases/${databaseId}/records`, "POST", { title: "e" }),
      P({ id: databaseId })
    );
    expect(created.status).toBe(201);
    const { id } = await created.json();

    expect((await recordDELETE(req(`/api/records/${id}`, "DELETE"), P({ id }))).status).toBe(200);
    expect((await recordRestorePOST(req(`/api/records/${id}/restore`, "POST"), P({ id }))).status).toBe(200);

    // Le gate « éditeur quelque part » passe → l'échec devient 400 (fichier manquant).
    expect((await uploadPOST(req("/api/upload", "POST"))).status).toBe(400);
  });
});

// ─── Méta-test anti-dérive ────────────────────────────────────────────────────
// Tout export POST/PATCH/DELETE sous src/app/api doit être DÉCLARÉ ici : soit
// gaté (présent dans la table), soit explicitement exempt/public. Un nouveau
// handler mutant non déclaré fait échouer ce test — il ne peut pas échapper
// silencieusement aux gates de rôle.

const DECLARED: Record<string, string[]> = {
  // Publics (créent la session — gardés par flags d'env, pas par rôle).
  "auth/login/route.ts": ["POST"],
  "auth/logout/route.ts": ["POST"],
  "auth/register/route.ts": ["POST"],
  "auth/oidc/login/route.ts": [],
  "auth/oidc/callback/route.ts": [],
  // Exemptés lecteur (matrice) : visite, switch d'espace, créer SON espace.
  "pages/[id]/visit/route.ts": ["POST"],
  "workspaces/[id]/switch/route.ts": ["POST"],
  "workspaces/route.ts": ["POST"],
  // Gatés — couverts par la table ci-dessus.
  "pages/route.ts": ["POST"],
  "pages/[id]/route.ts": ["PATCH", "DELETE"],
  "pages/[id]/restore/route.ts": ["POST"],
  "sections/route.ts": ["POST"],
  "sections/[id]/route.ts": ["PATCH", "DELETE"],
  "workspaces/[id]/route.ts": ["DELETE"],
  "workspaces/[id]/members/route.ts": ["POST"],
  "workspaces/[id]/members/[userId]/route.ts": ["PATCH", "DELETE"],
  "databases/route.ts": ["POST"],
  "databases/[id]/route.ts": ["PATCH", "DELETE"],
  "databases/[id]/properties/route.ts": ["POST"],
  "databases/[id]/records/route.ts": ["POST"],
  "databases/[id]/sprints/route.ts": ["POST"],
  "databases/[id]/views/route.ts": ["POST"],
  "properties/[id]/route.ts": ["PATCH", "DELETE"],
  "records/[id]/route.ts": ["PATCH", "DELETE"],
  "records/[id]/duplicate/route.ts": ["POST"],
  "records/[id]/restore/route.ts": ["POST"],
  "views/[id]/route.ts": ["PATCH", "DELETE"],
  "sprints/[id]/route.ts": ["PATCH", "DELETE"],
  "templates/route.ts": ["POST"],
  "templates/[id]/route.ts": ["PATCH", "DELETE"],
  "upload/route.ts": ["POST"],
  "config/route.ts": ["PATCH"],
};

function listRouteFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...listRouteFiles(full));
    else if (entry === "route.ts") out.push(full);
  }
  return out;
}

describe("Méta-test anti-dérive : tout handler mutant est déclaré", () => {
  it("aucun POST/PATCH/DELETE non déclaré sous src/app/api", () => {
    const apiRoot = path.resolve(__dirname, "../../src/app/api");
    const undeclared: string[] = [];
    for (const file of listRouteFiles(apiRoot)) {
      const rel = path.relative(apiRoot, file).replaceAll(path.sep, "/");
      const src = readFileSync(file, "utf8");
      const methods = [...src.matchAll(/export async function (POST|PATCH|DELETE|PUT)\b/g)].map(
        (m) => m[1]
      );
      for (const method of methods) {
        if (!(DECLARED[rel] ?? []).includes(method)) undeclared.push(`${method} ${rel}`);
      }
    }
    expect(undeclared).toEqual([]);
  });
});
