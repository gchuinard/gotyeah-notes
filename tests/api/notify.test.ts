import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { prisma } from "@/lib/prisma";
import { notify } from "@/lib/notify";
import { removeMember } from "@/lib/workspace";
import { seedUserWithWorkspace, seedMember } from "../helpers/seed";

/**
 * Les deux filtres de `notify()`, et l'effacement au retrait.
 *
 * Ces trois lignes figuraient au plan de test de la carte « Notifications
 * (cloche) » et n'avaient jamais été écrites : le lot est parti en production
 * avec ses gardes non couvertes. Elles sont pourtant load-bearing — l'une
 * empêche la cloche de rester un canal de lecture vers un espace qu'on a quitté,
 * l'autre empêche d'écrire des messages à un compte qui n'a pas de boîte.
 */

let workspaceId: string;
let ownerId: string;
let membreId: string;
let serviceId: string;

const dernieresDe = (userId: string) =>
  prisma.notification.findMany({ where: { userId }, orderBy: { createdAt: "desc" } });

beforeAll(async () => {
  const seeded = await seedUserWithWorkspace(`notify-owner-${Date.now()}@x.tld`);
  ownerId = seeded.user.id;
  workspaceId = seeded.workspace.id;
  membreId = (await seedMember(workspaceId, "editor")).user.id;

  const service = await prisma.user.create({
    data: {
      email: `notify-ia-${Date.now()}@gotyeah.local`,
      firstName: "IA",
      lastName: "",
      displayName: "IA notify",
      passwordHash: "not-a-real-hash",
      isService: true,
    },
  });
  serviceId = service.id;
  await prisma.membership.create({
    data: { userId: serviceId, workspaceId, role: "admin" },
  });
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe("notify — qui reçoit, et qui ne reçoit jamais", () => {
  it("⚠️ un compte de SERVICE n'est jamais destinataire", async () => {
    // Il n'a pas de boîte, pas de cloche, et il voit déjà les pages privées des
    // espaces où il est membre. Lui écrire ne préviendrait personne.
    const avant = (await dernieresDe(serviceId)).length;
    const ecrites = await notify(prisma, [
      { userId: serviceId, type: "workspace_joined", workspaceId, actorId: ownerId },
    ]);
    expect(ecrites).toBe(0);
    expect((await dernieresDe(serviceId)).length).toBe(avant);
  });

  it("un humain visé dans le MÊME lot reçoit quand même", async () => {
    // Le filtre écarte le compte de service sans emporter le reste : sans ce
    // test, un `return 0` global passerait pour un filtre correct.
    const avantHumain = (await dernieresDe(membreId)).length;
    const ecrites = await notify(prisma, [
      { userId: serviceId, type: "workspace_joined", workspaceId, actorId: ownerId },
      { userId: membreId, type: "workspace_joined", workspaceId, actorId: ownerId },
    ]);
    expect(ecrites).toBe(1);
    expect((await dernieresDe(membreId)).length).toBe(avantHumain + 1);
  });

  it("⚠️ on ne se notifie JAMAIS de sa propre action", async () => {
    // Sinon changer son propre rôle, ou quitter un espace, s'annoncerait à soi.
    const avant = (await dernieresDe(ownerId)).length;
    expect(
      await notify(prisma, [
        { userId: ownerId, type: "role_changed", workspaceId, actorId: ownerId },
      ])
    ).toBe(0);
    expect((await dernieresDe(ownerId)).length).toBe(avant);
  });

  it("⚠️ NE LÈVE JAMAIS : une écriture impossible rend 0 au lieu de casser le geste", async () => {
    // Le geste métier prime sur son annonce. Un workspaceId inexistant viole la
    // clé étrangère — l'ajout d'un membre ne doit pas échouer pour autant.
    await expect(
      notify(prisma, [
        {
          userId: membreId,
          type: "workspace_joined",
          workspaceId: "workspace-qui-n-existe-pas",
          actorId: ownerId,
        },
      ])
    ).resolves.toBe(0);
  });
});

describe("removeMember — la cloche ne survit pas au retrait", () => {
  it("⚠️ efface les notifications de CET espace, et garde celle du retrait", async () => {
    // Sans cet effacement, la cloche resterait un canal de lecture vers un
    // espace qu'on ne peut plus ouvrir : titres de cartes, noms d'acteurs.
    const partant = (await seedMember(workspaceId, "editor")).user.id;
    const autre = await seedUserWithWorkspace(`notify-ailleurs-${Date.now()}@x.tld`);
    await prisma.membership.create({
      data: { userId: partant, workspaceId: autre.workspace.id, role: "viewer" },
    });

    await notify(prisma, [
      { userId: partant, type: "workspace_joined", workspaceId, actorId: ownerId },
      { userId: partant, type: "role_changed", workspaceId, actorId: ownerId },
      // Celle-ci vise un AUTRE espace : elle doit survivre.
      {
        userId: partant,
        type: "workspace_joined",
        workspaceId: autre.workspace.id,
        actorId: autre.user.id,
      },
    ]);
    expect((await dernieresDe(partant)).length).toBe(3);

    const res = await removeMember(workspaceId, partant, { actorId: ownerId });
    expect(res.ok).toBe(true);

    const restantes = await dernieresDe(partant);
    // Il reste celle de l'AUTRE espace, plus l'annonce du retrait lui-même —
    // écrite après l'effacement, sinon on effacerait le message qu'on vient
    // d'envoyer.
    expect(restantes.map((n) => n.type).sort()).toEqual([
      "membership_removed",
      "workspace_joined",
    ]);
    expect(
      restantes.filter((n) => n.workspaceId === workspaceId).map((n) => n.type)
    ).toEqual(["membership_removed"]);
  });
});
