import { getIronSession, type IronSessionData } from "iron-session";
import { cookies } from "next/headers";

declare module "iron-session" {
  interface IronSessionData {
    user?: {
      id: string;
      email: string;
      name: string;
      role: "ADMIN" | "MANAGER";
    };
    zenhrOAuthState?: string;
  }
}

function sessionSecret(): string {
  const secret = process.env.SESSION_SECRET;
  if (!secret || secret.length < 32) {
    throw new Error("SESSION_SECRET must be set to a random string of at least 32 characters");
  }
  return secret;
}

export function sessionOptions() {
  return {
    password: sessionSecret(),
    cookieName: "hr_dashboard_session",
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
