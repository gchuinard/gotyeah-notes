import { test, expect, type Page } from "@playwright/test";

// Ticket : deux barres de défilement verticales côte à côte sur une page database.
//
// Cause : le <main> de AppShell empilait le Header (h-14 = 56px) et le contenu en FLUX.
// Un enfant en `h-full` réclamait donc 100% de <main> SANS déduire le Header → <main>
// débordait de 56px exactement → une 2e barre parasite, permanente, dont toute la course
// valait la hauteur de l'en-tête.
//
// Le défaut n'est pas propre aux databases : il touche TOUTE page dont la racine porte
// `h-full` — aujourd'hui DatabaseShell, SettingsPage et l'écran d'accueil.
//
// ⚠️ Ces tests doivent attendre `main > header` avant de mesurer : tant que
// WorkspaceContext charge, AppShell rend une coquille SANS Header, donc sans le
// débordement de 56px. Mesurer trop tôt rend le test vert et vide de sens.

async function register(page: Page, tag: string) {
  const email = `${tag}-${Date.now()}@x.tld`;
  const reg = await page.request.post("/api/auth/register", {
    data: { firstName: "S", lastName: "C", displayName: "SC", email, password: "Test1234!" },
  });
  expect(reg.ok()).toBeTruthy();
  const workspaces = await (await page.request.get("/api/workspaces")).json();
  return workspaces[0].id as string;
}

/** Une database avec assez de lignes pour déborder verticalement, quelle que soit la fenêtre. */
async function seedTallDatabase(page: Page, tag: string) {
  const workspaceId = await register(page, tag);
  const pg = await (
    await page.request.post("/api/pages", { data: { workspaceId, title: "📋 Tâches" } })
  ).json();
  const db = await (await page.request.post("/api/databases", { data: { pageId: pg.id } })).json();
  for (let i = 0; i < 40; i++) {
    await page.request.post(`/api/databases/${db.id}/records`, {
      data: { title: `Tâche ${i + 1}` },
    });
  }
  return { pageId: pg.id as string };
}

/** La coquille est montée (Header rendu) → l'état mesuré est l'état stable. */
async function waitForShell(page: Page) {
  await expect(page.locator("main > header")).toBeVisible();
}

/**
 * Conteneurs qui défilent VERTICALEMENT pour de vrai, dans la zone de contenu.
 *
 * Scopé au <main> de AppShell (lui INCLUS : c'est lui qui portait la barre parasite) pour
 * ne pas compter la Sidebar, qui a son propre défilement légitime. `shellScrolls` isole le
 * cas du <main> de la coquille, seul symptôme du bug.
 */
async function measure(page: Page) {
  return page.evaluate(() => {
    const shell = document.querySelector("main");
    if (!shell) return { shellScrolls: false, scrollers: [] };
    const scrolls = (el: HTMLElement) => {
      const o = getComputedStyle(el).overflowY;
      // Marge de 1px : un sous-pixel de différence n'affiche pas de barre.
      return (o === "auto" || o === "scroll") && el.scrollHeight - el.clientHeight > 1;
    };
    const all = [shell, ...Array.from(shell.querySelectorAll<HTMLElement>("*"))].filter(scrolls);
    return {
      shellScrolls: all.includes(shell),
      scrollers: all.map((el) => ({
        tag: el.tagName.toLowerCase(),
        classes: el.className,
        overflowPx: el.scrollHeight - el.clientHeight,
      })),
    };
  });
}

test("une page database n'a qu'une seule barre de défilement verticale", async ({ page }) => {
  const { pageId } = await seedTallDatabase(page, "scroll-db");

  await page.goto(`/pages/${pageId}`);
  await waitForShell(page);
  await expect(page.getByText("Tâche 1", { exact: true })).toBeVisible();

  const { shellScrolls, scrollers } = await measure(page);
  expect(scrollers, JSON.stringify(scrollers, null, 2)).toHaveLength(1);
  expect(shellScrolls, "la coquille ne doit pas défiler par-dessus la vue").toBe(false);
});

test("une page éditeur défile dans <main>, sous le Header sticky", async ({ page }) => {
  // Contre-épreuve. Le scroller doit rester <main> LUI-MÊME : le Header est `sticky`
  // par-dessus, avec un fond translucide (.app-header-bg) + backdrop-blur qui n'a d'effet
  // que si le contenu passe derrière. Sortir le contenu de <main> tuerait l'effet en silence.
  const workspaceId = await register(page, "scroll-editor");
  const long = Array.from({ length: 60 }, (_, i) => ({
    type: "paragraph",
    content: [{ type: "text", text: `Paragraphe ${i + 1}`, styles: {} }],
  }));
  const pg = await (
    await page.request.post("/api/pages", { data: { workspaceId, title: "Page longue" } })
  ).json();
  await page.request.patch(`/api/pages/${pg.id}`, { data: { content: JSON.stringify(long) } });

  await page.goto(`/pages/${pg.id}`);
  await waitForShell(page);
  await expect(page.getByText("Paragraphe 1", { exact: true })).toBeVisible();

  const { shellScrolls, scrollers } = await measure(page);
  expect(scrollers, JSON.stringify(scrollers, null, 2)).toHaveLength(1);
  expect(shellScrolls, "le contenu doit défiler DANS <main>, derrière le Header sticky").toBe(true);
});

test("les réglages : la coquille ne défile pas", async ({ page }) => {
  // SettingsPage porte le même motif que DatabaseShell (racine `h-full` + scroller interne)
  // et souffrait donc de la même barre parasite, sans que ça ait jamais été signalé.
  await register(page, "scroll-settings");

  await page.goto("/settings");
  await waitForShell(page);
  await expect(page.getByRole("heading", { name: /profil/i })).toBeVisible();

  const { shellScrolls, scrollers } = await measure(page);
  expect(shellScrolls, `barre parasite sur la coquille :\n${JSON.stringify(scrollers, null, 2)}`)
    .toBe(false);
});

test("l'écran d'accueil n'a aucune barre de défilement", async ({ page }) => {
  // Sa racine est `h-full` et son contenu tient dans l'écran : rien ne doit défiler.
  await register(page, "scroll-home");

  await page.goto("/");
  await waitForShell(page);
  await expect(page.getByText("👋")).toBeVisible();

  const { scrollers } = await measure(page);
  expect(scrollers, JSON.stringify(scrollers, null, 2)).toHaveLength(0);
});
