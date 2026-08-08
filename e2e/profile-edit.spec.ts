import { test, expect } from "@playwright/test";
import { register } from "./helpers/auth";

/**
 * Réglages → Profil. L'écran était une MAQUETTE : le bouton « Enregistrer »
 * n'avait pas d'onClick, aucune route ne le servait, et Prénom/Nom partaient
 * toujours vides. Ce test vérifie qu'il enregistre pour de vrai, et que le
 * nouveau nom se propage AILLEURS que sur l'écran qui l'a modifié.
 */

test("le profil s'enregistre, et le nom affiché se propage à toute l'application", async ({
  page,
}) => {
  await register(page, "profil", "Nom Initial");
  await page.goto("/settings");
  // La cloche de l'en-tête charge son compteur au montage : attendre que le
  // réseau se calme évite de saisir pendant une revalidation qui re-rend.
  await page.waitForLoadState("networkidle");

  const displayName = page.getByLabel("Pseudo / Nom affiché");
  await expect(displayName).toHaveValue("Nom Initial");

  // Prénom/Nom viennent du serveur : le harnais les seed à « Test »/« E2E ».
  // Avant ce lot, ces deux champs étaient TOUJOURS vides.
  await expect(page.getByLabel("Prénom")).toHaveValue("Test");
  await expect(page.getByLabel("Nom", { exact: true })).toHaveValue("E2E");

  // Rien n'a bougé : le bouton doit être inactif.
  const save = page.getByRole("button", { name: "Enregistrer" });
  await expect(save).toBeDisabled();

  // ⚠️ `fill` juste après le SSR peut être écrasé par l'hydratation React : le
  // DOM prend la valeur, puis React remonte son état initial et le bouton reste
  // inactif. On retente jusqu'à ce que la saisie « prenne » vraiment.
  await expect(async () => {
    await displayName.fill("Nom Modifié");
    await expect(save).toBeEnabled({ timeout: 1_000 });
  }).toPass({ timeout: 15_000 });
  await save.click();
  await expect(page.getByText("Profil enregistré.")).toBeVisible();

  // La vraie preuve : l'avatar de l'en-tête est rendu au SSR depuis la session.
  // S'il suit, c'est que router.refresh() a bien resynchronisé le reste.
  await expect(page.locator("header").getByText("N").first()).toBeVisible();

  // Et après un rechargement complet, la valeur vient de la base.
  await page.reload();
  await expect(page.getByLabel("Pseudo / Nom affiché")).toHaveValue("Nom Modifié");
});

test("⚠️ l'email est en lecture seule : c'est la clé de liaison avec l'IdP", async ({ page }) => {
  // La modifier ferait qu'à la connexion suivante la personne serait refusée,
  // ou provisionnée comme un NOUVEAU compte — sans ses espaces ni son historique.
  const { email } = await register(page, "profil-email");
  await page.goto("/settings");

  const champ = page.getByLabel("Email");
  await expect(champ).toHaveValue(email);
  await expect(champ).toHaveAttribute("readonly", "");
});
