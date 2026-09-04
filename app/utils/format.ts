/**
 * Pinned-locale, pinned-timezone date/number formatting.
 *
 * `Date.prototype.toLocaleString()` (and `Number.prototype.toLocaleString()`)
 * without an explicit locale/timeZone read the *runtime's* defaults — which
 * differ between the Node server (a UTC container) and the merchant's
 * browser (their own locale/timezone). Server and client then render
 * different text for the same value, which React treats as a hydration
 * mismatch (error #418) and aborts hydration — breaking event handlers on
 * anything caught in the crash, including App Bridge's primary-action slot.
 * Pin both here so server-rendered and client-hydrated HTML always match.
 */
const LOCALE = "en-US";
const TIME_ZONE = "UTC";

function toDate(value: string | number | Date | null | undefined): Date | null {
  if (value === null || value === undefined) return null;
  const d = value instanceof Date ? value : new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

export function formatDateTime(value: string | number | Date | null | undefined): string {
  const d = toDate(value);
  if (!d) return "—";
  return `${d.toLocaleString(LOCALE, { timeZone: TIME_ZONE, dateStyle: "medium", timeStyle: "short" })} UTC`;
}

export function formatDate(value: string | number | Date | null | undefined): string {
  const d = toDate(value);
  if (!d) return "—";
  return d.toLocaleDateString(LOCALE, { timeZone: TIME_ZONE, dateStyle: "medium" });
}

export function formatNumber(n: number): string {
  return n.toLocaleString(LOCALE);
}

export function formatMoney(n: number): string {
  return n.toLocaleString(LOCALE, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
