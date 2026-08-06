import { test, expect, type Page } from "@playwright/test";
import { register } from "./helpers/auth";

// Lot B — deux acquis à prouver EN VRAI, parce qu'aucun test unitaire ne peut le faire :
//  1. une UNIQUE vue filtrée « Moi » montre à chacun SES cartes (View.config est partagé) ;
//  2. un kanban peut être regroupé par assigné, colonnes = membres de l'espace.
// Deux contextes navigateur = deux sessions (cookies isolés, workers: 1).

test("vue partagée filtrée « Moi » : chacun voit ses cartes ; kanban regroupé par assigné", async ({
  page,
  browser,
}) => {
  const a = await register(page, "mefilter-a", "Alice Assignée");
  const ctxB = await browser.newContext();
  const pageB = await ctxB.newPage();
  const b = await register(pageB, "mefilter-b", "Bob Assigné");

  // B rejoint l'espace de A en éditeur, puis bascule dessus.
  const added = await page.request.post(`/api/workspaces/${a.workspaceId}/members`, {
    data: { email: b.email, role: "editor" },
  });
  expect(added.ok()).toBeTruthy();
  const bUserId = (await added.json()).userId as string;
  expect(bUserId).toBeTruthy();
  expect((await pageB.request.post(`/api/workspaces/${a.workspaceId}/switch`)).ok()).toBeTruthy();

  // Database + colonne « Assigné » + une carte pour chacun.
  // ⚠️ Dans la section d'ÉQUIPE : une page privée n'est lisible que par son
  // ownerId, même pour un autre membre — B tomberait sur un 404.
  const sections = await (
    await page.request.get(`/api/sections?workspaceId=${a.workspaceId}`)
  ).json();
  const teamSection = sections.find((s: { type: string }) => s.type === "team");
  expect(teamSection).toBeTruthy();

  const pg = await (
    await page.request.post("/api/pages", {
      data: { workspaceId: a.workspaceId, title: "Board Moi", sectionId: teamSection.id },
    })
  ).json();
  const db = await (await page.request.post("/api/databases", { data: { pageId: pg.id } })).json();
  const prop = await (
    await page.request.post(`/api/databases/${db.id}/properties`, {
      data: { name: "Assigné", type: "user" },
    })
  ).json();

  const me = await (await page.request.get("/api/workspaces")).json();
  expect(me.length).toBeGreaterThan(0);
  const members = await (
    await page.request.get(`/api/workspaces/${a.workspaceId}/members`)
  ).json();
  const aUserId = members.find((m: { displayName: string }) => m.displayName === "Alice Assignée")
    .userId as string;

  await page.request.post(`/api/databases/${db.id}/records`, {
    data: { title: "Carte Alice", properties: { [prop.id]: [aUserId] } },
  });
  await page.request.post(`/api/databases/${db.id}/records`, {
    data: { title: "Carte Bob", properties: { [prop.id]: [bUserId] } },
  });

  // ── Une SEULE vue, filtrée sur le jeton « Moi » ────────────────────────────
  const views = (await (await page.request.get(`/api/databases/${db.id}`)).json()).views;
  const view = views[0];
  const patched = await page.request.patch(`/api/views/${view.id}`, {
    data: {
      config: { filters: [{ propertyId: prop.id, operator: "contains", value: "@me" }] },
    },
  });
  expect(patched.ok()).toBeTruthy();

  // A ne voit que la sienne…
  await page.goto(`/pages/${pg.id}`);
  await expect(page.getByText("Carte Alice")).toBeVisible();
  await expect(page.getByText("Carte Bob")).toHaveCount(0);

  // …et B, sur la MÊME vue, ne voit que la sienne.
  await pageB.goto(`/pages/${pg.id}`);
  await expect(pageB.getByText("Carte Bob")).toBeVisible();
  await expect(pageB.getByText("Carte Alice")).toHaveCount(0);

  // ── Kanban regroupé par assigné : les colonnes sont les MEMBRES ────────────
  const kanban = await (
    await page.request.post(`/api/databases/${db.id}/views`, {
      data: {
        name: "Par assigné",
        type: "kanban",
        config: { groupByPropertyId: prop.id },
      },
    })
  ).json();
  expect(kanban.id).toBeTruthy();

  await page.goto(`/pages/${pg.id}?v=${kanban.id}`);
  await expect(page.getByText("Sans valeur")).toBeVisible();
  await expect(page.getByText("Alice Assignée").first()).toBeVisible();
  await expect(page.getByText("Bob Assigné").first()).toBeVisible();
  // Le board n'est pas filtré : les deux cartes y sont, chacune dans sa colonne.
  await expect(page.getByText("Carte Alice")).toBeVisible();
  await expect(page.getByText("Carte Bob")).toBeVisible();

  await ctxB.close();
});

