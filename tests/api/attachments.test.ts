import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { promises as fs } from "node:fs";
import path from "node:path";

vi.mock("@/lib/session", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/session")>()),
  getSession: vi.fn(),
}));

import { getSession } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import {
  GET as listAttachments,
  POST as addAttachment,
} from "@/app/api/records/[id]/attachments/route";
import {
  GET as downloadAttachment,
  DELETE as removeAttachment,
} from "@/app/api/attachments/[id]/route";
import { POST as duplicateRecord } from "@/app/api/records/[id]/duplicate/route";
import { uploadsDir } from "@/lib/uploads";
import { seedUserWithWorkspace, seedMember } from "../helpers/seed";

/**
 * Pièces jointes d'une carte : dépôt, téléchargement, retrait, duplication.
 *
 * ⚠️ Le sujet de ce fichier est le CONTRÔLE D'ACCÈS. La route de téléchargement
 * passe par la carte (checkRecordAccess), là où GET /api/files/[name] ne vérifie
 * qu'une session : perdre l'accès à la carte doit fermer le document.
 */

let ownerId: string;
let editeurId: string;
let lecteurId: string;
let etrangerId: string;
let workspaceId: string;
let recordId: string;
let recordPriveId: string;

const as = (userId: string) =>
  vi.mocked(getSession).mockResolvedValue({
    id: userId,
    email: "x@x.tld",
    displayName: "Acteur",
    currentWorkspaceId: workspaceId,
    isService: false,
  });

const P = (id: string) => ({ params: Promise.resolve({ id }) });

function multipart(nom: string, type: string, octets = "contenu") {
  const form = new FormData();
  form.set("file", new File([octets], nom, { type }));
  return new Request("http://localhost/x", { method: "POST", body: form });
}

const poser = (rid: string, nom: string, type: string, octets = "contenu") =>
  addAttachment(multipart(nom, type, octets), P(rid));

async function carteDans(visibility: "team" | "private", proprio: string) {
  const section = await prisma.section.create({
    data: { name: `S${Date.now()}`, type: "team", position: 0, workspaceId },
  });
  const page = await prisma.page.create({
    data: { title: "Hôte", workspaceId, ownerId: proprio, visibility, sectionId: section.id },
  });
  const db = await prisma.database.create({ data: { pageId: page.id } });
  return (await prisma.record.create({ data: { databaseId: db.id, title: "Carte" } })).id;
}

