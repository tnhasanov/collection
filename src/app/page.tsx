import { redirect } from "next/navigation";
import { getSessionUser } from "@/server/auth/session";
import { landingPathForRole } from "@/server/auth/permissions";

export default async function Home() {
  const user = await getSessionUser();
  redirect(user ? landingPathForRole(user.role) : "/login");
}
