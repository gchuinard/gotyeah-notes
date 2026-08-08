import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { promises as fs } from "node:fs";
import path from "node:path";

vi.mock("@/lib/session", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/session")>()),
  getSession: vi.fn(),
}));

import { getSession } from "@/lib/session";
import { GET as serveFile } from "@/app/api/files/[name]/route";
import { uploadsDir, fileResponseHeaders, FILE_CSP } from "@/lib/uploads";
import { seedUserWithWorkspace } from "../helpers/seed";
import { prisma } from "@/lib/prisma";

/**
 * Durcissement du service de fichiers.
 *
 * Le trou fermé ici : `image/svg+xml` est un type téléversable, et un SVG est un
 * DOCUMENT — il peut porter un <script>, que le navigateur exécute quand on
 * ouvre l'URL directement. Le fichier est servi sur l'origine de l'application,
 * donc c'était une XSS stockée same-origin. `X-Content-Type-Options: nosniff`
 * (posé globalement) n'y pouvait rien : il empêche de DEVINER un autre type,
 * pas d'honorer celui qu'on déclare.
 */

const SVG_PIEGE = `<svg xmlns="http://www.w3.org/2000/svg"><script>fetch('/api/workspaces')</script></svg>`;

let nomSvg: string;
let nomPng: string;

const withName = (name: string) => ({ params: Promise.resolve({ name }) });
const get = (name: string) =>
  serveFile(new Request(`http://localhost/api/files/${name}`), withName(name));

beforeAll(async () => {
  const { user } = await seedUserWithWorkspace(`files-${Date.now()}@x.tld`);
  vi.mocked(getSession).mockResolvedValue({
    id: user.id,
    email: user.email,
    displayName: user.displayName,
    currentWorkspaceId: null,
    isService: false,
  });

  const dir = uploadsDir();
  await fs.mkdir(dir, { recursive: true });
  nomSvg = `test-${Date.now()}.svg`;
  nomPng = `test-${Date.now()}.png`;
  await fs.writeFile(path.join(dir, nomSvg), SVG_PIEGE);
  await fs.writeFile(path.join(dir, nomPng), Buffer.from([0x89, 0x50, 0x4e, 0x47]));
});

afterAll(async () => {
  const dir = uploadsDir();
  await fs.unlink(path.join(dir, nomSvg)).catch(() => {});
  await fs.unlink(path.join(dir, nomPng)).catch(() => {});
  await prisma.$disconnect();
});

describe("fileResponseHeaders — logique pure", () => {
  it("⚠️ pose la CSP sur TOUS les types, pas seulement les suspects", () => {
    // Une allowlist de types « dangereux » se périme au premier type ajouté.
    for (const nom of ["a.svg", "a.png", "a.jpg", "a.gif", "a.webp", "a.pdf", "a.xyz"]) {
      expect(fileResponseHeaders(nom)["Content-Security-Policy"]).toBe(FILE_CSP);
    }
  });

  it("⚠️ la CSP retire les scripts ET l'origine", () => {
    // `sandbox` sans jeton rend le document opaque : même si un script passait,
    // il n'aurait accès ni aux cookies ni au stockage de l'application.
    expect(FILE_CSP).toContain("sandbox");
    expect(FILE_CSP).toContain("default-src 'none'");
  });

  it("les images restent AFFICHABLES : pas de Content-Disposition", () => {
    // Sinon on casserait toutes les captures déjà collées dans l'éditeur.
    for (const nom of ["a.png", "a.jpg", "a.gif", "a.webp", "a.svg"]) {
      expect(fileResponseHeaders(nom)["Content-Disposition"]).toBeUndefined();
    }
  });

  it("tout type inconnu est TÉLÉCHARGÉ, jamais rendu", () => {
    // Le jour où la liste des types téléversables s'élargit, le défaut est sûr.
    const h = fileResponseHeaders("contrat.pdf");
    expect(h["Content-Type"]).toBe("application/octet-stream");
    expect(h["Content-Disposition"]).toBe('attachment; filename="contrat.pdf"');
  });

  it("interdit l'embarquement depuis un autre site", () => {
    expect(fileResponseHeaders("a.png")["Cross-Origin-Resource-Policy"]).toBe("same-origin");
  });
});

describe("GET /api/files/[name] — la réponse réelle", () => {
  it("⚠️ un SVG porteur de script est neutralisé par la CSP", async () => {
    const res = await get(nomSvg);
    expect(res.status).toBe(200);
    // Le type reste image/svg+xml — c'est ce qui permet à <img> de l'afficher ;
    // ce n'est PAS lui qui protège.
    expect(res.headers.get("content-type")).toBe("image/svg+xml");
    expect(res.headers.get("content-security-policy")).toBe(FILE_CSP);
    // Le contenu est bien servi tel quel : la garde est l'en-tête, pas un filtrage.
    expect(await res.text()).toContain("<script>");
  });

  it("une image ordinaire est servie inline, avec la CSP", async () => {
    const res = await get(nomPng);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/png");
    expect(res.headers.get("content-disposition")).toBeNull();
    expect(res.headers.get("content-security-policy")).toBe(FILE_CSP);
  });

  it("la garde anti-traversée tient toujours", async () => {
    expect((await get("../../etc/passwd")).status).toBe(400);
    expect((await get("sans-extension")).status).toBe(400);
  });

  it("un fichier absent rend 404, pas 500", async () => {
    expect((await get("inexistant-00000000.png")).status).toBe(404);
  });
});
