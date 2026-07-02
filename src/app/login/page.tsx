import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import { oidcEnabled, OIDC_BUTTON_LABEL } from "@/lib/oidc";
import LoginForm from "./LoginForm";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ sso_error?: string }>;
}) {
  const user = await getSession();
  if (user) redirect("/");
  const { sso_error } = await searchParams;
  return (
    <LoginForm
      oidcEnabled={oidcEnabled()}
      oidcLabel={OIDC_BUTTON_LABEL}
      ssoError={sso_error}
    />
  );
}
