import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { readFileSync, globSync } from "node:fs";

// Mock PARTIEL : le module exporte aussi hashToken/createSession, dont dépendent
// des chemins réels. Un mock total les remplacerait par undefined.
vi.mock("@/lib/session", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/session")>()),
  getSession: vi.fn(),
}));

import { getSession } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { POST as createWorkspace } from "@/app/api/workspaces/route";
import { createWorkspaceWithDefaults } from "@/lib/workspace";
import { seedUserWithWorkspace } from "../helpers/seed";

/**
 * Rattachement d'office des comptes de SERVICE aux espaces créés.
 *
 * Le sujet de ce fichier n'est pas « est-ce que ça marche » — c'est le PÉRIMÈTRE.
 * Un compte de service voit les pages PRIVÉES des espaces où il est membre : le
 * rattacher au « Mon espace » personnel de chaque nouveau compte lui ferait lire
 * l'espace privé de toute personne qui s'inscrit. D'où un opt-in à défaut FALSE,
 * un seul appelant, et un méta-test qui refuse le second.
 */

let ownerId: string;
let serviceId: string;
let humainId: string;

const as = (userId: string, isService: boolean) =>
  vi.mocked(getSession).mockResolvedValue({
    id: userId,
    email: "x@x.tld",
    displayName: "Acteur",
    currentWorkspaceId: null,
    isService,
  });

const post = (name: string) =>
  createWorkspace(
    new Request("http://localhost/api/workspaces", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
    })
  );

const membershipOf = (userId: string, workspaceId: string) =>
  prisma.membership.findUnique({
    where: { userId_workspaceId: { userId, workspaceId } },
    select: { role: true },
  });

beforeAll(async () => {
  const stamp = Date.now();
  ownerId = (await seedUserWithWorkspace(`autojoin-owner-${stamp}@x.tld`)).user.id;

  const service = await prisma.user.create({
    data: {
      email: `autojoin-ia-${stamp}@gotyeah.local`,
      firstName: "IA",
      lastName: "",
      displayName: "IA autojoin",
      passwordHash: "not-a-real-hash",
      isService: true,
    },
  });
  serviceId = service.id;

  // Témoin : un humain, pour vérifier que le filtre porte bien sur isService et
  // n'embarque pas tout le monde.
  const humain = await prisma.user.create({
    data: {
      email: `autojoin-humain-${stamp}@x.tld`,
      firstName: "H",
      lastName: "",
      displayName: "Humain témoin",
      passwordHash: "not-a-real-hash",
    },
  });
  humainId = humain.id;
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe("POST /api/workspaces — le geste explicite « créer un espace »", () => {
  it("rattache le compte de service, en admin", async () => {
    as(ownerId, false);
    const res = await post("Espace neuf");
    expect(res.status).toBe(200);
    const workspace = await res.json();

    const m = await membershipOf(serviceId, workspace.id);
    expect(m).toBeTruthy();
    // admin et pas editor : six outils MCP de suppression sont gatés admin.
    expect(m!.role).toBe("admin");
  });

  it("le créateur reste admin de son espace", async () => {
    as(ownerId, false);
    const workspace = await (await post("Espace du créateur")).json();
    expect((await membershipOf(ownerId, workspace.id))!.role).toBe("admin");
  });

  it("⚠️ n'embarque QUE les comptes de service, pas les autres utilisateurs", async () => {
    as(ownerId, false);
    const workspace = await (await post("Espace filtré")).json();
    expect(await membershipOf(humainId, workspace.id)).toBeNull();
  });

  it("⚠️ un compte de service qui crée un espace ne se rattache pas DEUX fois", async () => {
    // Le pont MCP expose notes_create_workspace : le créateur peut lui-même être
    // le compte de service. Sa membership est déjà posée — la réémettre
    // violerait l'unique (userId, workspaceId) et ferait échouer la transaction,
    // donc la création de l'espace elle-même.
    as(serviceId, true);
    const res = await post("Espace créé par l'IA");
    expect(res.status).toBe(200);
    const workspace = await res.json();

    const count = await prisma.membership.count({
      where: { userId: serviceId, workspaceId: workspace.id },
    });
    expect(count).toBe(1);
    expect((await membershipOf(serviceId, workspace.id))!.role).toBe("admin");
  });
});

describe("⚠️ Périmètre — le « Mon espace » d'un nouveau compte n'est PAS concerné", () => {
  it("sans l'option, aucun compte de service n'est rattaché", async () => {
    // C'est le chemin des trois autres appelants : register, callback OIDC et
    // acceptation d'invitation. Ils fabriquent l'espace PERSONNEL d'un compte
    // qui vient de naître.
    const workspace = await createWorkspaceWithDefaults("Mon espace", ownerId);
    expect(await membershipOf(serviceId, workspace.id)).toBeNull();
  });

  it("les sections par défaut sont posées dans les deux cas", async () => {
    as(ownerId, false);
    const avecService = await (await post("Espace avec service")).json();
    const sansService = await createWorkspaceWithDefaults("Espace sans service", ownerId);

    for (const id of [avecService.id, sansService.id]) {
      const sections = await prisma.section.findMany({
        where: { workspaceId: id },
        orderBy: { position: "asc" },
        select: { type: true },
      });
      expect(sections.map((s) => s.type)).toEqual(["private", "team"]);
    }
  });
});

describe("⚠️ Méta-test — un seul appelant a le droit de le demander", () => {
  it("`withServiceAccounts` n'est passé que par POST /api/workspaces", () => {
    // La garde n'est pas le défaut de l'argument : c'est le nombre d'appelants.
    // Un opt-in ajouté ailleurs (typiquement sur une inscription, « pour que
    // l'IA voie tout ») ouvrirait les pages privées de l'espace personnel de
    // chaque nouveau compte, CI verte à l'appui. Ce test le fait échouer.
    const attendu = "src/app/api/workspaces/route.ts";
    const fautifs = globSync("src/app/**/*.{ts,tsx}", { cwd: process.cwd() })
      .map((f) => f.replace(/\\/g, "/"))
      .filter((f) => f !== attendu)
      .filter((f) => readFileSync(f, "utf8").includes("withServiceAccounts"));

    expect(fautifs).toEqual([]);
    expect(readFileSync(attendu, "utf8")).toContain("withServiceAccounts: true");
  });
});
