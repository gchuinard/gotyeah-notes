import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import LoginForm from "./LoginForm";

export default async function LoginPage() {
  const user = await getSession();
  if (user) redirect("/");
  return <LoginForm />;
}
