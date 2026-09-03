/**
 * Monetary + decimal arithmetic helpers.
 *
 * Never use raw floating point for money anywhere in MarginPilot. Every
 * calculation that feeds a price, cost, or margin must go through decimal.js.
 */
import Decimal from "decimal.js";

// 28 significant digits is plenty for retail money math; ROUND_HALF_UP matches
// common merchant expectations for currency rounding.
Decimal.set({ precision: 28, rounding: Decimal.ROUND_HALF_UP });

export type DecimalInput = Decimal.Value | null | undefined;

export function toDecimal(value: DecimalInput): Decimal | null {
  if (value === null || value === undefined || value === "") return null;
  try {
    const d = new Decimal(value as Decimal.Value);
    return d.isFinite() ? d : null;
  } catch {
    return null;
  }
}

/** Parse and require a finite decimal, throwing on bad input. */
export function requireDecimal(value: DecimalInput, label = "value"): Decimal {
  const d = toDecimal(value);
  if (d === null) throw new Error(`Invalid ${label}: ${String(value)}`);
  return d;
}

/** Round to a currency scale (default 2 dp) and return a fixed string. */
export function money(value: DecimalInput, dp = 2): string {
  const d = toDecimal(value);
  if (d === null) return (0).toFixed(dp);
  return d.toDecimalPlaces(dp, Decimal.ROUND_HALF_UP).toFixed(dp);
}

/** Gross margin percent = (price - cost) / price * 100. Null when price <= 0. */
export function marginPercent(price: DecimalInput, cost: DecimalInput): Decimal | null {
  const p = toDecimal(price);
  const c = toDecimal(cost);
  if (p === null || c === null) return null;
  if (p.lte(0)) return null;
  return p.minus(c).dividedBy(p).times(100);
}

/** Gross profit = price - cost. */
export function grossProfit(price: DecimalInput, cost: DecimalInput): Decimal | null {
  const p = toDecimal(price);
  const c = toDecimal(cost);
  if (p === null || c === null) return null;
  return p.minus(c);
}

export { Decimal };
