import { NextResponse } from "next/server";
import { testConnection } from "@/lib/zenhr";

// Asks ZenHR who we are and what we are allowed to do. Deliberately reports
// the permissions ZenHR itself returns rather than what we hoped for - it is
// the only way to know whether a credential can actually write deductions.
export const maxDuration = 60;

export async function GET() {
  const result = await testConnection();
  return NextResponse.json(result, { status: result.ok ? 200 : 502 });
}
