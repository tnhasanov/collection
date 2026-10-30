import Link from "next/link";
import { EmptyState } from "@/components/ui";
import { PageHeader } from "@/components/ui/PageHeader";
import { prisma } from "@/server/db";
import { loadAgentPage } from "../loader";
import { agentFollowUps, type FollowUpKind } from "@/server/modules/agent/followUpService";
import { at } from "@/i18n/agentText";
import { FollowUpHead, FollowUpRow } from "@/components/agent/FollowUpParts";

export const dynamic = "force-dynamic";

const FILTERS: { key: string; kind: FollowUpKind | null; label: string }[] = [
  { key: "all", kind: null, label: "fu.all" },
  { key: "callbacks", kind: "CALLBACK", label: "fu.callbacks" },
  { key: "promises", kind: "PROMISE", label: "fu.promises" },
  { key: "tasks", kind: "TASK", label: "fu.tasks" },
  { key: "failed", kind: "FAILED", label: "fu.failed" },
];

/**
 * Follow-ups: callbacks, promises, tasks and failed contacts together, overdue and due-today first. Every voice item is
 * evaluated against the contact policy at the current business clock and shows either that it is callable or the
 * restriction that applies now and when it ends. Nothing here dials or bypasses the policy.
 */
export default async function AgentFollowUpsPage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const { user, now, locale } = await loadAgentPage();
  const { tab = "all" } = await searchParams;
  const A = (k: string, v?: Record<string, string | number | null>) => at(locale, k, v);
  const items = await agentFollowUps(prisma, user.id, now);
  const filter = FILTERS.find((f) => f.key === tab) ?? FILTERS[0];
  const shown = filter.kind ? items.filter((i) => i.kind === filter.kind) : items;
  return (
    <>
      <PageHeader kicker={A("dash.title")} title={A("fu.title")} lead={A("fu.lead")} />
      <nav className="mb-3 flex flex-wrap gap-2" aria-label={A("fu.title")}>
        {FILTERS.map((f) => {
          const n = f.kind ? items.filter((i) => i.kind === f.kind).length : items.length;
          return (
            <Link key={f.key} href={`/agent/follow-ups?tab=${f.key}`} className="chip" aria-pressed={filter.key === f.key} aria-current={filter.key === f.key ? "page" : undefined} data-testid={`fu-filter-${f.key}`}>
              {A(f.label)}
              <span className="ml-1 text-muted">({n})</span>
            </Link>
          );
        })}
      </nav>
      {shown.length === 0 ? (
        <div className="panel p-4">
          <EmptyState title={A("fu.empty")} />
        </div>
      ) : (
        <ul className="panel divide-y divide-line" data-testid="follow-up-list">
          <FollowUpHead locale={locale} />
          {shown.map((item) => (
            <FollowUpRow key={item.key} item={item} locale={locale} />
          ))}
        </ul>
      )}
    </>
  );
}
