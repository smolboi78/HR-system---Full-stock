// Single source of truth for resolving the database connection strings.
//
// Used in two places on purpose:
//   - scripts/with-db-env.mjs, so the Prisma CLI (which reads the
//     environment) gets DATABASE_URL/DIRECT_URL at build time;
//   - src/lib/db.ts, so the running app resolves its own URL. That one
//     matters because a serverless host runs the built functions directly -
//     no npm script, so no wrapper. Resolving only in the wrapper would
//     migrate the database at build time and then fail to connect at
//     runtime, which looks like a healthy deploy serving a broken app.
//
// Hosts name these variables differently: Vercel's Postgres provides
// POSTGRES_PRISMA_URL/POSTGRES_URL, and its Neon integration names them
// after a prefix that defaults to STORAGE. DB_URL_PREFIX covers any other.

const POOLED_NAMES = [
  "DATABASE_URL",
  "POSTGRES_PRISMA_URL",
  "POSTGRES_URL",
  "DATABASE_URL_POOLED",
  "STORAGE_PRISMA_URL",
  "STORAGE_URL",
];

const DIRECT_NAMES = [
  "DIRECT_URL",
  "DATABASE_URL_UNPOOLED",
  "POSTGRES_URL_NON_POOLING",
  "DATABASE_DIRECT_URL",
  "STORAGE_URL_UNPOOLED",
  "STORAGE_URL_NON_POOLING",
];

function pick(env, names) {
  for (const name of names) {
    const value = env[name];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return undefined;
}

export function resolveDatabaseUrls(env = process.env) {
  const prefix = env.DB_URL_PREFIX?.trim().replace(/_+$/, "");
  const prefixed = (suffix) => (prefix ? [`${prefix}_${suffix}`] : []);

  const pooled = pick(env, [...prefixed("URL"), ...POOLED_NAMES]);
  const direct = pick(env, [
    ...prefixed("URL_UNPOOLED"),
    ...prefixed("URL_NON_POOLING"),
    ...DIRECT_NAMES,
  ]);

  return { pooled, direct: direct ?? pooled };
}

export const RECOGNISED_NAMES = [...POOLED_NAMES, ...DIRECT_NAMES];
