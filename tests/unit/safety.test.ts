import { describe, it, expect } from "vitest";
import { classifyRow, evaluateRunGates, type SafetyPolicyInput, type RowSafetyInput } from "../../app/domain/safety/safety";
import { ReasonCode } from "../../app/domain/safety/reasonCodes";

const policy: SafetyPolicyInput = {
  maxPriceDecreasePercent: 20,
  maxPriceIncreasePercent: 50,
  maxInventoryChangePercent: 90,
  maxInventoryAbsoluteChange: 1000,
  allowZeroCost: false,
};

const baseRow: RowSafetyInput = {
  mappingStatus: "matched",
  rowValid: true,
  updateInventory: true,
  updatePrice: true,
  supplierUnitCost: 10,
  landedCost: 10,
  currentPrice: 20,
  recommendedPrice: 20,
  minimumMarginPercent: 0,
  currentQuantity: 5,
  proposedQuantity: 5,
};

describe("classifyRow — mapping states", () => {
  it("unmatched", () => {
    expect(classifyRow({ ...baseRow, mappingStatus: "unmatched" }, policy).classification).toBe("unmatched");
  });
  it("ambiguous is not selectable (unmatched bucket)", () => {
    const r = classifyRow({ ...baseRow, mappingStatus: "ambiguous" }, policy);
    expect(r.classification).toBe("unmatched");
    expect(r.reasonCodes).toContain(ReasonCode.SKU_AMBIGUOUS);
  });
  it("invalid row", () => {
    expect(classifyRow({ ...baseRow, rowValid: false }, policy).classification).toBe("invalid");
  });
});

describe("classifyRow — blocks", () => {
  it("blocks negative cost", () => {
    const r = classifyRow({ ...baseRow, supplierUnitCost: -1, landedCost: -1 }, policy);
    expect(r.classification).toBe("blocked");
    expect(r.reasonCodes).toContain(ReasonCode.NEGATIVE_COST);
  });
  it("blocks zero cost unless allowed", () => {
    expect(classifyRow({ ...baseRow, supplierUnitCost: 0, landedCost: 0, recommendedPrice: 20 }, policy).reasonCodes).toContain(
      ReasonCode.ZERO_COST_BLOCKED,
    );
    expect(
      classifyRow(
        { ...baseRow, supplierUnitCost: 0, landedCost: 0, recommendedPrice: 20 },
        { ...policy, allowZeroCost: true },
      ).reasonCodes,
    ).not.toContain(ReasonCode.ZERO_COST_BLOCKED);
  });
  it("blocks zero recommended price", () => {
    expect(classifyRow({ ...baseRow, recommendedPrice: 0 }, policy).reasonCodes).toContain(
      ReasonCode.ZERO_RECOMMENDED_PRICE,
    );
  });
  it("blocks price increase over 50% (boundary: 50% exactly is safe)", () => {
    expect(classifyRow({ ...baseRow, currentPrice: 20, recommendedPrice: 30 }, policy).classification).toBe("safe");
    expect(classifyRow({ ...baseRow, currentPrice: 20, recommendedPrice: 30.01 }, policy).reasonCodes).toContain(
      ReasonCode.PRICE_INCREASE_THRESHOLD,
    );
  });
  it("blocks price decrease over 20%", () => {
    expect(classifyRow({ ...baseRow, currentPrice: 20, recommendedPrice: 16 }, policy).classification).toBe("safe");
    expect(classifyRow({ ...baseRow, currentPrice: 20, recommendedPrice: 15.99 }, policy).reasonCodes).toContain(
      ReasonCode.PRICE_DECREASE_THRESHOLD,
    );
  });
  it("blocks margin below minimum", () => {
    const r = classifyRow(
      { ...baseRow, landedCost: 18, recommendedPrice: 20, minimumMarginPercent: 30, currentPrice: 20 },
      policy,
    );
    expect(r.reasonCodes).toContain(ReasonCode.MARGIN_BELOW_MINIMUM);
  });
  it("blocks negative quantity", () => {
    expect(classifyRow({ ...baseRow, proposedQuantity: -3 }, policy).reasonCodes).toContain(
      ReasonCode.NEGATIVE_QUANTITY,
    );
  });
  it("blocks inventory absolute change over limit", () => {
    expect(
      classifyRow({ ...baseRow, currentQuantity: 0, proposedQuantity: 5000 }, policy).reasonCodes,
    ).toContain(ReasonCode.INVENTORY_CHANGE_THRESHOLD);
  });
});

describe("classifyRow — safe / unchanged", () => {
  it("safe when a real change passes checks", () => {
    expect(classifyRow({ ...baseRow, recommendedPrice: 22, currentPrice: 20 }, policy).classification).toBe("safe");
  });
  it("unchanged when nothing moves", () => {
    expect(
      classifyRow({ ...baseRow, recommendedPrice: 20, currentPrice: 20, proposedQuantity: 5, currentQuantity: 5 }, policy)
        .classification,
    ).toBe("unchanged");
  });
});

describe("evaluateRunGates", () => {
  it("blocks when invalid-row rate exceeds 10%", () => {
    expect(
      evaluateRunGates({
        totalRows: 100,
        invalidRows: 11,
        previousSuccessfulRowCount: null,
        maxInvalidRowPercent: 10,
        maxRowCountDecreasePercent: 50,
        rowCountDropConfirmed: false,
      }).blockRun,
    ).toBe(true);
  });
  it("10% exactly is allowed", () => {
    expect(
      evaluateRunGates({
        totalRows: 100,
        invalidRows: 10,
        previousSuccessfulRowCount: null,
        maxInvalidRowPercent: 10,
        maxRowCountDecreasePercent: 50,
        rowCountDropConfirmed: false,
      }).blockRun,
    ).toBe(false);
  });
  it("blocks a >50% row-count drop unless confirmed", () => {
    const args = {
      totalRows: 40,
      invalidRows: 0,
      previousSuccessfulRowCount: 100,
      maxInvalidRowPercent: 10,
      maxRowCountDecreasePercent: 50,
      rowCountDropConfirmed: false,
    };
    expect(evaluateRunGates(args).reasonCodes).toContain(ReasonCode.ROW_COUNT_DROP_THRESHOLD);
    expect(evaluateRunGates({ ...args, rowCountDropConfirmed: true }).blockRun).toBe(false);
  });
});
