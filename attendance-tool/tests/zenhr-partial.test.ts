import { describe, expect, it } from "vitest";
import { isPartialDay, zenhrTime } from "../src/lib/pull";

// Shapes taken from a live ZenHR account.
describe("telling an hourly permission from a whole day", () => {
  it("reads a four-hour permission as partial", () => {
    expect(isPartialDay("2026-09-07T16:00:00.000+03:00", "2026-09-07T20:00:00.000+03:00")).toBe(true);
    expect(isPartialDay("2026-09-03T13:00:00.000+03:00", "2026-09-03T17:00:00.000+03:00")).toBe(true);
  });

  it("reads midnight to midnight as a whole day", () => {
    expect(isPartialDay("2026-09-03T00:00:00.000+03:00", "2026-09-03T00:00:00.000+03:00")).toBe(false);
  });

  it("never calls a multi-day transaction partial", () => {
    expect(isPartialDay("2026-09-01T09:00:00.000+03:00", "2026-09-05T17:00:00.000+03:00")).toBe(false);
  });

  it("extracts the times for display", () => {
    expect(zenhrTime("2026-09-07T16:00:00.000+03:00")).toBe("16:00");
    expect(zenhrTime("")).toBeNull();
  });
});
