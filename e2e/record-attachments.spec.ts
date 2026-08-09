import { test, expect, type Page } from "@playwright/test";

// Pièces jointes d'une carte, de bout en bout dans le navigateur.

async function seed(page: Page, tag: string) {
  const email = `${tag}-${Date.now()}@x.tld`;
  const reg = await page.request.post("/api/auth/register", {
    data: { firstName: "A", lastName: "T", displayName: "AT", email, password: "Test1234!" },
  });
  expect(reg.ok()).toBeTruthy();
  const workspaces = await (await page.request.get("/api/workspaces")).json();
  const workspaceId = workspaces[0].id as string;

  const pg = await (
    await page.request.post("/api/pages", { data: { workspaceId, title: `Board ${tag}` } })
  ).json();
  const db = await (await page.request.post("/api/databases", { data: { pageId: pg.id } })).json();
  const rec = await (
    await page.request.post(`/api/databases/${db.id}/records`, { data: { title: "Carte doc" } })
  ).json();
  return { pageId: pg.id as string, recordId: rec.id as string };
}

/** Ouvre la carte par lien profond — évite de dépendre du rendu de la table. */
const ouvrirCarte = async (page: Page, pageId: string, recordId: string) => {
  await page.goto(`/pages/${pageId}?r=${recordId}`);
  await expect(page.getByText("Documents")).toBeVisible();
};

test("déposer un document, le voir listé, puis le retirer", async ({ page }) => {
  const { pageId, recordId } = await seed(page, "att");
  await ouvrirCarte(page, pageId, recordId);

  await expect(page.getByText("Aucun document.")).toBeVisible();

  await page.setInputFiles('input[type="file"]', {
    name: "Contrat 2026.pdf",
    mimeType: "application/pdf",
    buffer: Buffer.from("%PDF-1.4 faux contenu"),
  });

  // Le nom d'ORIGINE est affiché — le disque ne connaît qu'un UUID.
  await expect(page.getByText("Contrat 2026.pdf")).toBeVisible();
  await expect(page.getByText("Documents (1)")).toBeVisible();
  await expect(page.getByText("Aucun document.")).toBeHidden();

  // Retrait : la modale doit dire que c'est définitif — il n'y a pas de corbeille.
  await page.getByTitle("Retirer").click();
  const modale = page.getByRole("dialog");
  await expect(modale).toBeVisible();
  await expect(modale.getByText(/définitif/i)).toBeVisible();
  await modale.getByRole("button", { name: "Retirer" }).click();

  await expect(page.getByText("Aucun document.")).toBeVisible();
});

test("⚠️ un type refusé affiche le message du serveur, sans rien casser", async ({ page }) => {
  const { pageId, recordId } = await seed(page, "att-type");
  await ouvrirCarte(page, pageId, recordId);

  // Un SVG est refusé ici À DESSEIN : il reste collable dans l'éditeur (où il
  // est servi avec une CSP), mais pas déposable en pièce jointe.
  await page.setInputFiles('input[type="file"]', {
    name: "malin.svg",
    mimeType: "image/svg+xml",
    buffer: Buffer.from("<svg xmlns='http://www.w3.org/2000/svg'></svg>"),
  });

  await expect(page.getByText(/Type non supporté/)).toBeVisible();
  await expect(page.getByText("Aucun document.")).toBeVisible();
});
