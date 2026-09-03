/**
 * Machine-readable reason codes (spec 10). Merchant-facing text lives in
 * `describeReason` so the UI never shows a bare code.
 */
export const ReasonCode = {
  SKU_UNMATCHED: "SKU_UNMATCHED",
  SKU_AMBIGUOUS: "SKU_AMBIGUOUS",
  DUPLICATE_SUPPLIER_SKU: "DUPLICATE_SUPPLIER_SKU",
  INVALID_QUANTITY: "INVALID_QUANTITY",
  INVALID_COST: "INVALID_COST",
  ZERO_COST_BLOCKED: "ZERO_COST_BLOCKED",
  NEGATIVE_QUANTITY: "NEGATIVE_QUANTITY",
  NEGATIVE_COST: "NEGATIVE_COST",
  MARGIN_BELOW_MINIMUM: "MARGIN_BELOW_MINIMUM",
  PRICE_INCREASE_THRESHOLD: "PRICE_INCREASE_THRESHOLD",
  PRICE_DECREASE_THRESHOLD: "PRICE_DECREASE_THRESHOLD",
  INVENTORY_CHANGE_THRESHOLD: "INVENTORY_CHANGE_THRESHOLD",
  ROW_COUNT_DROP_THRESHOLD: "ROW_COUNT_DROP_THRESHOLD",
  INVALID_ROW_RATE_THRESHOLD: "INVALID_ROW_RATE_THRESHOLD",
  ZERO_RECOMMENDED_PRICE: "ZERO_RECOMMENDED_PRICE",
  MISSING_SKU: "MISSING_SKU",
  UNCHANGED: "UNCHANGED",
  SAFE_UPDATE: "SAFE_UPDATE",
} as const;

export type ReasonCodeValue = (typeof ReasonCode)[keyof typeof ReasonCode];

const DESCRIPTIONS: Record<ReasonCodeValue, string> = {
  SKU_UNMATCHED: "This supplier SKU is not matched to a Shopify variant yet.",
  SKU_AMBIGUOUS: "More than one Shopify variant shares this SKU. Pick one manually.",
  DUPLICATE_SUPPLIER_SKU: "This SKU appears more than once in the feed.",
  INVALID_QUANTITY: "The quantity value could not be read as a whole number.",
  INVALID_COST: "The unit cost value could not be read as a number.",
  ZERO_COST_BLOCKED: "Unit cost is zero. Allow zero cost in Safety settings to permit this.",
  NEGATIVE_QUANTITY: "Quantity is negative.",
  NEGATIVE_COST: "Unit cost is negative.",
  MARGIN_BELOW_MINIMUM: "The recommended price is below your minimum margin rule.",
  PRICE_INCREASE_THRESHOLD: "The price increase is larger than your safety limit.",
  PRICE_DECREASE_THRESHOLD: "The price decrease is larger than your safety limit.",
  INVENTORY_CHANGE_THRESHOLD: "The inventory change is larger than your safety limit.",
  ROW_COUNT_DROP_THRESHOLD: "This feed has far fewer rows than the previous successful run.",
  INVALID_ROW_RATE_THRESHOLD: "Too many rows in this feed are invalid.",
  ZERO_RECOMMENDED_PRICE: "The calculated selling price is zero.",
  MISSING_SKU: "This row has no supplier SKU.",
  UNCHANGED: "No change needed for this variant.",
  SAFE_UPDATE: "This change passed all safety checks.",
};

export function describeReason(code: ReasonCodeValue): string {
  return DESCRIPTIONS[code] ?? code;
}
