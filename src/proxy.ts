import { NextResponse, type NextRequest } from "next/server";

const PUBLIC = ["/login", "/api/auth/login", "/brand", "/_next", "/favicon.ico"];

/** Lightweight gate: unauthenticated shell requests go to /login. Real authorization happens on the server per page/route. */
export function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl;
  if (PUBLIC.some((p) => pathname.startsWith(p)) || pathname === "/") return NextResponse.next();
  const hasCookie = !!req.cookies.get("atb_session")?.value;
  if (!hasCookie) {
    if (pathname.startsWith("/api/")) return NextResponse.json({ ok: false, error: { code: "UNAUTHORIZED", message: "Authentication required" } }, { status: 401 });
    const url = req.nextUrl.clone();
    url.pathname = "/login";
    url.searchParams.set("reason", "session");
    url.searchParams.set("next", pathname);
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
}

export const config = { matcher: ["/((?!_next/static|_next/image|brand|favicon.ico).*)"] };
