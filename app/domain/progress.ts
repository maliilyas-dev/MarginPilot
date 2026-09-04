/**
 * Job progress + ETA maths and formatting. Pure, testable.
 *
 * Used for the Matrixify-style "Reading products · 120 of 300 · ~1m 40s left"
 * readouts on catalog sync, feed runs and change apply.
 */
import { formatNumber } from "../utils/format";

export interface ProgressInput {
  phase: string | null;
  done: number;
  total: number;
  /** ISO string or Date for when work started */
  startedAt: string | Date | null;
  /** ISO string or Date for when work finished (null while running) */
  finishedAt?: string | Date | null;
  /** whether the job is still active */
  active: boolean;
}

export interface ProgressView {
  phase: string | null;
  done: number;
  total: number;
  /** 0..100, integer */
  percent: number;
  elapsedMs: number;
  /** null when it can't be estimated yet */
  etaMs: number | null;
  elapsedLabel: string;
  etaLabel: string | null;
  /** "120 of 300" or "120" when total unknown */
  countLabel: string;
}

function ms(value: string | Date | null | undefined): number | null {
  if (!value) return null;
  const t = value instanceof Date ? value.getTime() : Date.parse(value);
  return Number.isFinite(t) ? t : null;
}

/** "1m 40s", "45s", "2h 3m". Rounds sensibly; never shows "0s". */
export function formatDuration(milliseconds: number): string {
  const s = Math.max(0, Math.round(milliseconds / 1000));
  if (s < 60) return `${Math.max(1, s)}s`;
  const m = Math.floor(s / 60);
  const rem = s % 60;
  if (m < 60) return rem ? `${m}m ${rem}s` : `${m}m`;
  const h = Math.floor(m / 60);
  const mr = m % 60;
  return mr ? `${h}h ${mr}m` : `${h}h`;
}

export function computeProgress(input: ProgressInput, now: number = Date.now()): ProgressView {
  const startMs = ms(input.startedAt ?? null);
  const endMs = ms(input.finishedAt ?? null);
  const total = Math.max(0, Math.floor(input.total));
  const done = Math.min(total || Number.MAX_SAFE_INTEGER, Math.max(0, Math.floor(input.done)));

  const elapsedMs = startMs === null ? 0 : (endMs ?? now) - startMs;
  const percent = total > 0 ? Math.min(100, Math.round((done / total) * 100)) : input.active ? 0 : 100;

  let etaMs: number | null = null;
  if (input.active && total > 0 && done > 0 && done < total && elapsedMs > 1500) {
    const perItem = elapsedMs / done;
    etaMs = Math.round(perItem * (total - done));
  }

  return {
    phase: input.phase,
    done,
    total,
    percent,
    elapsedMs,
    etaMs,
    elapsedLabel: formatDuration(elapsedMs),
    etaLabel: etaMs === null ? null : `~${formatDuration(etaMs)} left`,
    countLabel: total > 0 ? `${formatNumber(done)} of ${formatNumber(total)}` : formatNumber(done),
  };
}
