import { describe, expect, it } from "vitest";
import { reconcile, summarise, preferredBucket, daysForHours } from "../src/lib/reconcile";
import type { EngineEmployee } from "../src/lib/reconcile";

// A Monday-to-Wednesday window in a month with no Egyptian public holiday,
// so weekday/holiday handling doesn't muddy the rule under test.
const FROM = "2026-09-07"; // Monday
const TO = "2026-09-09"; // Wednesday
const TODAY = "2026-09-17";

function employee(over: Partial<EngineEmployee> = {}): EngineEmployee {
  return {
    employmentNumber: "124",
    nameEn: "Mohamed Shawky",
    role: "Accountant",
    tracking: "HOURS",
    excluded: false,
    daysOff: [5, 6],
    zenhrEmployeeId: 9001,
    shiftLabel: "09:00 - 17:00",
    daysOffFromShift: true,
    hiringDate: null,
    terminationDate: null,
    ...over,
  };
}

function run(input: Partial<Parameters<typeof reconcile>[0]> = {}) {
  return reconcile({
    from: FROM,
    to: TO,
    employees: [employee()],
    attendance: [],
    timeoff: [],
    visits: [],
    today: TODAY,
    ...input,
  });
}

describe("time off settles a day", () => {
  it("does not treat an approved time-off day as an absence, even with no clock-in", () => {
    const rows = run({
      timeoff: [
        {
          employmentNumber: "124",
          from: "2026-09-08",
          to: "2026-09-08",
          timeoffId: 809,
          timeoffName: "Annual Vacation",
          status: "approved",
          notes: "",
        },
      ],
    });
    const day = rows.find((r) => r.date === "2026-09-08")!;
    expect(day.state).toBe("TIME_OFF");
    expect(day.timeoffName).toBe("Annual Vacation");
    expect(day.suggestedReason).toBeNull();
  });

  it("treats an unfamiliar status as covering rather than charging the person", () => {
    // The dangerous direction: a status we have never seen must not read as
    // "no leave booked", because that silently deducts a day.
    for (const status of ["Approved by manager", "taken_paid", "3", "in_progress", ""]) {
      const rows = run({
        timeoff: [
          {
            employmentNumber: "124",
            from: "2026-09-08",
            to: "2026-09-08",
            timeoffId: 809,
            timeoffName: "Annual Vacation",
            status,
            notes: "",
          },
        ],
      });
      const day = rows.find((r) => r.date === "2026-09-08")!;
      expect(day.state).toBe("TIME_OFF");
      expect(day.detail).toContain("status:");
    }
  });

  it("ignores a cancelled or withdrawn transaction", () => {
    for (const status of ["cancelled", "withdrawn", "rejected", "CANCELLED", " declined "]) {
      const rows = run({
        timeoff: [
          {
            employmentNumber: "124",
            from: "2026-09-08",
            to: "2026-09-08",
            timeoffId: 809,
            timeoffName: "Annual Vacation",
            status,
            notes: "",
          },
        ],
      });
      expect(rows.find((r) => r.date === "2026-09-08")!.state).toBe("EXCEPTION");
    }
  });

  it("covers every day of a multi-day transaction spanning the range edge", () => {
    const rows = run({
      timeoff: [
        {
          employmentNumber: "124",
          from: "2026-09-01",
          to: "2026-09-08",
          timeoffId: 809,
          timeoffName: "Annual Vacation",
          status: "approved",
          notes: "",
        },
      ],
    });
    expect(rows.filter((r) => r.state === "TIME_OFF").map((r) => r.date)).toEqual([
      "2026-09-07",
      "2026-09-08",
    ]);
  });
});

describe("business missions are worked time", () => {
  const mission = (date: string) => ({
    employmentNumber: "124",
    from: date,
    to: date,
    timeoffId: 812,
    timeoffName: "Business Mission",
    status: "approved",
    notes: "",
  });

  it("reads a mission-covered day as present, never as leave", () => {
    const row = run({
      timeoff: [mission("2026-09-08")],
      businessMissionTimeoffIds: new Set([812]),
    }).find((r) => r.date === "2026-09-08")!;
    expect(row.state).toBe("PRESENT");
    expect(row.timeoffName).toBe("Business Mission");
    expect(row.suggestedReason).toBeNull();
  });

  it("still reads an ordinary leave type as leave", () => {
    const row = run({
      timeoff: [{ ...mission("2026-09-08"), timeoffId: 809, timeoffName: "Annual Vacation" }],
      businessMissionTimeoffIds: new Set([812]),
    }).find((r) => r.date === "2026-09-08")!;
    expect(row.state).toBe("TIME_OFF");
  });

  it("counts a mission day as worked even when they also clocked in", () => {
    const row = run({
      timeoff: [mission("2026-09-07")],
      businessMissionTimeoffIds: new Set([812]),
      attendance: [
        {
          employmentNumber: "124",
          date: "2026-09-07",
          entryTime: "2026-09-07T06:00:00.000Z",
          exitTime: "2026-09-07T10:00:00.000Z",
          missingStatus: "complete",
          suspicious: false,
        },
      ],
    }).find((r) => r.date === "2026-09-07")!;
    expect(row.state).toBe("PRESENT");
    expect(row.detail).toContain("4h also clocked");
  });
});

