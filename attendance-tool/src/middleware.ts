import { NextRequest, NextResponse } from "next/server";
import { getIronSession, type IronSessionData } from "iron-session";
import { sessionOptions } from "@/lib/session";

const PUBLIC_PATHS = ["/login", "/api/login"];

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  if (PUBLIC_PATHS.some((p) => pathname.startsWith(p))) return NextResponse.next();

  const response = NextResponse.next();
  const session = await getIronSession<IronSessionData>(request, response, sessionOptions());
  if (session.user) return response;

  // API callers get a status they can act on; page requests get the form.
  if (pathname.startsWith("/api/")) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }
  const loginUrl = new URL("/login", request.url);
  loginUrl.searchParams.set("next", pathname);
  return NextResponse.redirect(loginUrl);
}

export const config = {
  matcher: [
    // Everything except Next's own assets and the favicon.
    "/((?!_next/static|_next/image|favicon.ico).*)",
  ],
};
