import { redirect } from "next/navigation";
import { appMode, getSessionUser, isDemoMode } from "@/server/auth/session";
import { prisma } from "@/server/db";
import { Sidebar } from "@/components/shell/Sidebar";
import { Topbar } from "@/components/shell/Topbar";
import { navForRole } from "@/components/shell/nav";
import { ROLE_LABELS } from "@/server/auth/permissions";
import { businessDate, now } from "@/server/clock";
import { formatDate, formatBakuTime } from "@/server/dates";

export const dynamic = "force-dynamic";

export default async function ShellLayout({ children }: { children: React.ReactNode }) {
  const user = await getSessionUser();
  if (!user) redirect("/login?reason=session");
  if (user.mustChangePassword) redirect("/account/password");
  const mode = appMode();
  const [bd, current, feed, unread, worker, demoUsers] = await Promise.all([
    businessDate(),
    now(),
    prisma.sourceWatermark.findUnique({ where: { sourceSystem: "PAYMENT_FEED" } }),
    prisma.notification.count({ where: { userId: user.id, readAt: null } }),
    prisma.workerHeartbeat.findFirst({ orderBy: { lastSeenAt: "desc" } }),
    isDemoMode() ? prisma.user.findMany({ where: { isActive: true, isServiceAccount: false }, orderBy: { role: "asc" }, select: { username: true, displayName: true, role: true } }) : Promise.resolve([]),
  ]);
  const lagMin = feed?.sourceAsOf ? Math.round((current.getTime() - feed.sourceAsOf.getTime()) / 60_000) : null;
  const freshness = !feed || feed.health === "DISABLED" ? { label: "Source: n/a", tone: "warning" as const } : lagMin !== null && lagMin > (feed.freshnessThresholdSeconds / 60) ? { label: `Source stale (${lagMin} min)`, tone: "danger" as const } : { label: `Source refreshed ${formatBakuTime(feed.sourceAsOf)}`, tone: "success" as const };
  const wallClock = new Date();
  const workerOnline = !!worker && wallClock.getTime() - worker.lastSeenAt.getTime() < 60_000;
  return (
    <div className="flex min-h-screen">
      <Sidebar groups={navForRole(user.role)} locale="en" />
      <div className="flex min-w-0 flex-1 flex-col">
        <Topbar locale="en" user={{ displayName: user.displayName, roleLabel: ROLE_LABELS[user.role], username: user.username }} mode={mode} businessDate={formatDate(bd)} freshness={freshness} notifications={unread} demoUsers={demoUsers.map((u) => ({ username: u.username, label: `${u.displayName} · ${ROLE_LABELS[u.role]}` }))} workerOnline={workerOnline} />
        <main className="flex-1 px-4 py-4 lg:px-6">{children}</main>
        <footer className="px-4 py-3 text-[11px] text-muted lg:px-6">ATB Collections · synthetic demo data · Asia/Baku · AZN · brand source atb.az/media</footer>
      </div>
    </div>
  );
}
