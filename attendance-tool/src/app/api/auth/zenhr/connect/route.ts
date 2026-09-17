import { NextResponse } from "next/server";
import { randomBytes } from "node:crypto";
import { getSession } from "@/lib/session";
import { getAuthorizeUrl } from "@/lib/zenhr";

// Step one of the one-time OAuth bootstrap. The state nonce is parked in
// the session and checked on the way back.
export async function GET() {
  const session = await getSession();
  const state = randomBytes(16).toString("hex");
  session.zenhrOAuthState = state;
  await session.save();
  return NextResponse.redirect(getAuthorizeUrl(state));
}
