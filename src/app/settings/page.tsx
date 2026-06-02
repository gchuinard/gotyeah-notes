import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import SettingsPage from "./SettingsPage";

export default async function Settings() {
  const user = await getSession();
  if (!user) redirect("/login");
  return <SettingsPage user={user} />;
}
