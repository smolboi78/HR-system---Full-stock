import { prisma } from "./db";

// A small JSON cache in the Setting table, for ZenHR data that changes
// rarely but is expensive to read - leave types and work shifts each run to
// several paginated pages, and re-reading them on every pull is most of what
// makes a pull slow.

interface Entry<T> {
  at: number;
  value: T;
}

export async function cached<T>(
  key: string,
  ttlMs: number,
  load: () => Promise<T>
): Promise<T> {
  const row = await prisma.setting.findUnique({ where: { key } });
  if (row) {
    try {
      const entry = JSON.parse(row.value) as Entry<T>;
      if (Date.now() - entry.at < ttlMs) return entry.value;
    } catch {
      // A corrupt entry is simply refreshed.
    }
  }

  const value = await load();
  const entry: Entry<T> = { at: Date.now(), value };
  const serialised = JSON.stringify(entry);
  await prisma.setting.upsert({
    where: { key },
    create: { key, value: serialised },
    update: { value: serialised },
  });
  return value;
}

export const ONE_DAY_MS = 24 * 60 * 60 * 1000;
