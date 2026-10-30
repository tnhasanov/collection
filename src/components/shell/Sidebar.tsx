"use client";
import Link from "next/link";
import Image from "next/image";
import { usePathname } from "next/navigation";
import { useState } from "react";
import type { NavGroup } from "@/components/shell/nav";
import { t, type Locale } from "@/i18n/dictionaries";
import { cx } from "@/components/ui";

export function Sidebar({ groups, locale }: { groups: NavGroup[]; locale: Locale }) {
  const pathname = usePathname();
  // Closed by default: on wide screens the sidebar is always shown (lg:static), on narrow screens it opens on demand.
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" className="fixed left-2 top-2 z-40 rounded-md bg-brand-dark px-2 py-1 text-xs text-white lg:hidden" aria-expanded={open} aria-controls="app-sidebar" onClick={() => setOpen((o) => !o)}>
        {open ? t(locale, "nav.hideMenu") : t(locale, "nav.menu")}
      </button>
      <aside id="app-sidebar" className={cx("fixed inset-y-0 left-0 z-30 flex w-60 flex-col bg-brand-dark text-white transition-transform lg:static lg:translate-x-0", open ? "translate-x-0" : "-translate-x-full")} aria-label="Primary navigation">
        <div className="flex items-center gap-3 px-4 pt-4 pb-2">
          <Image src="/brand/atb-logo.svg" alt="atb" width={64} height={41} priority />
          <span className="text-xs font-bold tracking-wider">COLLECTIONS</span>
        </div>
        <nav className="flex-1 overflow-y-auto px-2 pb-4">
          {groups.map((g) => (
            <div key={g.labelKey}>
              <p className="nav-group">{t(locale, g.labelKey)}</p>
              <ul className="space-y-0.5">
                {g.items.map((item) => {
                  const active = pathname === item.href || (item.href !== "/agent" && pathname.startsWith(item.href + "/")) || (item.href === "/agent" && pathname === "/agent");
                  return (
                    <li key={item.href}>
                      <Link href={item.href} className="nav-link" aria-current={active ? "page" : undefined} onClick={() => setOpen(false)}>
                        <span>{t(locale, item.labelKey)}</span>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </nav>
        <div className="border-t border-white/15 px-4 py-3 text-[11px] text-white/60">
          <p className="uppercase tracking-wider">{t(locale, "app.internal")}</p>
          <p>{t(locale, "app.synthetic")}</p>
        </div>
      </aside>
    </>
  );
}
