import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import { legacyLoginEnabled } from "@/lib/oidc";
import RegisterForm from "./RegisterForm";

export default async function RegisterPage() {
  // Inscription désactivée en mode « comptes GotYeah uniquement ».
  if (!legacyLoginEnabled()) redirect("/login");
  const user = await getSession();
  if (user) redirect("/");
  return <RegisterForm />;
}
