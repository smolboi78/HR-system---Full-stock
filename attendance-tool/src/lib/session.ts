import { getIronSession, type IronSessionData } from "iron-session";
import { cookies } from "next/headers";

declare module "iron-session" {
  interface IronSessionData {
    user?: { name: string };
    zenhrOAuthState?: string;
  }
}

// One shared passphrase for the HR team rather than per-user accounts: the
// tool is used by the two people who run this reconciliation, and every
// write it makes is already attributed in ZenHR to the integration app.
export function sessionOptions() {
  const secret = process.env.SESSION_SECRET;
  if (!secret || secret.length < 32) {
    throw new Error("SESSION_SECRET must be set to a random string of at least 32 characters");
  }
  return {
    password: secret,
    cookieName: "fullstock_attendance_session",
    cookieOptions: {
      secure: process.env.NODE_ENV === "production",
      httpOnly: true,
      sameSite: "lax" as const,
    },
  };
}

export async function getSession() {
  return getIronSession<IronSessionData>(await cookies(), sessionOptions());
}

export async function requireUser(): Promise<{ name: string }> {
  const session = await getSession();
  if (!session.user) throw new UnauthorisedError();
  return session.user;
}

export class UnauthorisedError extends Error {
  constructor() {
    super("Not signed in");
  }
}
