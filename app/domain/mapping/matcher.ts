/**
 * Variant matching priority (spec 5.5):
 *   1. Existing explicit mapping
 *   2. Exact normalized SKU match
 *   3. Exact barcode match (only if the supplier enables barcode matching)
 *   4. Unmatched
 *
 * Multiple variants sharing a normalized SKU/barcode => ambiguous (manual pick).
 * Fuzzy title matching is never used in Release 1.
 */

export interface VariantIndexEntry {
  variantId: string;
  skuNormalized: string | null;
  barcodeNormalized: string | null;
}

export interface VariantIndex {
  bySku: Map<string, string[]>; // normalized sku -> variantIds
  byBarcode: Map<string, string[]>; // normalized barcode -> variantIds
}

export function buildVariantIndex(entries: VariantIndexEntry[]): VariantIndex {
  const bySku = new Map<string, string[]>();
  const byBarcode = new Map<string, string[]>();
  for (const e of entries) {
    if (e.skuNormalized) {
      const l = bySku.get(e.skuNormalized) ?? [];
      l.push(e.variantId);
      bySku.set(e.skuNormalized, l);
    }
    if (e.barcodeNormalized) {
      const l = byBarcode.get(e.barcodeNormalized) ?? [];
      l.push(e.variantId);
      byBarcode.set(e.barcodeNormalized, l);
    }
  }
  return { bySku, byBarcode };
}

export type MatchMethod = "explicit" | "exact_sku" | "exact_barcode" | "ignored";
export type MappingStatus = "matched" | "unmatched" | "ambiguous" | "ignored";

export interface MatchInput {
  supplierSkuNormalized: string | null;
  barcodeNormalized: string | null;
  /** existing SupplierProductMapping for this normalized SKU, if any */
  explicit?: { variantId: string | null; status: MappingStatus } | null;
  barcodeMatchingEnabled: boolean;
}

export interface MatchResult {
  variantId: string | null;
  status: MappingStatus;
  matchMethod: MatchMethod | null;
  candidateVariantIds: string[];
}

export function resolveMatch(input: MatchInput, index: VariantIndex): MatchResult {
  // 1. Explicit mapping (includes merchant-set "ignored")
  if (input.explicit) {
    if (input.explicit.status === "ignored") {
      return { variantId: null, status: "ignored", matchMethod: "ignored", candidateVariantIds: [] };
    }
    if (input.explicit.variantId) {
      return {
        variantId: input.explicit.variantId,
        status: "matched",
        matchMethod: "explicit",
        candidateVariantIds: [input.explicit.variantId],
      };
    }
  }

  if (!input.supplierSkuNormalized) {
    return { variantId: null, status: "unmatched", matchMethod: null, candidateVariantIds: [] };
  }

  // 2. Exact SKU
  const skuMatches = index.bySku.get(input.supplierSkuNormalized) ?? [];
  if (skuMatches.length === 1) {
    return {
      variantId: skuMatches[0],
      status: "matched",
      matchMethod: "exact_sku",
      candidateVariantIds: skuMatches,
    };
  }
  if (skuMatches.length > 1) {
    return { variantId: null, status: "ambiguous", matchMethod: null, candidateVariantIds: skuMatches };
  }

  // 3. Exact barcode (opt-in)
  if (input.barcodeMatchingEnabled && input.barcodeNormalized) {
    const bcMatches = index.byBarcode.get(input.barcodeNormalized) ?? [];
    if (bcMatches.length === 1) {
      return {
        variantId: bcMatches[0],
        status: "matched",
        matchMethod: "exact_barcode",
        candidateVariantIds: bcMatches,
      };
    }
    if (bcMatches.length > 1) {
      return { variantId: null, status: "ambiguous", matchMethod: null, candidateVariantIds: bcMatches };
    }
  }

  // 4. Unmatched
  return { variantId: null, status: "unmatched", matchMethod: null, candidateVariantIds: [] };
}