beforeAll(async () => {
  const seeded = await seedUserWithWorkspace(`att-owner-${Date.now()}@x.tld`);
  ownerId = seeded.user.id;
  workspaceId = seeded.workspace.id;
  editeurId = (await seedMember(workspaceId, "editor")).user.id;
  lecteurId = (await seedMember(workspaceId, "viewer")).user.id;
  etrangerId = (await seedUserWithWorkspace(`att-etranger-${Date.now()}@x.tld`)).user.id;

  recordId = await carteDans("team", ownerId);
  recordPriveId = await carteDans("private", ownerId);
  await fs.mkdir(uploadsDir(), { recursive: true });
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe("POST — déposer un document", () => {
  it("un éditeur dépose un PDF : 201, et le nom d'ORIGINE est conservé", async () => {
    as(editeurId);
    const res = await poser(recordId, "Contrat 2026.pdf", "application/pdf");
    expect(res.status).toBe(201);

    const body = await res.json();
    // Sans ce champ, la carte afficherait un UUID : le disque ne connaît que lui.
    expect(body.name).toBe("Contrat 2026.pdf");
    expect(body.mimeType).toBe("application/pdf");

    const row = await prisma.recordAttachment.findUniqueOrThrow({ where: { id: body.id } });
    expect(row.fileName).toMatch(/^[A-Za-z0-9-]+\.pdf$/);
    expect(await fs.stat(path.join(uploadsDir(), row.fileName))).toBeTruthy();
  });

  it("⚠️ un LECTEUR est refusé (403) — lecture seule TOTALE", async () => {
    as(lecteurId);
    expect((await poser(recordId, "x.pdf", "application/pdf")).status).toBe(403);
  });

  it("⚠️ un étranger à l'espace ne sait même pas que la carte existe (404)", async () => {
    as(etrangerId);
    expect((await poser(recordId, "x.pdf", "application/pdf")).status).toBe(404);
  });

  it("un type non supporté est refusé en 415", async () => {
    as(editeurId);
    expect((await poser(recordId, "malin.svg", "image/svg+xml")).status).toBe(415);
    expect((await poser(recordId, "script.js", "text/javascript")).status).toBe(415);
  });

  it("un fichier trop gros est refusé en 413", async () => {
    as(editeurId);
    const { setAppConfig } = await import("@/lib/appConfig");
    await setAppConfig({ uploadMaxMb: 1 });
    const gros = "x".repeat(1024 * 1024 + 10);
    expect((await poser(recordId, "gros.pdf", "application/pdf", gros)).status).toBe(413);
    await setAppConfig({ uploadMaxMb: 10 });
  });

  it("un nom d'origine réduit à des espaces retombe sur un libellé", async () => {
    // ⚠️ Un nom VIDE ne passe pas par ce chemin : `FormData` cesse alors de
    // traiter l'entrée comme un fichier, et la route répond 400 « Fichier
    // manquant ». Le cas testé ici est celui qui atteint vraiment le code.
    as(editeurId);
    const res = await poser(recordId, "   ", "text/plain");
    expect(res.status).toBe(201);
    expect((await res.json()).name).toBe("document");
  });

  it("un nom d'origine très long est tronqué, pas refusé", async () => {
    as(editeurId);
    const body = await (
      await poser(recordId, `${"a".repeat(400)}.pdf`, "application/pdf")
    ).json();
    expect(body.name.length).toBeLessThanOrEqual(200);
  });
});

describe("GET — lister et télécharger", () => {
  it("la liste expose le displayName, JAMAIS l'email", async () => {
    as(editeurId);
    await poser(recordId, "liste.pdf", "application/pdf");
    const rows = await (await listAttachments(new Request("http://x"), P(recordId))).json();

    expect(rows.length).toBeGreaterThan(0);
    const blob = JSON.stringify(rows);
    expect(blob).not.toContain("@x.tld");
    expect(rows[0].uploadedBy).toBe("Test editor");
  });

  it("un LECTEUR peut lire et télécharger — il ne peut simplement pas écrire", async () => {
    as(editeurId);
    const { id } = await (await poser(recordId, "pour-lecteur.pdf", "application/pdf")).json();

    as(lecteurId);
    expect((await listAttachments(new Request("http://x"), P(recordId))).status).toBe(200);
    const dl = await downloadAttachment(new Request("http://x"), P(id));
    expect(dl.status).toBe(200);
    expect(dl.headers.get("content-disposition")).toContain("filename*=UTF-8''");
  });

  it("⚠️ le téléchargement est scopé à la CARTE, pas au nom du fichier", async () => {
    // Toute la différence avec /api/files/[name], où la session suffit.
    as(ownerId);
    const { id } = await (await poser(recordPriveId, "secret.pdf", "application/pdf")).json();

    as(editeurId); // membre de l'espace, mais la page est PRIVÉE et d'un autre
    expect((await downloadAttachment(new Request("http://x"), P(id))).status).toBe(404);
    expect((await listAttachments(new Request("http://x"), P(recordPriveId))).status).toBe(404);
  });

  it("les en-têtes interdisent le rendu et le cache", async () => {
    as(editeurId);
    const { id } = await (await poser(recordId, "entetes.pdf", "application/pdf")).json();
    const res = await downloadAttachment(new Request("http://x"), P(id));

    expect(res.headers.get("content-type")).toBe("application/octet-stream");
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(res.headers.get("content-security-policy")).toContain("sandbox");
    expect(res.headers.get("cross-origin-resource-policy")).toBe("same-origin");
  });

  it("une ligne dont le fichier a disparu rend 404, pas 500", async () => {
    as(editeurId);
    const { id } = await (await poser(recordId, "fantome.pdf", "application/pdf")).json();
    const row = await prisma.recordAttachment.findUniqueOrThrow({ where: { id } });
    await fs.unlink(path.join(uploadsDir(), row.fileName));

    expect((await downloadAttachment(new Request("http://x"), P(id))).status).toBe(404);
  });

  it("le nom d'origine ACCENTUÉ survit à l'en-tête", async () => {
    as(editeurId);
    const { id } = await (await poser(recordId, "Résumé été.pdf", "application/pdf")).json();
    const res = await downloadAttachment(new Request("http://x"), P(id));
    expect(res.headers.get("content-disposition")).toContain(encodeURIComponent("Résumé été.pdf"));
  });
});

describe("DELETE — retirer", () => {
  it("⚠️ retire la LIGNE, jamais le fichier", async () => {
    // Un autre enregistrement peut le citer (duplication). C'est la purge qui
    // décide, en recalculant les références.
    as(editeurId);
    const { id } = await (await poser(recordId, "aretirer.pdf", "application/pdf")).json();
    const row = await prisma.recordAttachment.findUniqueOrThrow({ where: { id } });

    expect((await removeAttachment(new Request("http://x"), P(id))).status).toBe(200);
    expect(await prisma.recordAttachment.findUnique({ where: { id } })).toBeNull();
    expect(await fs.stat(path.join(uploadsDir(), row.fileName))).toBeTruthy();
  });

  it("un LECTEUR ne retire rien (403)", async () => {
    as(editeurId);
    const { id } = await (await poser(recordId, "protege.pdf", "application/pdf")).json();

    as(lecteurId);
    expect((await removeAttachment(new Request("http://x"), P(id))).status).toBe(403);
    expect(await prisma.recordAttachment.findUnique({ where: { id } })).not.toBeNull();
  });
});

describe("Duplication — les pièces jointes suivent, en partageant le fichier", () => {
  it("la copie porte les mêmes documents, sans recopier un octet", async () => {
    as(editeurId);
    const src = await carteDans("team", ownerId);
    const { id } = await (await poser(src, "aduppliquer.pdf", "application/pdf")).json();
    const original = await prisma.recordAttachment.findUniqueOrThrow({ where: { id } });

    const copie = await (
      await duplicateRecord(new Request("http://x", { method: "POST" }), P(src))
    ).json();

    const jointes = await prisma.recordAttachment.findMany({ where: { recordId: copie.id } });
    expect(jointes).toHaveLength(1);
    expect(jointes[0].name).toBe("aduppliquer.pdf");
    // MÊME fichier sur disque : c'est le comptage de références de la purge qui
    // protège l'octet, pas une copie.
    expect(jointes[0].fileName).toBe(original.fileName);
    // Et l'auteur reste celui qui a DÉPOSÉ, pas celui qui a dupliqué.
    expect(jointes[0].uploadedBy).toBe(original.uploadedBy);
  });
});
