import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { resolveBranchId, zenhrDate } from "@/lib/pull";
import * as zenhr from "@/lib/zenhr";

// Shows what ZenHR actually returns, so a disagreement between the tool and
// the real world can be settled with data instead of argument. Read-only.
//
// It deliberately asks the same question three ways - filtered transactions,
// filtered requests, and unfiltered transactions - because "no leave found"
// has three quite different causes: the data is not there, our date filter
// excluded it, or it lives on the endpoint we were not reading.
export const maxDuration = 60;

const DateStr = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

function summarise(list: zenhr.ZenhrTimeoffTransaction[], limit = 25) {
  return list.slice(0, limit).map((t) => ({
    id: t.id,
    zenhrEmployeeId: t.employee?.id,
    timeoffId: t.timeoff?.id,
    rawFrom: t.from_date,
    rawTo: t.to_date,
    readAsFrom: zenhrDate(t.from_date),
    readAsTo: zenhrDate(t.to_date),
    status: t.status,
    className: t.class_name,
    amount: t.amount,
  }));
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const parsed = z
    .object({ from: DateStr, to: DateStr })
    .safeParse({ from: url.searchParams.get("from"), to: url.searchParams.get("to") });
  if (!parsed.success) {
    return NextResponse.json({ error: "Pass ?from=YYYY-MM-DD&to=YYYY-MM-DD" }, { status: 400 });
  }
  const { from, to } = parsed.data;

  try {
    const branches = await zenhr.listBranches();
    const branchId = await resolveBranchId();
    const roster = await prisma.rosterEmployee.findMany({
      select: { employmentNumber: true, nameEn: true, zenhrEmployeeId: true },
      orderBy: { employmentNumber: "asc" },
    });

    // Every probe is bounded, so the diagnostic always answers even when one
    // of them is slow - an endpoint that returns nothing is exactly the
    // failure it exists to explain.
    const withTimeout = <T>(p: Promise<T>, label: string): Promise<T | Error> =>
      Promise.race([
        p.catch((e) => e as Error),
        new Promise<Error>((resolve) =>
          setTimeout(() => resolve(new Error(`${label} did not answer within 15s`)), 15_000)
        ),
      ]);

    const [filtered, requests, unfiltered, employees] = await Promise.all([
      withTimeout(zenhr.listTimeoffTransactions(branchId, from, to), "transactions"),
      withTimeout(zenhr.listTimeoffTransactionRequests(branchId, from, to), "requests"),
      withTimeout(zenhr.listTimeoffTransactionsWide(branchId, from, to), "wide window"),
      withTimeout(zenhr.listEmployees(branchId), "employees"),
    ]);

    const asList = (v: zenhr.ZenhrTimeoffTransaction[] | Error) =>
      v instanceof Error ? { error: v.message } : { count: v.length, sample: summarise(v) };

    // Of everything ZenHR holds, which transactions actually overlap the
    // window once our own date reading is applied?
    const overlapping =
      unfiltered instanceof Error
        ? []
        : unfiltered.filter((t) => zenhrDate(t.from_date) <= to && zenhrDate(t.to_date) >= from);

    return NextResponse.json({
      range: { from, to },
      branchUsed: branchId,
      allBranches: branches.map((b) => ({
        id: b.id,
        name: typeof b.name === "string" ? b.name : b.name?.en,
      })),
      employeesInBranch: employees instanceof Error ? { error: employees.message } : employees.length,
      roster: {
        total: roster.length,
        matchedToZenhr: roster.filter((r) => r.zenhrEmployeeId).length,
        unmatched: roster.filter((r) => !r.zenhrEmployeeId).map((r) => r.employmentNumber),
      },
      timeoffTransactionsFiltered: asList(filtered),
      timeoffTransactionRequestsFiltered: asList(requests),
      timeoffTransactionsWideWindow:
        unfiltered instanceof Error
          ? { error: unfiltered.message }
          : {
              count: unfiltered.length,
              overlappingTheRange: overlapping.length,
              sampleOverlapping: summarise(overlapping),
            },
    });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 502 });
  }
}
