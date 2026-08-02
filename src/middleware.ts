import { NextRequest, NextResponse } from "next/server";
import { getIronSession, type IronSessionData } from "iron-session";
import { sessionOptions } from "@/lib/session";

const PROTECTED_PREFIXES = ["/dashboard", "/reports", "/admin"];

export async function middleware(request: NextRequest) {
  const isProtected = PROTECTED_PREFIXES.some((p) => request.nextUrl.pathname.startsWith(p));
  if (!isProtected) return NextResponse.next();

  const response = NextResponse.next();
  const session = await getIronSession<IronSessionData>(request, response, sessionOptions());

  if (!session.user) {
    const loginUrl = new URL("/login", request.url);
    loginUrl.searchParams.set("next", request.nextUrl.pathname);
    return NextResponse.redirect(loginUrl);
  }

  return response;
}

export const config = {
  matcher: ["/dashboard/:path*", "/reports/:path*", "/admin/:path*"],
};
