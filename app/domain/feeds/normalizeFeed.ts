/**
 * Turn a raw CSV record (object keyed by header) into a normalized feed row
 * plus row-level validation results (spec 5.4 / 10).
 *
 * Pure and synchronous — the streaming parser calls this per record.
 */
import { normalizeSku, normalizeBarcode, parseLocaleNumber, parseQuantity } from "../mapping/normalize";
import type { ColumnMappings } from "./canonicalFields";

export interface SupplierLocale {
  decimalSeparator: "dot" | "comma";
  thousandsSeparator?: string | null;
}

export interface NormalizedFeedRow {
  rowNumber: number;
  supplierSkuOriginal: string | null;
  supplierSkuNormalized: string | null;
  supplierName: string | null;
  barcode: string | null;
  barcodeNormalized: string | null;
  manufacturerPartNumber: string | null;
  quantity: number | null;
  unitCost: number | null;
  msrp: number | null;
  packSize: number | null;
  freightPerUnit: number | null;
  supplierStatus: string | null;
  validationStatus: "valid" | "invalid";
  validationErrors: string[];
  raw: Record<string, string>;
}

function pick(record: Record<string, string>, mappings: ColumnMappings, field: keyof ColumnMappings): string | null {
  const header = mappings[field];
  if (!header) return null;
  const v = record[header];
  return v === undefined || v === null ? null : String(v);
}

export function normalizeRecord(
  record: Record<string, string>,
  rowNumber: number,
  mappings: ColumnMappings,
  locale: SupplierLocale,
): NormalizedFeedRow {
  const errors: string[] = [];

  const skuOriginalRaw = pick(record, mappings, "supplierSku");
  const supplierSkuNormalized = normalizeSku(skuOriginalRaw);
  if (!supplierSkuNormalized) errors.push("MISSING_SKU");

  const qtyRaw = pick(record, mappings, "quantity");
  const qtyParsed = parseQuantity(qtyRaw, locale);
  if (qtyRaw !== null && qtyRaw !== "" && !qtyParsed.ok) errors.push("INVALID_QUANTITY");

  const costRaw = pick(record, mappings, "unitCost");
  const costParsed = parseLocaleNumber(costRaw, locale);
  if (costRaw !== null && costRaw !== "" && !costParsed.ok) errors.push("INVALID_COST");

  const numOrNull = (raw: string | null) => {
    if (raw === null || raw.trim() === "") return null;
    const p = parseLocaleNumber(raw, locale);
    return p.ok ? p.value : null;
  };

  const barcodeOriginal = pick(record, mappings, "barcode");

  return {
    rowNumber,
    supplierSkuOriginal: skuOriginalRaw ? skuOriginalRaw.trim() : null,
    supplierSkuNormalized,
    supplierName: pick(record, mappings, "supplierName")?.trim() || null,
    barcode: barcodeOriginal ? barcodeOriginal.trim() : null,
    barcodeNormalized: normalizeBarcode(barcodeOriginal),
    manufacturerPartNumber: pick(record, mappings, "manufacturerPartNumber")?.trim() || null,
    quantity: qtyParsed.ok ? qtyParsed.value : null,
    unitCost: costParsed.ok ? costParsed.value : null,
    msrp: numOrNull(pick(record, mappings, "msrp")),
    packSize: numOrNull(pick(record, mappings, "packSize")),
    freightPerUnit: numOrNull(pick(record, mappings, "freightPerUnit")),
    supplierStatus: pick(record, mappings, "supplierStatus")?.trim() || null,
    validationStatus: errors.length > 0 ? "invalid" : "valid",
    validationErrors: errors,
    raw: record,
  };
}

/**
 * Flag duplicate supplier SKUs across a batch of normalized rows. We do NOT
 * merge or sum — the merchant must decide (spec 5.4).
 */
export function flagDuplicateSkus(rows: NormalizedFeedRow[]): Map<string, number[]> {
  const seen = new Map<string, number[]>();
  for (const row of rows) {
    if (!row.supplierSkuNormalized) continue;
    const list = seen.get(row.supplierSkuNormalized) ?? [];
    list.push(row.rowNumber);
    seen.set(row.supplierSkuNormalized, list);
  }
  const dupes = new Map<string, number[]>();
  for (const [sku, rowNums] of seen) {
    if (rowNums.length > 1) dupes.set(sku, rowNums);
  }
  return dupes;
}
