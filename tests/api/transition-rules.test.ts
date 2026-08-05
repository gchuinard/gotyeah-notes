import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";

vi.mock("@/lib/session", () => ({ getSession: vi.fn() }));

import { getSession } from "@/lib/session";
import { PATCH as recordPATCH } from "@/app/api/records/[id]/route";
import { POST as recordsPOST } from "@/app/api/databases/[id]/records/route";
import { POST as duplicatePOST } from "@/app/api/records/[id]/duplicate/route";
import { PATCH as propertyPATCH } from "@/app/api/properties/[id]/route";
import { prisma } from "@/lib/prisma";
import { seedUserWithWorkspace, seedMember } from "../helpers/seed";

const mockGetSession = vi.mocked(getSession);

let workspaceId: string;
let adminId: string;
let editorId: string;
let databaseId: string;
let marieId: string;

const TODO = "opt-todo";
const DONE = "opt-done";

const as = (userId: string) =>
  mockGetSession.mockResolvedValue({
    id: userId,
    email: "x@x.tld",
    displayName: "X",
    currentWorkspaceId: workspaceId,
    isService: false,
  });

const P = <T extends Record<string, string>>(p: T) => ({ params: Promise.resolve(p) });
const jsonReq = (method: string, body: unknown) =>
  new Request("http://x/", {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

/** Propriété select « Statut », avec ou sans règles. */
async function mkStatusProperty(rules?: unknown) {
  return prisma.databaseProperty.create({
    data: {
      databaseId,
      name: `Statut-${Math.random().toString(36).slice(2, 8)}`,
      type: "select",
      position: 2000,
      config: JSON.stringify({
        type: "select",
        options: [
          { id: TODO, name: "À faire", color: "blue" },
          { id: DONE, name: "Terminé", color: "gray" },
        ],
        ...(rules ? { rules } : {}),
      }),
    },
  });
}

const mkRecord = (props: Record<string, unknown> = {}) =>
  prisma.record.create({
    data: { databaseId, title: "carte", position: 1000, properties: JSON.stringify(props) },
  });

beforeAll(async () => {
  const seeded = await seedUserWithWorkspace(`rules-admin-${Date.now()}@x.tld`);
  adminId = seeded.user.id;
  workspaceId = seeded.workspace.id;
  editorId = (await seedMember(workspaceId, "editor")).user.id;
  marieId = (await seedMember(workspaceId, "editor")).user.id;

  const page = await prisma.page.create({
    data: { title: "Board", workspaceId, ownerId: adminId, visibility: "team", position: 1000 },
  });
  databaseId = (await prisma.database.create({ data: { pageId: page.id } })).id;
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe("NON-RÉGRESSION — une propriété SANS règles se comporte comme avant", () => {
  // Le contrat vis-à-vis des 22 boards de production. Si ce bloc casse, le lot
  // ne doit pas partir.
  it("un éditeur pose n'importe quelle option (PATCH)", async () => {
    const prop = await mkStatusProperty();
    const rec = await mkRecord({ [prop.id]: TODO });
    as(editorId);

    const res = await recordPATCH(
      jsonReq("PATCH", { properties: { [prop.id]: DONE } }),
      P({ id: rec.id })
    );
    expect(res.status).toBe(200);
    expect((await res.json()).properties[prop.id]).toBe(DONE);
  });

  it("un éditeur crée et duplique librement", async () => {
    const prop = await mkStatusProperty();
    as(editorId);

    const created = await recordsPOST(
      jsonReq("POST", { title: "neuve", properties: { [prop.id]: DONE } }),
      P({ id: databaseId })
    );
    expect(created.status).toBe(201);

    const dup = await duplicatePOST(
      jsonReq("POST", {}),
      P({ id: (await created.json()).id })
    );
    expect(dup.status).toBe(201);
  });
});

describe("PATCH /records/[id] — la règle mord", () => {
  it("un éditeur non autorisé reçoit 403, sans écriture NI révision", async () => {
    const prop = await mkStatusProperty([{ toOptionId: DONE, userIds: [marieId] }]);
    const rec = await mkRecord({ [prop.id]: TODO });
    as(editorId);

    const res = await recordPATCH(
      jsonReq("PATCH", { properties: { [prop.id]: DONE } }),
      P({ id: rec.id })
    );
    expect(res.status).toBe(403);
    expect((await res.json()).error).toMatch(/Transition non autoris/i);

    const after = await prisma.record.findUniqueOrThrow({ where: { id: rec.id } });
    expect(JSON.parse(after.properties)[prop.id]).toBe(TODO);
    expect(await prisma.recordRevision.count({ where: { recordId: rec.id } })).toBe(0);
  });

  it("la personne nommée passe", async () => {
    const prop = await mkStatusProperty([{ toOptionId: DONE, userIds: [marieId] }]);
    const rec = await mkRecord({ [prop.id]: TODO });
    as(marieId);

    const res = await recordPATCH(
      jsonReq("PATCH", { properties: { [prop.id]: DONE } }),
      P({ id: rec.id })
    );
    expect(res.status).toBe(200);
  });

  it("un ADMIN est soumis à la règle comme les autres", async () => {
    // Décision du 05/08 : pas d'exemption admin. Son échappatoire est de
    // modifier la règle, ce que lui seul peut faire.
    const prop = await mkStatusProperty([{ toOptionId: DONE, userIds: [marieId] }]);
    const rec = await mkRecord({ [prop.id]: TODO });
    as(adminId);

    expect(
      (await recordPATCH(jsonReq("PATCH", { properties: { [prop.id]: DONE } }), P({ id: rec.id })))
        .status
    ).toBe(403);
  });

  it("modifier le TITRE d'une carte déjà dans la colonne interdite reste permis", async () => {
    // Sans ça, un membre restreint ne pourrait plus rien toucher sur les cartes
    // posées dans une colonne qu'il n'a pas le droit d'alimenter.
    const prop = await mkStatusProperty([{ toOptionId: DONE, userIds: [marieId] }]);
    const rec = await mkRecord({ [prop.id]: DONE });
    as(editorId);

    expect(
      (await recordPATCH(jsonReq("PATCH", { title: "renommée" }), P({ id: rec.id }))).status
    ).toBe(200);
  });

  it("réémettre la MÊME option n'est pas une transition", async () => {
    const prop = await mkStatusProperty([{ toOptionId: DONE, userIds: [marieId] }]);
    const rec = await mkRecord({ [prop.id]: DONE });
    as(editorId);

    expect(
      (await recordPATCH(jsonReq("PATCH", { properties: { [prop.id]: DONE } }), P({ id: rec.id })))
        .status
    ).toBe(200);
  });

  it("sortir de la colonne restreinte reste permis (seule l'ENTRÉE est gouvernée)", async () => {
    const prop = await mkStatusProperty([{ toOptionId: DONE, userIds: [marieId] }]);
    const rec = await mkRecord({ [prop.id]: DONE });
    as(editorId);

    expect(
      (await recordPATCH(jsonReq("PATCH", { properties: { [prop.id]: TODO } }), P({ id: rec.id })))
        .status
    ).toBe(200);
  });
});

describe("Les deux portes de CRÉATION sont fermées", () => {
  it("POST /records : créer directement dans la colonne verrouillée → 403", async () => {
    const prop = await mkStatusProperty([{ toOptionId: DONE, roles: ["admin"] }]);
    as(editorId);
    const before = await prisma.record.count({ where: { databaseId } });

    const res = await recordsPOST(
      jsonReq("POST", { title: "triche", properties: { [prop.id]: DONE } }),
      P({ id: databaseId })
    );
    expect(res.status).toBe(403);
    expect(await prisma.record.count({ where: { databaseId } })).toBe(before);
  });

  it("duplicate : copier une carte assise dans la colonne verrouillée → 403", async () => {
    const prop = await mkStatusProperty([{ toOptionId: DONE, roles: ["admin"] }]);
    const rec = await mkRecord({ [prop.id]: DONE });
    as(editorId);
    const before = await prisma.record.count({ where: { databaseId } });

    const res = await duplicatePOST(jsonReq("POST", {}), P({ id: rec.id }));
    expect(res.status).toBe(403);
    expect(await prisma.record.count({ where: { databaseId } })).toBe(before);
  });
});

describe("PATCH /properties/[id] — qui peut écrire les règles", () => {
  const configOf = (rules?: unknown) => ({
    type: "select",
    options: [
      { id: TODO, name: "À faire", color: "blue" },
      { id: DONE, name: "Terminé", color: "gray" },
    ],
    ...(rules ? { rules } : {}),
  });

  it("un ÉDITEUR ne peut pas poser de règle (403) — sinon il se dé-restreint", async () => {
    const prop = await mkStatusProperty();
    as(editorId);

    const res = await propertyPATCH(
      jsonReq("PATCH", { config: configOf([{ toOptionId: DONE, roles: ["admin"] }]) }),
      P({ id: prop.id })
    );
    expect(res.status).toBe(403);
  });

  it("un éditeur peut TOUJOURS renommer une option (non-régression)", async () => {
    // Le popover réémet {...config} à chaque renommage : gater la PRÉSENCE de la
    // clé plutôt que sa différence lui vaudrait un 403 systématique.
    const prop = await mkStatusProperty([{ toOptionId: DONE, roles: ["admin"] }]);
    as(editorId);

    const res = await propertyPATCH(
      jsonReq("PATCH", {
        config: {
          type: "select",
          options: [
            { id: TODO, name: "À faire (renommé)", color: "blue" },
            { id: DONE, name: "Terminé", color: "gray" },
          ],
          rules: [{ toOptionId: DONE, roles: ["admin"] }],
        },
      }),
      P({ id: prop.id })
    );
    expect(res.status).toBe(200);
  });

  it("un config SANS clé rules (cas MCP) conserve les règles existantes", async () => {
    const prop = await mkStatusProperty([{ toOptionId: DONE, roles: ["admin"] }]);
    as(editorId);

    const res = await propertyPATCH(
      jsonReq("PATCH", { config: configOf() }),
      P({ id: prop.id })
    );
    expect(res.status).toBe(200);
    const saved = JSON.parse(
      (await prisma.databaseProperty.findUniqueOrThrow({ where: { id: prop.id } })).config
    );
    expect(saved.rules).toEqual([{ toOptionId: DONE, roles: ["admin"] }]);
  });

  it("un admin pose les règles", async () => {
    const prop = await mkStatusProperty();
    as(adminId);

    const res = await propertyPATCH(
      jsonReq("PATCH", { config: configOf([{ toOptionId: DONE, userIds: [marieId] }]) }),
      P({ id: prop.id })
    );
    expect(res.status).toBe(200);
  });

  it("une règle sur une option INEXISTANTE est refusée (400)", async () => {
    const prop = await mkStatusProperty();
    as(adminId);

    const res = await propertyPATCH(
      jsonReq("PATCH", { config: configOf([{ toOptionId: "fantome", roles: ["admin"] }]) }),
      P({ id: prop.id })
    );
    expect(res.status).toBe(400);
  });

  it("deux règles sur la même option sont refusées (400)", async () => {
    const prop = await mkStatusProperty();
    as(adminId);

    const res = await propertyPATCH(
      jsonReq("PATCH", {
        config: configOf([
          { toOptionId: DONE, roles: ["admin"] },
          { toOptionId: DONE, roles: ["editor"] },
        ]),
      }),
      P({ id: prop.id })
    );
    expect(res.status).toBe(400);
  });
});

describe("Une option citée par une règle est protégée", () => {
  it("la retirer seule → 400 avec un message qui dit où aller", async () => {
    const prop = await mkStatusProperty([{ toOptionId: DONE, roles: ["admin"] }]);
    as(adminId);

    const res = await propertyPATCH(
      jsonReq("PATCH", {
        config: { type: "select", options: [{ id: TODO, name: "À faire", color: "blue" }] },
      }),
      P({ id: prop.id })
    );
    expect(res.status).toBe(400);
    // Un 400 sans issue serait un cul-de-sac pour le MCP, qui n'expose pas les règles.
    expect((await res.json()).error).toMatch(/règle/i);
  });

  it("la retirer AVEC sa règle, dans le même PATCH → 200", async () => {
    const prop = await mkStatusProperty([{ toOptionId: DONE, roles: ["admin"] }]);
    as(adminId);

    const res = await propertyPATCH(
      jsonReq("PATCH", {
        config: {
          type: "select",
          options: [{ id: TODO, name: "À faire", color: "blue" }],
          rules: [],
        },
      }),
      P({ id: prop.id })
    );
    expect(res.status).toBe(200);
  });
});
