"use client";
import Link from "next/link";
import Image from "next/image";
import { usePathname } from "next/navigation";
import { useState } from "react";
import type { NavGroup } from "@/components/shell/nav";
import { t, type Locale } from "@/i18n/dictionaries";
import { cx } from "@/components/ui";
import { NavIcon, iconFor } from "@/components/shell/icons";

const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? "")
    .join("");

/** Light 176px sidebar: logo, grouped navigation with icons, and the signed-in user at the bottom. */
export function Sidebar({ groups, locale, user }: { groups: NavGroup[]; locale: Locale; user: { displayName: string; roleLabel: string } }) {
  const pathname = usePathname();
  // Closed by default: on wide screens the sidebar is always shown (lg:static), on narrow screens it opens on demand.
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" className="btn btn-secondary btn-sm fixed top-2.5 left-2 z-40 lg:hidden" aria-expanded={open} aria-controls="app-sidebar" onClick={() => setOpen((o) => !o)}>
        {open ? t(locale, "nav.hideMenu") : t(locale, "nav.menu")}
      </button>
      <aside id="app-sidebar" className={cx("fixed inset-y-0 left-0 z-30 flex w-44 shrink-0 flex-col border-r border-line bg-sidebar transition-transform lg:sticky lg:top-0 lg:h-screen lg:translate-x-0", open ? "translate-x-0 shadow-xl" : "-translate-x-full")} aria-label="Primary navigation">
        <div className="flex h-14 items-center gap-2.5 px-4">
          <Image src="/brand/atb-logo.svg" alt="ATB" width={40} height={26} priority />
          <span className="text-[15px] font-medium text-ink">Collections</span>
        </div>
        <nav className="flex-1 overflow-y-auto px-2 pb-4">
          {groups.map((g) => (
            <div key={g.labelKey}>
              <p className="nav-group">{t(locale, g.labelKey)}</p>
              <ul className="space-y-0.5">
                {g.items.map((item) => {
                  const active = pathname === item.href || (item.href !== "/agent" && pathname.startsWith(item.href + "/"));
                  return (
                    <li key={item.href}>
                      <Link href={item.href} className="nav-link" title={t(locale, item.labelKey)} aria-current={active ? "page" : undefined} onClick={() => setOpen(false)}>
                        <NavIcon name={iconFor(item.href)} />
                        <span className="truncate">{t(locale, item.labelKey)}</span>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </nav>
        <div className="flex items-center gap-2.5 border-t border-line px-3.5 py-3" data-testid="sidebar-user">
          <span className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-brand-light text-xs font-medium text-brand" aria-hidden="true">
            {initials(user.displayName)}
          </span>
          <span className="min-w-0">
            <span className="block truncate text-sm font-medium text-ink" title={user.displayName}>{user.displayName}</span>
            <span className="block truncate text-xs text-muted" title={user.roleLabel}>{user.roleLabel}</span>
          </span>
        </div>
      </aside>
    </>
  );
}
