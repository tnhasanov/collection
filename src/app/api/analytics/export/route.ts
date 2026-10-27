import { z } from "zod";
import { prisma } from "@/server/db";
import { route, parseQuery } from "@/server/http";
import { requireUser } from "@/server/auth/session";
import { now } from "@/server/clock";
import { appendAudit } from "@/server/modules/audit/audit";
import { analyticsTab, ANALYTICS_TABS, toCsv, type AnalyticsTab } from "@/server/modules/analytics/analyticsService";

const schema = z.object({ tab: z.enum(ANALYTICS_TABS.map((t) => t.key) as [AnalyticsTab, ...AnalyticsTab[]]), from: z.string().optional(), to: z.string().optional(), branch: z.string().optional(), segment: z.string().optional(), riskClass: z.coerce.number().int().optional(), bucket: z.coerce.number().int().optional(), owner: z.string().optional(), strategyVersionId: z.string().optional(), arm: z.string().optional() });

/** CSV export with as-of timestamp and metric definition versions (audited; scoped by permission). */
export const GET = route(async (req) => {
  const user = await requireUser("export.scoped");
  const q = parseQuery(req, schema);
  const t = await now();
  const result = await analyticsTab(prisma, q.tab, q, t);
  await appendAudit(prisma, { actorUserId: user.id, action: "analytics.exported", objectType: "Analytics", objectId: q.tab, changes: { filters: q, rows: result.rows.length, asOf: result.asOf } });
  return new Response(toCsv(result), { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="atb-analytics-${q.tab}-${result.asOf.slice(0, 10)}.csv"` } });
});
