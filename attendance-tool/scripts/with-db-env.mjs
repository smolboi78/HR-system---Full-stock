// Resolves the database URLs, then runs the given command with them set.
//
// Vercel's Postgres and Neon integrations inject their connection strings
// under names of their own choosing, and the pooled/direct split matters:
// the app wants the pooled connection (serverless makes many short-lived
// connections), while `prisma migrate deploy` wants the direct one, because
// migrations take advisory locks a connection pooler does not carry.
//
// Setting them in a wrapper rather than in the schema means neither Vercel's
// dashboard nor anyone's .env has to be renamed to match Prisma.

import { spawn } from "node:child_process";
import { delimiter, join } from "node:path";

const pick = (...names) => {
  for (const name of names) {
    const value = process.env[name];
    if (value && value.trim()) return value.trim();
  }
  return undefined;
};

// Pooled, for the app itself.
const pooled = pick(
  "DATABASE_URL",
  "POSTGRES_PRISMA_URL",
  "POSTGRES_URL",
  "DATABASE_URL_POOLED"
);

// Direct, for migrations. Falls back to the pooled URL, which is fine for
// a plain Postgres with no pooler in front of it.
const direct = pick(
  "DIRECT_URL",
  "DATABASE_URL_UNPOOLED",
  "POSTGRES_URL_NON_POOLING",
  "DATABASE_DIRECT_URL"
);

if (!pooled) {
  console.error(
    "No database URL found. Set DATABASE_URL (or connect a Postgres integration, " +
      "which provides POSTGRES_PRISMA_URL / POSTGRES_URL)."
  );
  process.exit(1);
}

// `npm run` puts node_modules/.bin on PATH; a bare spawn does not, so
// local binaries (prisma, tsx, next) would not resolve without this.
const binDir = join(process.cwd(), "node_modules", ".bin");
const env = {
  ...process.env,
  PATH: `${binDir}${delimiter}${process.env.PATH ?? ""}`,
  DATABASE_URL: pooled,
  DIRECT_URL: direct ?? pooled,
};

const command = process.argv.slice(2).join(" ");
if (!command) {
  console.error("Usage: node scripts/with-db-env.mjs <command>");
  process.exit(1);
}

const child = spawn(command, { stdio: "inherit", shell: true, env });
child.on("exit", (code, signal) => process.exit(code ?? (signal ? 1 : 0)));
