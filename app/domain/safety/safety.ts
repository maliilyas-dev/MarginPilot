/**
 * Per-row safety classification (spec 5.7).
 *
 * `blocked` != `warning`. A blocked row cannot be selected for apply until the
 * merchant resolves the underlying data or explicitly overrides that specific
 * policy. This module is pure: it takes numbers + policy, returns a
 * classification and reason codes. Run-level gates (invalid-row rate, row-count
 * drop) live in `evaluateRunGates`.
 */
import { Decimal, toDecimal, marginPercent } from "../money/money";
import { ReasonCode, type ReasonCodeValue } from "./reasonCodes";

export type Classification = "unchanged" | "safe" | "warning" | "blocked" | "invalid" | "unmatched";

export interface SafetyPolicyInput {
  maxPriceDecreasePercent: Decimal.Value;
  maxPriceIncreasePercent: Decimal.Value;
  maxInventoryChangePercent: Decimal.Value;
  maxInventoryAbsoluteChange: number;
  allowZeroCost: boolean;
}

export interface RowSafetyInput {
  mappingStatus: "matched" | "unmatched" | "ambiguous" | "ignored";
  rowValid: boolean;
  updateInventory: boolean;
  updatePrice: boolean;

  supplierUnitCost: Decimal.Value | null;
  landedCost: Decimal.Value | null;
  currentPrice: Decimal.Value | null;
  recommendedPrice: Decimal.Value | null;
  minimumMarginPercent: Decimal.Value | null;

  currentQuantity: number | null;
  proposedQuantity: number | null;
}

export interface RowSafetyResult {
  classification: Classification;
  reasonCodes: ReasonCodeValue[];
}

export function classifyRow(input: RowSafetyInput, policy: SafetyPolicyInput): RowSafetyResult {
  const reasons: ReasonCodeValue[] = [];

  if (input.mappingStatus === "ignored") {
    return { classification: "unchanged", reasonCodes: [ReasonCode.UNCHANGED] };
  }
  if (input.mappingStatus === "unmatched") {
    return { classification: "unmatched", reasonCodes: [ReasonCode.SKU_UNMATCHED] };
  }
  if (input.mappingStatus === "ambiguous") {
    return { classification: "unmatched", reasonCodes: [ReasonCode.SKU_AMBIGUOUS] };
  }
  if (!input.rowValid) {
    return { classification: "invalid", reasonCodes: [] };
  }

  const cost = toDecimal(input.supplierUnitCost);
  const landed = toDecimal(input.landedCost);
  const current = toDecimal(input.currentPrice);
  const recommended = toDecimal(input.recommendedPrice);

  let blocked = false;

  // ---- Cost / price sanity ----
  if (input.updatePrice) {
    if (cost && cost.lt(0)) {
      reasons.push(ReasonCode.NEGATIVE_COST);
      blocked = true;
    }
    if (cost && cost.isZero() && !policy.allowZeroCost) {
      reasons.push(ReasonCode.ZERO_COST_BLOCKED);
      blocked = true;
    }
    if (!recommended || recommended.lte(0)) {
      reasons.push(ReasonCode.ZERO_RECOMMENDED_PRICE);
      blocked = true;
    }

    if (recommended && recommended.gt(0) && landed) {
      const minMargin = toDecimal(input.minimumMarginPercent);
      if (minMargin) {
        const m = marginPercent(recommended, landed);
        if (m && m.lt(minMargin)) {
          reasons.push(ReasonCode.MARGIN_BELOW_MINIMUM);
          blocked = true;
        }
      }
    }

    if (recommended && recommended.gt(0) && current && current.gt(0)) {
      const deltaPct = recommended.minus(current).dividedBy(current).times(100);
      const maxInc = new Decimal(policy.maxPriceIncreasePercent);
      const maxDec = new Decimal(policy.maxPriceDecreasePercent);
      if (deltaPct.gt(maxInc)) {
        reasons.push(ReasonCode.PRICE_INCREASE_THRESHOLD);
        blocked = true;
      }
      if (deltaPct.lt(maxDec.negated())) {
        reasons.push(ReasonCode.PRICE_DECREASE_THRESHOLD);
        blocked = true;
      }
    }
  }

  // ---- Inventory sanity ----
  if (input.updateInventory) {
    const q = input.proposedQuantity;
    if (q === null || !Number.isInteger(q)) {
      reasons.push(ReasonCode.INVALID_QUANTITY);
      blocked = true;
    } else if (q < 0) {
      reasons.push(ReasonCode.NEGATIVE_QUANTITY);
      blocked = true;
    } else if (input.currentQuantity !== null) {
      const absChange = Math.abs(q - input.currentQuantity);
      if (absChange > policy.maxInventoryAbsoluteChange) {
        reasons.push(ReasonCode.INVENTORY_CHANGE_THRESHOLD);
        blocked = true;
      } else if (input.currentQuantity > 0) {
        const pct = (absChange / input.currentQuantity) * 100;
        if (pct > new Decimal(policy.maxInventoryChangePercent).toNumber()) {
          reasons.push(ReasonCode.INVENTORY_CHANGE_THRESHOLD);
          blocked = true;
        }
      }
    }
  }

  if (blocked) {
    return { classification: "blocked", reasonCodes: dedupe(reasons) };
  }

  // ---- Determine if anything actually changes ----
  const priceChanges =
    input.updatePrice && recommended !== null && current !== null && !recommended.equals(current);
  const inventoryChanges =
    input.updateInventory &&
    input.proposedQuantity !== null &&
    input.currentQuantity !== null &&
    input.proposedQuantity !== input.currentQuantity;

  if (!priceChanges && !inventoryChanges) {
    return { classification: "unchanged", reasonCodes: [ReasonCode.UNCHANGED] };
  }

  return { classification: "safe", reasonCodes: [ReasonCode.SAFE_UPDATE] };
}

function dedupe<T>(arr: T[]): T[] {
  return Array.from(new Set(arr));
}

// ---------------------------------------------------------------------------
// Run-level gates
// ---------------------------------------------------------------------------

export interface RunGateInput {
  totalRows: number;
  invalidRows: number;
  previousSuccessfulRowCount: number | null;
  maxInvalidRowPercent: Decimal.Value;
  maxRowCountDecreasePercent: Decimal.Value;
  rowCountDropConfirmed: boolean;
}

export interface RunGateResult {
  blockRun: boolean;
  reasonCodes: ReasonCodeValue[];
}

export function evaluateRunGates(input: RunGateInput): RunGateResult {
  const reasons: ReasonCodeValue[] = [];

  if (input.totalRows > 0) {
    const invalidPct = (input.invalidRows / input.totalRows) * 100;
    if (invalidPct > new Decimal(input.maxInvalidRowPercent).toNumber()) {
      reasons.push(ReasonCode.INVALID_ROW_RATE_THRESHOLD);
    }
  }

  if (
    input.previousSuccessfulRowCount !== null &&
    input.previousSuccessfulRowCount > 0 &&
    !input.rowCountDropConfirmed
  ) {
    const dropPct =
      ((input.previousSuccessfulRowCount - input.totalRows) /
        input.previousSuccessfulRowCount) *
      100;
    if (dropPct > new Decimal(input.maxRowCountDecreasePercent).toNumber()) {
      reasons.push(ReasonCode.ROW_COUNT_DROP_THRESHOLD);
    }
  }

  return { blockRun: reasons.length > 0, reasonCodes: reasons };
}
