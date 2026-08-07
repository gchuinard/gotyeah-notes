import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import { oidcEnabled, OIDC_BUTTON_LABEL, legacyLoginEnabled } from "@/lib/oidc";
import { magicLinkEnabled } from "@/lib/magicLink";
import LoginForm from "./LoginForm";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ sso_error?: string; magic_error?: string }>;
}) {
  const user = await getSession();
  if (user) redirect("/");
  const { sso_error, magic_error } = await searchParams;
  return (
    <LoginForm
      oidcEnabled={oidcEnabled()}
      oidcLabel={OIDC_BUTTON_LABEL}
      legacyLogin={legacyLoginEnabled()}
      magicLink={magicLinkEnabled()}
      ssoError={sso_error}
      magicError={magic_error}
    />
  );
}
