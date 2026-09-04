import { describe, expect, it } from "vitest";
import { computeProgress, formatDuration } from "../../app/domain/progress";

describe("formatDuration", () => {
  it("formats sub-minute", () => {
    expect(formatDuration(4200)).toBe("4s");
    expect(formatDuration(59_000)).toBe("59s");
    expect(formatDuration(200)).toBe("1s"); // never 0s
  });
  it("formats minutes and hours", () => {
    expect(formatDuration(60_000)).toBe("1m");
    expect(formatDuration(100_000)).toBe("1m 40s");
    expect(formatDuration(3_600_000)).toBe("1h");
    expect(formatDuration(3_780_000)).toBe("1h 3m");
  });
});

describe("computeProgress", () => {
  const start = new Date("2026-09-04T12:00:00.000Z");

  it("computes percent and count label", () => {
    const now = start.getTime() + 10_000;
    const v = computeProgress(
      { phase: "Reading products", done: 30, total: 120, startedAt: start, active: true },
      now,
    );
    expect(v.percent).toBe(25);
    expect(v.countLabel).toBe("30 of 120");
    expect(v.elapsedLabel).toBe("10s");
  });

  it("estimates ETA by linear extrapolation once past the warmup", () => {
    const now = start.getTime() + 20_000; // 20s in, 40 of 200 done
    const v = computeProgress(
      { phase: "Applying", done: 40, total: 200, startedAt: start, active: true },
      now,
    );
    // 20s for 40 -> 0.5s/item -> 160 left -> ~80s
    expect(v.etaMs).toBeGreaterThan(70_000);
    expect(v.etaMs).toBeLessThan(90_000);
    expect(v.etaLabel).toContain("left");
  });

  it("gives no ETA during warmup or when done", () => {
    const early = computeProgress(
      { phase: "x", done: 1, total: 100, startedAt: start, active: true },
      start.getTime() + 500,
    );
    expect(early.etaMs).toBeNull();

    const finished = computeProgress(
      {
        phase: "Done",
        done: 100,
        total: 100,
        startedAt: start,
        finishedAt: new Date(start.getTime() + 30_000),
        active: false,
      },
      start.getTime() + 999_999,
    );
    expect(finished.percent).toBe(100);
    expect(finished.etaMs).toBeNull();
    expect(finished.elapsedLabel).toBe("30s");
  });
});
