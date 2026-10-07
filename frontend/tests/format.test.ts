import { describe, expect, it } from "vitest";
import {
  dayBucket,
  formatBytes,
  formatCell,
  formatCount,
  formatDuration,
  formatPercent,
} from "../src/lib/format";

describe("formatBytes", () => {
  it("handles null and small values", () => {
    expect(formatBytes(null)).toBe("—");
    expect(formatBytes(0)).toBe("0 B");
    expect(formatBytes(500)).toBe("500 B");
  });

  it("scales up the byte units", () => {
    expect(formatBytes(1024)).toBe("1.0 KB");
    expect(formatBytes(1536)).toBe("1.5 KB");
    expect(formatBytes(1024 * 1024)).toBe("1.0 MB");
  });
});

describe("formatCount", () => {
  it("leaves small counts alone", () => {
    expect(formatCount(812)).toBe("812");
  });

  it("compacts large counts", () => {
    expect(formatCount(1000)).toBe("1.0K");
    expect(formatCount(12_400)).toBe("12.4K");
    expect(formatCount(24_000_000)).toBe("24.0M");
  });
});

describe("formatDuration", () => {
  it("formats milliseconds and seconds", () => {
    expect(formatDuration(500)).toBe("500ms");
    expect(formatDuration(1000)).toBe("1.00s");
    expect(formatDuration(2500)).toBe("2.50s");
  });

  it("formats minutes", () => {
    expect(formatDuration(65_000)).toBe("1m 5s");
  });
});

describe("formatPercent", () => {
  it("handles zero, tiny and normal values", () => {
    expect(formatPercent(0)).toBe("0%");
    expect(formatPercent(0.05)).toBe("<0.1%");
    expect(formatPercent(5.5)).toBe("5.5%");
    expect(formatPercent(15)).toBe("15%");
  });
});

describe("formatCell", () => {
  it("renders null, booleans and numbers", () => {
    expect(formatCell(null)).toBe("NULL");
    expect(formatCell(true)).toBe("true");
    expect(formatCell(1234)).toBe("1,234");
    expect(formatCell(1234.567)).toBe("1,234.57");
  });
});

describe("dayBucket", () => {
  it("puts the current instant in Today", () => {
    expect(dayBucket(Date.now() / 1000)).toBe("Today");
  });
});
