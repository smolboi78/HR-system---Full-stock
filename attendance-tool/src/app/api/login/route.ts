import { NextResponse } from "next/server";
import { z } from "zod";
import { getSession } from "@/lib/session";
import { checkPassword } from "@/lib/password";

const Body = z.object({ password: z.string().min(1), name: z.string().trim().max(80).optional() });

export async function POST(request: Request) {
  const parsed = Body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "A password is required" }, { status: 400 });
  }
  if (!checkPassword(parsed.data.password)) {
    return NextResponse.json({ error: "That password is not right" }, { status: 401 });
  }
  const session = await getSession();
  session.user = { name: parsed.data.name?.trim() || "HR" };
  await session.save();
  return NextResponse.json({ ok: true });
}
