/**
 * Landed cost and recommended price calculation (spec 5.6).
 *
 *   landedCost = supplierUnitCost
 *              + freightPerUnit
 *              + fixedHandlingPerUnit
 *              + supplierUnitCost * dutyPercent/100
 *              + supplierUnitCost * otherCostPercent/100
 *
 *   minimumSafePrice = landedCost / (1 - minimumMarginPercent/100)
 *   markupPrice       = landedCost * (1 + markupPercent/100)
 *   recommendedPrice  = max(minimumSafePrice, markupPrice)  then rounded, then clamped
 */
import { Decimal, toDecimal } from "../money/money";

export type RoundingRule = "none" | "whole" | "end_99" | "end_95" | "end_97";

export interface PricingRuleInput {
  minimumMarginPercent: Decimal.Value;
  markupPercent: Decimal.Value;
  fixedHandlingPerUnit: Decimal.Value;
  dutyPercent: Decimal.Value;
  otherCostPercent: Decimal.Value;
  roundingRule: RoundingRule;
  minimumPrice?: Decimal.Value | null;
  maximumPrice?: Decimal.Value | null;
}

export interface LandedCostInput {
  supplierUnitCost: Decimal.Value;
  freightPerUnit?: Decimal.Value | null;
}

export interface PriceComputation {
  landedCost: Decimal;
  minimumSafePrice: Decimal;
  markupPrice: Decimal;
  recommendedPriceRaw: Decimal;
  recommendedPrice: Decimal;
  clampedToMin: boolean;
  clampedToMax: boolean;
}

export function computeLandedCost(input: LandedCostInput, rule: PricingRuleInput): Decimal {
  const cost = new Decimal(input.supplierUnitCost);
  const freight = toDecimal(input.freightPerUnit ?? 0) ?? new Decimal(0);
  const handling = new Decimal(rule.fixedHandlingPerUnit);
  const duty = cost.times(new Decimal(rule.dutyPercent)).dividedBy(100);
  const other = cost.times(new Decimal(rule.otherCostPercent)).dividedBy(100);
  return cost.plus(freight).plus(handling).plus(duty).plus(other);
}

/** Apply a rounding rule to a price. Operates on the integer/decimal boundary. */
export function applyRounding(price: Decimal, rule: RoundingRule): Decimal {
  if (price.lte(0)) return price;
  switch (rule) {
    case "none":
      return price.toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
    case "whole":
      return price.toDecimalPlaces(0, Decimal.ROUND_HALF_UP);
    case "end_99":
    case "end_95":
    case "end_97": {
      const ending = rule === "end_99" ? 0.99 : rule === "end_95" ? 0.95 : 0.97;
      // Round up to the next X.ending that is >= price so we never dip below
      // the margin-safe figure.
      const floorInt = price.floor();
      const candidate = floorInt.plus(ending);
      if (candidate.gte(price)) return candidate;
      return floorInt.plus(1).plus(ending);
    }
    default:
      return price.toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
  }
}

export function computeRecommendedPrice(
  landed: LandedCostInput,
  rule: PricingRuleInput,
): PriceComputation {
  const landedCost = computeLandedCost(landed, rule);

  const minMargin = new Decimal(rule.minimumMarginPercent);
  const denom = new Decimal(1).minus(minMargin.dividedBy(100));
  // Guard: margin >= 100 is rejected upstream by validation; still be safe.
  const minimumSafePrice = denom.lte(0)
    ? landedCost.times(1000)
    : landedCost.dividedBy(denom);

  const markupPrice = landedCost.times(
    new Decimal(1).plus(new Decimal(rule.markupPercent).dividedBy(100)),
  );

  const recommendedPriceRaw = Decimal.max(minimumSafePrice, markupPrice);
  let recommended = applyRounding(recommendedPriceRaw, rule.roundingRule);

  let clampedToMin = false;
  let clampedToMax = false;
  const min = toDecimal(rule.minimumPrice ?? null);
  const max = toDecimal(rule.maximumPrice ?? null);
  if (min && recommended.lt(min)) {
    recommended = min;
    clampedToMin = true;
  }
  if (max && recommended.gt(max)) {
    recommended = max;
    clampedToMax = true;
  }

  return {
    landedCost: landedCost.toDecimalPlaces(4, Decimal.ROUND_HALF_UP),
    minimumSafePrice: minimumSafePrice.toDecimalPlaces(4, Decimal.ROUND_HALF_UP),
    markupPrice: markupPrice.toDecimalPlaces(4, Decimal.ROUND_HALF_UP),
    recommendedPriceRaw: recommendedPriceRaw.toDecimalPlaces(4, Decimal.ROUND_HALF_UP),
    recommendedPrice: recommended.toDecimalPlaces(2, Decimal.ROUND_HALF_UP),
    clampedToMin,
    clampedToMax,
  };
}
