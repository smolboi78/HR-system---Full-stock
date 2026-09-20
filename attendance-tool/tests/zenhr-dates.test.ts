import { describe, expect, it } from "vitest";
import { zenhrDate } from "../src/lib/pull";

// ZenHR returns transaction dates in two shapes, and naively slicing the
// string is right for one and a day out for the other. A day out means leave
// lands on the wrong date, so the day actually booked reads as an absence.
describe("reading ZenHR transaction dates", () => {
  it("trusts the written date when the timestamp carries its own offset", () => {
    expect(zenhrDate("2026-09-08T00:00:00.000+03:00")).toBe("2026-09-08");
    expect(zenhrDate("2026-09-08T00:00:00.000+02:00")).toBe("2026-09-08");
  });

  it("converts a UTC timestamp to the branch's day, not the UTC one", () => {
    // Cairo midnight on the 9th is 21:00Z on the 8th. Slicing the string
    // would call this the 8th and shift the whole leave period back a day.
    expect(zenhrDate("2026-09-08T21:00:00.000Z")).toBe("2026-09-09");
    expect(zenhrDate("2026-09-08T22:00:00.000Z")).toBe("2026-09-09");
  });

  it("keeps a midday UTC timestamp on its own day", () => {
    expect(zenhrDate("2026-09-08T12:00:00.000Z")).toBe("2026-09-08");
  });

  it("falls back to the leading date rather than throwing on something odd", () => {
    expect(zenhrDate("2026-09-08")).toBe("2026-09-08");
    expect(zenhrDate("")).toBe("");
  });
});
