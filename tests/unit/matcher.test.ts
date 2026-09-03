import { describe, it, expect } from "vitest";
import { buildVariantIndex, resolveMatch } from "../../app/domain/mapping/matcher";
import { selectPricingRule, type SelectableRule } from "../../app/domain/pricing/rules";

const index = buildVariantIndex([
  { variantId: "v1", skuNormalized: "abc-100", barcodeNormalized: "111" },
  { variantId: "v2", skuNormalized: "abc-200", barcodeNormalized: "222" },
  { variantId: "v3", skuNormalized: "dup", barcodeNormalized: "333" },
  { variantId: "v4", skuNormalized: "dup", barcodeNormalized: "444" },
]);

describe("resolveMatch", () => {
  it("honors an explicit mapping first", () => {
    const r = resolveMatch(
      { supplierSkuNormalized: "abc-100", barcodeNormalized: null, explicit: { variantId: "v2", status: "matched" }, barcodeMatchingEnabled: false },
      index,
    );
    expect(r.variantId).toBe("v2");
    expect(r.matchMethod).toBe("explicit");
  });
  it("honors an explicit ignore", () => {
    const r = resolveMatch(
      { supplierSkuNormalized: "abc-100", barcodeNormalized: null, explicit: { variantId: null, status: "ignored" }, barcodeMatchingEnabled: false },
      index,
    );
    expect(r.status).toBe("ignored");
  });
  it("exact SKU match", () => {
    const r = resolveMatch(
      { supplierSkuNormalized: "abc-200", barcodeNormalized: null, barcodeMatchingEnabled: false },
      index,
    );
    expect(r).toMatchObject({ variantId: "v2", status: "matched", matchMethod: "exact_sku" });
  });
  it("duplicate normalized SKU is ambiguous", () => {
    const r = resolveMatch(
      { supplierSkuNormalized: "dup", barcodeNormalized: null, barcodeMatchingEnabled: false },
      index,
    );
    expect(r.status).toBe("ambiguous");
    expect(r.candidateVariantIds.sort()).toEqual(["v3", "v4"]);
  });
  it("barcode match only when enabled", () => {
    const off = resolveMatch(
      { supplierSkuNormalized: "not-here", barcodeNormalized: "222", barcodeMatchingEnabled: false },
      index,
    );
    expect(off.status).toBe("unmatched");
    const on = resolveMatch(
      { supplierSkuNormalized: "not-here", barcodeNormalized: "222", barcodeMatchingEnabled: true },
      index,
    );
    expect(on).toMatchObject({ variantId: "v2", matchMethod: "exact_barcode" });
  });
  it("unmatched when nothing hits", () => {
    expect(
      resolveMatch({ supplierSkuNormalized: "zzz", barcodeNormalized: null, barcodeMatchingEnabled: false }, index)
        .status,
    ).toBe("unmatched");
  });
});

describe("selectPricingRule", () => {
  const mk = (o: Partial<SelectableRule>): SelectableRule => ({
    id: "r",
    supplierId: null,
    priority: 100,
    vendorFilter: null,
    productTypeFilter: null,
    active: true,
    minimumMarginPercent: 0,
    markupPercent: 0,
    fixedHandlingPerUnit: 0,
    dutyPercent: 0,
    otherCostPercent: 0,
    roundingRule: "none",
    minimumPrice: null,
    maximumPrice: null,
    ...o,
  });

  it("lower priority number wins", () => {
    const rules = [mk({ id: "a", priority: 200 }), mk({ id: "b", priority: 10 })];
    expect(selectPricingRule(rules, { supplierId: "s1", vendor: null, productType: null })?.id).toBe("b");
  });
  it("supplier-specific beats shop-wide at equal priority", () => {
    const rules = [mk({ id: "wide", supplierId: null }), mk({ id: "specific", supplierId: "s1" })];
    expect(selectPricingRule(rules, { supplierId: "s1", vendor: null, productType: null })?.id).toBe("specific");
  });
  it("respects vendor filter", () => {
    const rules = [mk({ id: "acme", vendorFilter: "Acme" }), mk({ id: "fallback" })];
    expect(selectPricingRule(rules, { supplierId: "s1", vendor: "acme", productType: null })?.id).toBe("acme");
    expect(selectPricingRule(rules, { supplierId: "s1", vendor: "Other", productType: null })?.id).toBe("fallback");
  });
  it("ignores inactive rules and other suppliers", () => {
    const rules = [mk({ id: "off", active: false, priority: 1 }), mk({ id: "other", supplierId: "s2", priority: 1 }), mk({ id: "ok" })];
    expect(selectPricingRule(rules, { supplierId: "s1", vendor: null, productType: null })?.id).toBe("ok");
  });
  it("returns null when nothing matches", () => {
    expect(selectPricingRule([mk({ supplierId: "s2" })], { supplierId: "s1", vendor: null, productType: null })).toBeNull();
  });
});
