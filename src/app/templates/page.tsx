import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import TemplatesManager from "@/components/templates/TemplatesManager";

export default async function TemplatesPage() {
  const user = await getSession();
  if (!user) redirect("/login");
  return <TemplatesManager />;
}
