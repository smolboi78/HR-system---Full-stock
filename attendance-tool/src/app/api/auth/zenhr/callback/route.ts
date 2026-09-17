import { NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { exchangeCodeForToken } from "@/lib/zenhr";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const session = await getSession();

  if (!code || !state || state !== session.zenhrOAuthState) {
    return NextResponse.json(
      { error: "The ZenHR callback state did not match. Start again from /admin/connect-zenhr." },
      { status: 400 }
    );
  }
  session.zenhrOAuthState = undefined;
  await session.save();

  try {
    await exchangeCodeForToken(code);
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 502 });
  }
  return NextResponse.redirect(new URL("/admin/connect-zenhr?connected=1", request.url));
}
