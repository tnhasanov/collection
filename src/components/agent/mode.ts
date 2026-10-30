import type { AgentContext } from "@/components/agent/types";
import type { Mode } from "@/components/agent/CallHeader";

/** Workspace mode from provider-confirmed state (shared by the call workspace and the dashboard). */
export function modeOf(ctx: AgentContext): Mode {
  const session = ctx.session;
  const reservation = ctx.reservation;
  const interaction = ctx.interaction;
  if (!session || !session.id) return "connect";
  if (interaction?.status === "OPEN") return "live";
  if (interaction?.status === "DRAFT") return "acw";
  if (interaction && (interaction.wrapUpStatus === "PENDING" || interaction.wrapUpStatus === "FAILED")) return "wrapup";
  if (reservation && ["PENDING", "AUTHORIZED", "DIALING"].includes(reservation.status)) return ctx.customer ? "dialing" : "recovery";
  return "home";
}
