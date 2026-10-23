import { describe, expect, it } from "vitest";
import { formatBps, formatDate, formatDateTime, truncateAddress } from "./format";

// Noon UTC keeps the calendar date the same in every time zone from UTC-11 to UTC+11.
const JAN_15_2024_NOON_UTC = Date.UTC(2024, 0, 15, 12) / 1000;

describe("formatDate", () => {
  it("formats a Unix timestamp in seconds as a short date", () => {
    expect(formatDate(JAN_15_2024_NOON_UTC, "en-US")).toBe("Jan 15, 2024");
  });

  it("uses the locale it is given", () => {
    expect(formatDate(JAN_15_2024_NOON_UTC, "de-DE")).toMatch(/15/);
  });
});

describe("formatDateTime", () => {
  it("includes the date and the time", () => {
    const text = formatDateTime(JAN_15_2024_NOON_UTC, "en-US");
    expect(text).toContain("2024");
    expect(text).toMatch(/\d{1,2}:\d{2}/);
  });
});

describe("formatBps", () => {
  it("converts basis points to a percentage with two digits by default", () => {
    expect(formatBps(1250)).toBe("12.50%");
  });

  it("respects the requested number of fraction digits", () => {
    expect(formatBps(10_000, 1)).toBe("100.0%");
  });

  it("handles zero", () => {
    expect(formatBps(0)).toBe("0.00%");
  });
});

describe("truncateAddress", () => {
  it("returns an empty string for an empty input", () => {
    expect(truncateAddress("")).toBe("");
  });
});
