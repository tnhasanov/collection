"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Badge, cx } from "@/components/ui";
import { t, type Locale } from "@/i18n/dictionaries";

export interface TopbarProps {
  locale: Locale;
  user: { displayName: string; roleLabel: string; username: string };
  mode: "DEMO" | "PILOT" | "INTEGRATION";
  businessDate: string;
  freshness: { label: string; tone: "success" | "warning" | "danger" };
  notifications: number;
  demoUsers: { username: string; label: string }[];
  workerOnline: boolean;
}

export function Topbar(p: TopbarProps) {
  const router = useRouter();
  const [q, setQ] = useState("");
  const [menu, setMenu] = useState(false);
  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" });
    router.replace("/login");
    router.refresh();
  }
  async function switchRole(username: string) {
    const res = await fetch("/api/auth/switch-role", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ username }) });
    const json = await res.json();
    if (json.ok) {
      router.replace(json.data.landing);
      router.refresh();
    }
  }
  return (
    <header className="sticky top-0 z-20 flex flex-wrap items-center gap-3 border-b border-line bg-surface px-4 py-2 lg:px-6">
      <form
        role="search"
        className="min-w-[200px] flex-1 lg:max-w-md"
        onSubmit={(e) => {
          e.preventDefault();
          if (q.trim()) router.push(`/customers?q=${encodeURIComponent(q.trim())}`);
        }}
      >
        <label htmlFor="global-search" className="sr-only">
          {t(p.locale, "topbar.search")}
        </label>
        <input id="global-search" className="input" placeholder={t(p.locale, "topbar.search")} value={q} onChange={(e) => setQ(e.target.value)} />
      </form>
      <Badge tone={p.mode === "DEMO" ? "warning" : p.mode === "PILOT" ? "brand" : "info"} title={p.mode === "PILOT" ? "Synthetic data, mock integrations, individual tester identities" : undefined}>{t(p.locale, p.mode === "DEMO" ? "topbar.demo" : p.mode === "PILOT" ? "topbar.pilot" : "topbar.integration")}</Badge>
      <span className="text-xs text-muted">
        {t(p.locale, "topbar.businessDate")}: <span className="font-medium text-ink">{p.businessDate}</span>
      </span>
      <Badge tone={p.freshness.tone} title="Freshness of the core/payment projections">
        {p.freshness.label}
      </Badge>
      {!p.workerOnline && (
        <Badge tone="danger" title="Background worker heartbeat not seen recently; run `npm run worker`">
          Worker offline
        </Badge>
      )}
      <span className="ml-auto text-xs text-muted" aria-label="Notifications">
        🔔 {p.notifications}
      </span>
      <div className="relative">
        <button type="button" className="btn btn-ghost btn-sm" aria-haspopup="menu" aria-expanded={menu} onClick={() => setMenu((m) => !m)}>
          <span className="font-semibold text-ink">{p.user.displayName}</span>
          <span className="text-xs text-muted">{p.user.roleLabel}</span>
        </button>
        {menu && (
          <div role="menu" className={cx("absolute right-0 mt-1 w-72 rounded-md border border-line bg-surface p-2 shadow-lg")}>
            {p.mode === "DEMO" && p.demoUsers.length > 0 && (
              <div className="mb-2 border-b border-line pb-2">
                <p className="mb-1 px-2 text-[11px] font-bold uppercase tracking-wider text-muted">Demo role switch (audited)</p>
                <ul className="max-h-60 overflow-auto">
                  {p.demoUsers.map((u) => (
                    <li key={u.username}>
                      <button type="button" role="menuitem" className="w-full rounded px-2 py-1 text-left text-sm hover:bg-brand-light" onClick={() => switchRole(u.username)}>
                        {u.label}
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {p.mode !== "INTEGRATION" && (
              <a role="menuitem" href="/account/password" className="block w-full rounded px-2 py-1 text-left text-sm hover:bg-brand-light">
                Change password
              </a>
            )}
            <button type="button" role="menuitem" className="w-full rounded px-2 py-1 text-left text-sm hover:bg-brand-light" onClick={logout}>
              {t(p.locale, "topbar.signOut")}
            </button>
          </div>
        )}
      </div>
    </header>
  );
}