/** La colonne entière (en-tête + zone droppable), repérée par son libellé. */
const column = (page: Page, label: string) =>
  page.locator("[data-kanban-column]").filter({ hasText: label });

/** Drag dnd-kit : dépasser l'activationConstraint (6 px) puis viser la colonne cible. */
async function dragTo(page: Page, card: ReturnType<Page["locator"]>, targetLabel: string) {
  const cb = (await card.boundingBox())!;
  const tb = (await column(page, targetLabel).boundingBox())!;
  await page.mouse.move(cb.x + cb.width / 2, cb.y + cb.height / 2);
  await page.mouse.down();
  await page.mouse.move(cb.x + cb.width / 2 + 12, cb.y + cb.height / 2 + 12, { steps: 5 });
  await page.mouse.move(tb.x + tb.width / 2, tb.y + tb.height / 2 + 40, { steps: 12 });
  await page.mouse.up();
}

// La colonne « Membre retiré » n'a d'intérêt que si l'on peut en SORTIR : le
// serveur refuse (400) tout tableau d'assignés contenant un non-membre, et le
// drop réémet le tableau entier. Sans nettoyage, la carte serait piégée.
test("carte d'un membre parti : visible dans « Membre retiré », et réattribuable par glisser-déposer", async ({
  page,
  browser,
}) => {
  const a = await register(page, "orphan-a", "Alice Reste");
  const ctxB = await browser.newContext();
  const pageB = await ctxB.newPage();
  const b = await register(pageB, "orphan-b", "Bob Part");
  await ctxB.close();

  const added = await page.request.post(`/api/workspaces/${a.workspaceId}/members`, {
    data: { email: b.email, role: "editor" },
  });
  expect(added.ok()).toBeTruthy();
  const bUserId = (await added.json()).userId as string;

  const pg = await (
    await page.request.post("/api/pages", { data: { workspaceId: a.workspaceId, title: "Board orphelin" } })
  ).json();
  const db = await (await page.request.post("/api/databases", { data: { pageId: pg.id } })).json();
  const prop = await (
    await page.request.post(`/api/databases/${db.id}/properties`, {
      data: { name: "Assigné", type: "user" },
    })
  ).json();
  const card = await (
    await page.request.post(`/api/databases/${db.id}/records`, {
      data: { title: "Ticket orphelin", properties: { [prop.id]: [bUserId] } },
    })
  ).json();

  const kanban = await (
    await page.request.post(`/api/databases/${db.id}/views`, {
      data: { name: "Par assigné", type: "kanban", config: { groupByPropertyId: prop.id } },
    })
  ).json();

  // Bob quitte l'espace : son id survit dans la carte, sans plus aucune colonne.
  const removed = await page.request.delete(
    `/api/workspaces/${a.workspaceId}/members/${bUserId}`
  );
  expect(removed.ok()).toBeTruthy();

  await page.goto(`/pages/${pg.id}?v=${kanban.id}`);
  await expect(page.getByText("Membre retiré").first()).toBeVisible();
  await expect(column(page, "Membre retiré").getByText("Ticket orphelin")).toBeVisible();

  // Glisser vers Alice : le PATCH doit PASSER (l'id mort est lâché), sinon 400.
  const patched = page.waitForResponse(
    (r) => r.url().includes(`/api/records/${card.id}`) && r.request().method() === "PATCH"
  );
  await dragTo(page, column(page, "Membre retiré").getByText("Ticket orphelin"), "Alice Reste");
  expect((await patched).status()).toBe(200);

  const after = await (await page.request.get(`/api/databases/${db.id}/records`)).json();
  const members = await (await page.request.get(`/api/workspaces/${a.workspaceId}/members`)).json();
  const aUserId = members[0].userId as string;
  expect(after[0].properties[prop.id]).toEqual([aUserId]);

  // Et la colonne orpheline disparaît d'elle-même : plus aucun lien mort.
  await page.reload();
  await expect(column(page, "Alice Reste").getByText("Ticket orphelin")).toBeVisible();
  await expect(page.getByText("Membre retiré")).toHaveCount(0);
});
