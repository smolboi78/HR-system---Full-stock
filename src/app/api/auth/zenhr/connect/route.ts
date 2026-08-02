import { NextResponse } from "next/server";
import crypto from "crypto";
import { getAuthorizeUrl } from "@/lib/zenhr";
import { getSession } from "@/lib/session";

export async function GET() {
  const session = await getSession();
  if (!session.user || session.user.role !== "ADMIN") {
    return NextResponse.json({ error: "Admin only" }, { status: 403 });
  }

  const state = crypto.randomBytes(16).toString("hex");
  session.zenhrOAuthState = state;
  await session.save();

  return NextResponse.redirect(getAuthorizeUrl(state));
}
