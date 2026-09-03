import { describe, it, expect } from "vitest";
import {
  computeLandedCost,
  computeRecommendedPrice,
  applyRounding,
  type PricingRuleInput,
} from "../../app/domain/pricing/pricing";
import { Decimal } from "../../app/domain/money/money";

const baseRule: PricingRuleInput = {
  minimumMarginPercent: 0,
  markupPercent: 0,
  fixedHandlingPerUnit: 0,
  dutyPercent: 0,
  otherCostPercent: 0,
  roundingRule: "none",
  minimumPrice: null,
  maximumPrice: null,
};

describe("computeLandedCost", () => {
  it("sums cost + freight + handling + duty% + other%", () => {
    const landed = computeLandedCost(
      { supplierUnitCost: 100, freightPerUnit: 5 },
      { ...baseRule, fixedHandlingPerUnit: 2, dutyPercent: 10, otherCostPercent: 5 },
    );
    // 100 + 5 + 2 + 10 + 5 = 122
    expect(landed.toNumber()).toBe(122);
  });
  it("handles missing freight as zero", () => {
    const landed = computeLandedCost({ supplierUnitCost: 10, freightPerUnit: null }, baseRule);
    expect(landed.toNumber()).toBe(10);
  });
  it("does not use floating point (0.1 + 0.2 case)", () => {
    const landed = computeLandedCost(
      { supplierUnitCost: 0.1, freightPerUnit: 0.2 },
      baseRule,
    );
    expect(landed.equals(new Decimal("0.3"))).toBe(true);
  });
});

describe("computeRecommendedPrice", () => {
  it("uses minimum-safe-price when margin rule dominates", () => {
    const r = computeRecommendedPrice(
      { supplierUnitCost: 60, freightPerUnit: 0 },
      { ...baseRule, minimumMarginPercent: 40, markupPercent: 10 },
    );
    // minSafe = 60 / (1 - 0.40) = 100 ; markup = 66 ; max => 100
    expect(r.recommendedPrice.toNumber()).toBe(100);
    expect(r.minimumSafePrice.toNumber()).toBe(100);
  });
  it("uses markup price when markup dominates", () => {
    const r = computeRecommendedPrice(
      { supplierUnitCost: 100, freightPerUnit: 0 },
      { ...baseRule, minimumMarginPercent: 10, markupPercent: 80 },
    );
    // minSafe = 100 / 0.9 = 111.11 ; markup = 180 ; max => 180
    expect(r.recommendedPrice.toNumber()).toBe(180);
  });
  it("clamps to minimumPrice", () => {
    const r = computeRecommendedPrice(
      { supplierUnitCost: 1, freightPerUnit: 0 },
      { ...baseRule, markupPercent: 0, minimumPrice: 9.99 },
    );
    expect(r.recommendedPrice.toNumber()).toBe(9.99);
    expect(r.clampedToMin).toBe(true);
  });
  it("clamps to maximumPrice", () => {
    const r = computeRecommendedPrice(
      { supplierUnitCost: 1000, freightPerUnit: 0 },
      { ...baseRule, markupPercent: 100, maximumPrice: 500 },
    );
    expect(r.recommendedPrice.toNumber()).toBe(500);
    expect(r.clampedToMax).toBe(true);
  });
});

describe("applyRounding", () => {
  const d = (n: string | number) => new Decimal(n);
  it("none keeps 2dp", () => {
    expect(applyRounding(d("12.345"), "none").toFixed(2)).toBe("12.35");
  });
  it("whole rounds to integer", () => {
    expect(applyRounding(d("12.4"), "whole").toNumber()).toBe(12);
    expect(applyRounding(d("12.5"), "whole").toNumber()).toBe(13);
  });
  it("end_99 rounds up to next .99 at or above price", () => {
    expect(applyRounding(d("12.10"), "end_99").toFixed(2)).toBe("12.99");
    expect(applyRounding(d("12.99"), "end_99").toFixed(2)).toBe("12.99");
    expect(applyRounding(d("13.00"), "end_99").toFixed(2)).toBe("13.99");
  });
  it("end_95 and end_97", () => {
    expect(applyRounding(d("12.10"), "end_95").toFixed(2)).toBe("12.95");
    expect(applyRounding(d("12.96"), "end_95").toFixed(2)).toBe("13.95");
    expect(applyRounding(d("12.10"), "end_97").toFixed(2)).toBe("12.97");
  });
  it("never rounds a positive price below the input", () => {
    for (const rule of ["end_99", "end_95", "end_97"] as const) {
      for (let cents = 0; cents < 100; cents++) {
        const p = d(`20.${String(cents).padStart(2, "0")}`);
        expect(applyRounding(p, rule).gte(p)).toBe(true);
      }
    }
  });
});
