"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Badge, cx } from "@/components/ui";
import { LOCALE_COOKIE, SUPPORTED_LOCALES, t, type Locale } from "@/i18n/dictionaries";

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
  function setLocale(code: string) {
    document.cookie = `${LOCALE_COOKIE}=${code}; path=/; max-age=31536000; samesite=lax`;
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
  const initials = p.user.displayName.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]?.toUpperCase() ?? "").join("");
  return (
    <header className="z-20 flex h-14 shrink-0 items-center gap-4 border-b border-line bg-surface pr-4 pl-24 lg:sticky lg:top-0 lg:px-8">
      <form
        role="search"
        className="relative min-w-0 flex-1 lg:max-w-md"
        onSubmit={(e) => {
          e.preventDefault();
          if (q.trim()) router.push(`/customers?q=${encodeURIComponent(q.trim())}`);
        }}
      >
        <label htmlFor="global-search" className="sr-only">
          {t(p.locale, "topbar.search")}
        </label>
        <svg className="pointer-events-none absolute top-1/2 left-2.5 h-4 w-4 -translate-y-1/2 text-muted" viewBox="0 0 20 20" aria-hidden="true"><circle cx="8.5" cy="8.5" r="5.5" fill="none" stroke="currentColor" strokeWidth="1.7" /><path d="m13 13 4 4" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" /></svg>
        <input id="global-search" className="input !min-h-0 h-9 border-transparent bg-transparent pl-9 hover:border-line focus:border-line" placeholder={t(p.locale, "topbar.search")} value={q} onChange={(e) => setQ(e.target.value)} />
      </form>
      <div className="ml-auto flex shrink-0 items-center gap-3">
        <span className="hidden text-sm text-muted tabular-nums md:inline" title={t(p.locale, "topbar.businessDate")}>{p.businessDate}</span>
        <Badge tone={p.mode === "DEMO" ? "neutral" : p.mode === "PILOT" ? "brand" : "info"} title={p.mode === "PILOT" ? "Synthetic data, mock integrations, individual tester identities" : undefined}>{t(p.locale, p.mode === "DEMO" ? "topbar.demo" : p.mode === "PILOT" ? "topbar.pilot" : "topbar.integration")}</Badge>
        {p.freshness.tone !== "success" && (
          <Badge tone={p.freshness.tone} title="Freshness of the core/payment projections">
            {p.freshness.label}
          </Badge>
        )}
        {!p.workerOnline && (
          <Badge tone="danger" title="Background worker heartbeat not seen recently">
            {t(p.locale, "topbar.workerOffline")}
          </Badge>
        )}
        <span className="relative inline-flex h-9 w-9 items-center justify-center text-muted" aria-label={`${t(p.locale, "topbar.notifications")}: ${p.notifications}`} title={`${p.notifications}`}>
          <svg className="h-[18px] w-[18px]" viewBox="0 0 20 20" aria-hidden="true"><path d="M5 8a5 5 0 0 1 10 0c0 4 1.5 5.5 1.5 5.5h-13S5 12 5 8M8.3 16.5a1.8 1.8 0 0 0 3.4 0" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" /></svg>
          {p.notifications > 0 && <span className="absolute top-1 right-1 h-2 w-2 rounded-full bg-brand" aria-hidden="true" />}
        </span>
        <div className="relative">
          <button type="button" className="inline-flex h-9 w-9 items-center justify-center rounded-full bg-brand-light text-xs font-medium text-brand" aria-haspopup="menu" aria-expanded={menu} aria-label={`${p.user.displayName} · ${p.user.roleLabel}`} title={`${p.user.displayName} · ${p.user.roleLabel}`} onClick={() => setMenu((m) => !m)} data-testid="user-menu">
            {initials}
          </button>
          {menu && (
            <div role="menu" className={cx("absolute right-0 z-40 mt-2 w-72 rounded-lg border border-line bg-surface p-2 shadow-lg")}>
              <div className="border-b border-line px-2 pt-1 pb-2">
                <p className="text-sm font-medium text-ink">{p.user.displayName}</p>
                <p className="text-xs text-muted">{p.user.roleLabel}</p>
              </div>
              <label className="mt-2 block px-2 text-xs text-muted" htmlFor="ui-locale">
                {t(p.locale, "topbar.language")}
              </label>
              <select id="ui-locale" className="select mx-2 mt-1 mb-2 !w-[calc(100%-1rem)]" value={p.locale} onChange={(e) => setLocale(e.target.value)}>
                {SUPPORTED_LOCALES.map((l) => (
                  <option key={l.code} value={l.code}>
                    {l.label}
                  </option>
                ))}
              </select>
              {p.mode === "DEMO" && p.demoUsers.length > 0 && (
                <div className="mb-2 border-t border-line pt-2">
                  <p className="mb-1 px-2 text-[11px] font-medium tracking-wider text-muted uppercase">Demo role switch (audited)</p>
                  <ul className="max-h-56 overflow-auto">
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
              <div className="border-t border-line pt-2">
                {p.mode !== "INTEGRATION" && (
                  <a role="menuitem" href="/account/password" className="block w-full rounded px-2 py-1.5 text-left text-sm text-ink hover:bg-brand-light">
                    {t(p.locale, "topbar.changePassword")}
                  </a>
                )}
                <button type="button" role="menuitem" className="w-full rounded px-2 py-1.5 text-left text-sm text-ink hover:bg-brand-light" onClick={logout}>
                  {t(p.locale, "topbar.signOut")}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}
