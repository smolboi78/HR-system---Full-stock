// Runs the given command with DATABASE_URL and DIRECT_URL resolved, so the
// Prisma CLI finds them whatever the host calls them. The app itself does
// its own resolving (see src/lib/db.ts) because a serverless runtime never
// runs an npm script.

import { spawn } from "node:child_process";
import { delimiter, join } from "node:path";
import { RECOGNISED_NAMES, resolveDatabaseUrls } from "./db-url.mjs";

const { pooled, direct } = resolveDatabaseUrls();

if (!pooled) {
  console.error(
    `No database URL found. Set DATABASE_URL, or connect a Postgres integration - ` +
      `any of these is recognised: ${RECOGNISED_NAMES.join(", ")}. For another ` +
      `prefix, set DB_URL_PREFIX (e.g. DB_URL_PREFIX=MYDB for MYDB_URL).`
  );
  process.exit(1);
}

// `npm run` puts node_modules/.bin on PATH; a bare spawn does not, so local
// binaries (prisma, tsx, next) would not resolve without this.
const binDir = join(process.cwd(), "node_modules", ".bin");
const env = {
  ...process.env,
  PATH: `${binDir}${delimiter}${process.env.PATH ?? ""}`,
  DATABASE_URL: pooled,
  DIRECT_URL: direct,
};

const command = process.argv.slice(2).join(" ");
if (!command) {
  console.error("Usage: node scripts/with-db-env.mjs <command>");
  process.exit(1);
}

const child = spawn(command, { stdio: "inherit", shell: true, env });
child.on("exit", (code, signal) => process.exit(code ?? (signal ? 1 : 0)));
