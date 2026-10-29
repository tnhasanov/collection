import { redirect } from "next/navigation";

/** Folded into the compact follow-up view. */
export default function Page() {
  redirect("/agent/follow-ups?tab=callbacks");
}
