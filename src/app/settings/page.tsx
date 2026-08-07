import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import { accountConsoleUrl } from "@/lib/oidc";
import SettingsPage from "./SettingsPage";

export default async function Settings() {
  const user = await getSession();
  if (!user) redirect("/login");
  // Résolue AU SSR : `SettingsPage` est un composant client et `OIDC_ISSUER`
  // n'est pas préfixée NEXT_PUBLIC_, donc illisible côté navigateur. Une prop
  // évite d'inventer une route /api/me pour une seule chaîne de caractères.
  return <SettingsPage user={user} accountUrl={accountConsoleUrl()} />;
}
