import { NextRequest, NextResponse } from "next/server";
import { exchangeCodeForToken } from "@/lib/zenhr";
import { getSession } from "@/lib/session";

export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session.user || session.user.role !== "ADMIN") {
    return NextResponse.json({ error: "Admin only" }, { status: 403 });
  }

  const code = req.nextUrl.searchParams.get("code");
  const state = req.nextUrl.searchParams.get("state");

  if (!code || !state || state !== session.zenhrOAuthState) {
    return NextResponse.redirect(
      new URL("/admin/connect-zenhr?error=invalid_state", req.url)
    );
  }

  session.zenhrOAuthState = undefined;
  await session.save();

  try {
    await exchangeCodeForToken(code);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.redirect(
      new URL(`/admin/connect-zenhr?error=${encodeURIComponent(message)}`, req.url)
    );
  }

  return NextResponse.redirect(new URL("/admin/connect-zenhr?connected=1", req.url));
}
