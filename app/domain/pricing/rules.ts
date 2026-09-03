/**
 * Pricing-rule selection by priority (spec 5.6).
 *
 * Lower `priority` number wins. Optional vendor / productType filters must
 * match the Shopify variant's product when present. A rule with a supplierId
 * only applies to that supplier; a rule with supplierId == null is a shop-wide
 * fallback.
 */
import type { RoundingRule } from "./pricing";

export interface SelectableRule {
  id: string;
  supplierId: string | null;
  priority: number;
  vendorFilter: string | null;
  productTypeFilter: string | null;
  active: boolean;
  minimumMarginPercent: string | number;
  markupPercent: string | number;
  fixedHandlingPerUnit: string | number;
  dutyPercent: string | number;
  otherCostPercent: string | number;
  roundingRule: RoundingRule;
  minimumPrice: string | number | null;
  maximumPrice: string | number | null;
}

export interface RuleMatchContext {
  supplierId: string;
  vendor: string | null;
  productType: string | null;
}

function eqCi(a: string | null, b: string | null): boolean {
  if (a === null) return false;
  return a.trim().toLowerCase() === (b ?? "").trim().toLowerCase();
}

export function selectPricingRule(
  rules: SelectableRule[],
  ctx: RuleMatchContext,
): SelectableRule | null {
  const candidates = rules
    .filter((r) => r.active)
    .filter((r) => r.supplierId === null || r.supplierId === ctx.supplierId)
    .filter((r) => (r.vendorFilter ? eqCi(r.vendorFilter, ctx.vendor) : true))
    .filter((r) => (r.productTypeFilter ? eqCi(r.productTypeFilter, ctx.productType) : true));

  if (candidates.length === 0) return null;

  candidates.sort((a, b) => {
    if (a.priority !== b.priority) return a.priority - b.priority;
    // Supplier-specific beats shop-wide at equal priority.
    const aSpecific = a.supplierId ? 0 : 1;
    const bSpecific = b.supplierId ? 0 : 1;
    if (aSpecific !== bSpecific) return aSpecific - bSpecific;
    // More filters = more specific.
    const aFilters = (a.vendorFilter ? 1 : 0) + (a.productTypeFilter ? 1 : 0);
    const bFilters = (b.vendorFilter ? 1 : 0) + (b.productTypeFilter ? 1 : 0);
    return bFilters - aFilters;
  });

  return candidates[0];
}