describe("days off follow the ZenHR shift", () => {
  it("uses the shift's days off, not the roster default", () => {
    // A shift that is off Sunday and Monday rather than Friday/Saturday.
    const rows = reconcile({
      from: "2026-09-06", // Sunday
      to: "2026-09-07", // Monday
      employees: [employee({ daysOff: [0, 1], daysOffFromShift: true })],
      attendance: [],
      timeoff: [],
      visits: [],
      today: TODAY,
    });
    expect(rows.map((r) => r.state)).toEqual(["DAY_OFF", "DAY_OFF"]);
    expect(rows[0].detail).toBe("Day off on their ZenHR shift");
  });

  it("says so when it had to fall back to the roster default", () => {
    const rows = reconcile({
      from: "2026-09-11", // Friday
      to: "2026-09-11",
      employees: [employee({ daysOffFromShift: false })],
      attendance: [],
      timeoff: [],
      visits: [],
      today: TODAY,
    });
    expect(rows[0].detail).toContain("no ZenHR shift assigned");
  });
});

describe("unexplained gaps", () => {
  it("suggests a full-day absence when there is no record and no time off", () => {
    const rows = run();
    expect(rows).toHaveLength(3);
    for (const row of rows) {
      expect(row.state).toBe("EXCEPTION");
      expect(row.suggestedReason).toBe("FULL_DAY_ABSENCE");
    }
  });

  it("points employee 211's gaps at a business mission instead", () => {
    const rows = run({
      employees: [
        employee({ employmentNumber: "211", nameEn: "Ramadan Mohamed", role: "Sales Support", tracking: "PRESENCE" }),
      ],
      businessMissionEmployee: "211",
    });
    expect(rows[0].suggestedReason).toBe("BUSINESS_MISSION");
  });

  it("raises an unmatched roster entry once, not once per day, and never as an absence", () => {
    const rows = run({ employees: [employee({ zenhrEmployeeId: null })] });
    expect(rows).toHaveLength(1);
    expect(rows[0].state).toBe("UNMATCHED");
    expect(rows[0].suggestedReason).toBeNull();
    expect(rows[0].flags.map((f) => f.code)).toContain("NO_ZENHR_ID");
    expect(summarise(rows)).toMatchObject({ unmatched: 1, exceptions: 0 });
  });
});

describe("clocked days", () => {
  const attendance = (over: Record<string, unknown> = {}) => [
    {
      employmentNumber: "124",
      date: "2026-09-07",
      entryTime: "2026-09-07T06:00:00.000Z",
      exitTime: "2026-09-07T14:00:00.000Z",
      missingStatus: "complete",
      suspicious: false,
      ...over,
    },
  ];

  it("counts a full clocked day as present with its hours", () => {
    const row = run({ attendance: attendance() }).find((r) => r.date === "2026-09-07")!;
    expect(row.state).toBe("PRESENT");
    expect(row.workedHours).toBe(8);
  });

  it("treats a missing checkout as an exception suggesting the half-day reason", () => {
    const row = run({
      attendance: attendance({ exitTime: null, missingStatus: "missing_out" }),
    }).find((r) => r.date === "2026-09-07")!;
    expect(row.state).toBe("EXCEPTION");
    expect(row.suggestedReason).toBe("MISSING_CHECKOUT");
  });

  it("flags a day of an hour or less but leaves the reason blank rather than guessing", () => {
    const row = run({
      attendance: attendance({ exitTime: "2026-09-07T06:45:00.000Z" }),
    }).find((r) => r.date === "2026-09-07")!;
    expect(row.state).toBe("EXCEPTION");
    expect(row.flags.map((f) => f.code)).toContain("IRREGULAR_DURATION");
    expect(row.suggestedReason).toBeNull();
  });

  it("does not hold a short day against a presence-only role", () => {
    const row = run({
      employees: [employee({ tracking: "PRESENCE", role: "Collector" })],
      attendance: attendance({ exitTime: "2026-09-07T06:45:00.000Z" }),
    }).find((r) => r.date === "2026-09-07")!;
    expect(row.state).toBe("PRESENT");
  });
});

