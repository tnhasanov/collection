/** 18px line icons for the navigation (stroke = currentColor). */
const P = { fill: "none", stroke: "currentColor", strokeWidth: 1.6, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };

export function NavIcon({ name }: { name: string }) {
  switch (name) {
    case "grid":
      return (<svg viewBox="0 0 20 20" aria-hidden="true"><rect x="3" y="3" width="5.5" height="5.5" rx="1.2" {...P} /><rect x="11.5" y="3" width="5.5" height="5.5" rx="1.2" {...P} /><rect x="3" y="11.5" width="5.5" height="5.5" rx="1.2" {...P} /><rect x="11.5" y="11.5" width="5.5" height="5.5" rx="1.2" {...P} /></svg>);
    case "users":
      return (<svg viewBox="0 0 20 20" aria-hidden="true"><circle cx="7.5" cy="7" r="3" {...P} /><path d="M2.5 16.5c.6-2.8 2.6-4.3 5-4.3s4.4 1.5 5 4.3" {...P} /><path d="M13 4.3a2.8 2.8 0 0 1 0 5.4M14.5 12.5c1.6.5 2.6 1.8 3 4" {...P} /></svg>);
    case "phone":
      return (<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M4.2 3h2.6l1.3 3.4-1.7 1.1a9 9 0 0 0 4.1 4.1l1.1-1.7 3.4 1.3v2.6c0 .8-.7 1.5-1.5 1.4C8 14.8 5.2 12 4.8 4.5 4.7 3.7 5.4 3 6.2 3" {...P} /></svg>);
    case "clock":
      return (<svg viewBox="0 0 20 20" aria-hidden="true"><circle cx="10" cy="10" r="7" {...P} /><path d="M10 6v4.2l2.8 1.6" {...P} /></svg>);
    case "chart":
      return (<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M3 3v14h14" {...P} /><path d="M7 13.5v-3M10.5 13.5V7M14 13.5v-5" {...P} /></svg>);
    case "home":
      return (<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M3.5 9 10 3.5 16.5 9v7.5h-4.5v-4.5H8v4.5H3.5z" {...P} /></svg>);
    case "list":
      return (<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M7 5.5h10M7 10h10M7 14.5h10" {...P} /><circle cx="3.8" cy="5.5" r=".9" fill="currentColor" /><circle cx="3.8" cy="10" r=".9" fill="currentColor" /><circle cx="3.8" cy="14.5" r=".9" fill="currentColor" /></svg>);
    case "check":
      return (<svg viewBox="0 0 20 20" aria-hidden="true"><rect x="3" y="3" width="14" height="14" rx="2.5" {...P} /><path d="m6.5 10.2 2.3 2.3 4.7-4.8" {...P} /></svg>);
    case "money":
      return (<svg viewBox="0 0 20 20" aria-hidden="true"><rect x="2.5" y="5" width="15" height="10" rx="1.8" {...P} /><circle cx="10" cy="10" r="2.2" {...P} /></svg>);
    case "shield":
      return (<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M10 2.8 16 5v4.6c0 3.6-2.5 6.3-6 7.6-3.5-1.3-6-4-6-7.6V5z" {...P} /></svg>);
    case "settings":
      return (<svg viewBox="0 0 20 20" aria-hidden="true"><circle cx="10" cy="10" r="2.6" {...P} /><path d="M10 2.5v2M10 15.5v2M2.5 10h2M15.5 10h2M4.7 4.7l1.4 1.4M13.9 13.9l1.4 1.4M4.7 15.3l1.4-1.4M13.9 6.1l1.4-1.4" {...P} /></svg>);
    default:
      return (<svg viewBox="0 0 20 20" aria-hidden="true"><circle cx="10" cy="10" r="2.2" fill="currentColor" /></svg>);
  }
}

const BY_HREF: Record<string, string> = {
  "/agent": "grid",
  "/customers": "users",
  "/agent/call": "phone",
  "/agent/follow-ups": "clock",
  "/agent/results": "chart",
  "/home": "home",
  "/overview": "grid",
  "/work-queue": "list",
  "/promises": "check",
  "/tasks": "clock",
  "/payments": "money",
  "/analytics": "chart",
  "/approvals": "check",
  "/exceptions": "shield",
  "/settings": "settings",
  "/arrangements": "check",
  "/recovery": "shield",
  "/strategies": "settings",
  "/models/prometeia": "chart",
  "/strategy/economics": "money",
  "/model-monitoring": "chart",
  "/operations": "users",
  "/campaigns": "list",
  "/templates": "list",
  "/data/imports": "list",
  "/integrations": "settings",
  "/audit": "shield",
  "/admin/users": "users",
};

export const iconFor = (href: string) => BY_HREF[href] ?? "dot";
