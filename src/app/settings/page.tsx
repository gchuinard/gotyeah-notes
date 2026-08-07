import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import { accountConsoleUrl } from "@/lib/oidc";
import { prisma } from "@/lib/prisma";
import SettingsPage from "./SettingsPage";

export default async function Settings() {
  const user = await getSession();
  if (!user) redirect("/login");

  // Prénom et nom sont lus ICI plutôt que d'élargir `SessionUser` : ils ne
  // servent qu'à cet écran, alors que le type de session est porté par toute
  // l'application et payé à chaque requête.
  const profile = await prisma.user.findUnique({
    where: { id: user.id },
    select: { firstName: true, lastName: true },
  });

  // Résolue AU SSR : `SettingsPage` est un composant client et `OIDC_ISSUER`
  // n'est pas préfixée NEXT_PUBLIC_, donc illisible côté navigateur.
  return (
    <SettingsPage
      user={user}
      accountUrl={accountConsoleUrl()}
      firstName={profile?.firstName ?? ""}
      lastName={profile?.lastName ?? ""}
    />
  );
}