describe("Bricks as a signal", () => {
  it("counts a Bricks visit as presence for a presence-only role with no ZenHR record", () => {
    const row = run({
      employees: [employee({ employmentNumber: "115", tracking: "PRESENCE", role: "Collector" })],
      visits: [{ employmentNumber: "115", date: "2026-09-07", count: 3 }],
    }).find((r) => r.date === "2026-09-07")!;
    expect(row.state).toBe("PRESENT");
    expect(row.bricksVisits).toBe(3);
  });

  it("never lets a Bricks visit stand in for an hours-tracked employee", () => {
    const row = run({
      visits: [{ employmentNumber: "124", date: "2026-09-07", count: 3 }],
    }).find((r) => r.date === "2026-09-07")!;
    expect(row.state).toBe("EXCEPTION");
  });

  it("flags a delivery agent's visit-less day as reference only, with no deduction implied", () => {
    const row = run({
      employees: [employee({ employmentNumber: "137", tracking: "DELIVERY", role: "Delivery Agent" })],
      attendance: [
        {
          employmentNumber: "137",
          date: "2026-09-07",
          entryTime: "2026-09-07T06:00:00.000Z",
          exitTime: "2026-09-07T14:00:00.000Z",
          missingStatus: "complete",
          suspicious: false,
        },
      ],
      visits: [{ employmentNumber: "137", date: "2026-09-07", count: 0 }],
    }).find((r) => r.date === "2026-09-07")!;
    expect(row.state).toBe("PRESENT");
    const flag = row.flags.find((f) => f.code === "NO_BRICKS_VISITS")!;
    expect(flag.reference).toBe(true);
  });
});

describe("days nobody is expected in", () => {
  it("marks the weekly days off rather than queuing them", () => {
    const rows = reconcile({
      from: "2026-09-11", // Friday
      to: "2026-09-12", // Saturday
      employees: [employee()],
      attendance: [],
      timeoff: [],
      visits: [],
      today: TODAY,
    });
    expect(rows.map((r) => r.state)).toEqual(["DAY_OFF", "DAY_OFF"]);
  });

  it("marks a public holiday", () => {
    const rows = reconcile({
      from: "2026-10-06",
      to: "2026-10-06",
      employees: [employee()],
      attendance: [],
      timeoff: [],
      visits: [],
      today: "2026-10-20",
    });
    expect(rows[0].state).toBe("HOLIDAY");
    expect(rows[0].detail).toBe("Armed Forces Day");
  });

  it("skips future dates", () => {
    const rows = reconcile({
      from: "2026-09-16",
      to: "2026-09-20",
      employees: [employee()],
      attendance: [],
      timeoff: [],
      visits: [],
      today: "2026-09-17",
    });
    expect(rows.map((r) => r.date)).toEqual(["2026-09-16", "2026-09-17"]);
  });
});

describe("who the rules touch", () => {
  it("produces nothing at all for an excluded employee", () => {
    expect(run({ employees: [employee({ employmentNumber: "101", excluded: true })] })).toHaveLength(0);
  });

  it("does not count days before hiring or after termination as absences", () => {
    const rows = run({
      employees: [employee({ hiringDate: "2026-09-08", terminationDate: "2026-09-08" })],
    });
    expect(rows.map((r) => r.state)).toEqual(["NOT_EMPLOYED", "EXCEPTION", "NOT_EMPLOYED"]);
  });

  it("leaves out days already pushed to ZenHR so a second pass cannot double-charge", () => {
    const rows = run({ alreadyApplied: new Set(["124|2026-09-08"]) });
    expect(rows.map((r) => r.date)).toEqual(["2026-09-07", "2026-09-09"]);
  });
});

describe("summary and leave arithmetic", () => {
  it("counts the queue and the resolved days separately", () => {
    const rows = run({
      attendance: [
        {
          employmentNumber: "124",
          date: "2026-09-07",
          entryTime: "2026-09-07T06:00:00.000Z",
          exitTime: "2026-09-07T14:00:00.000Z",
          missingStatus: "complete",
          suspicious: false,
        },
      ],
    });
    const summary = summarise(rows);
    expect(summary).toMatchObject({ totalRows: 3, present: 1, exceptions: 2 });
  });

  it("falls to annual only once emergency cannot cover the day", () => {
    expect(preferredBucket(1, 3)).toBe("EMERGENCY");
    expect(preferredBucket(1, 0.5)).toBe("ANNUAL");
    expect(preferredBucket(0.5, 0.5)).toBe("EMERGENCY");
  });

  it("converts hourly leave at eight hours to the day", () => {
    expect(daysForHours(8)).toBe(1);
    expect(daysForHours(4)).toBe(0.5);
    expect(daysForHours(2)).toBe(0.25);
  });
});
