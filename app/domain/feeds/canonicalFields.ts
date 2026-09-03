/** Canonical feed fields the merchant maps supplier columns to (spec 5.4). */
export const REQUIRED_FIELDS = ["supplierSku", "quantity", "unitCost"] as const;

export const OPTIONAL_FIELDS = [
  "supplierName",
  "barcode",
  "manufacturerPartNumber",
  "msrp",
  "supplierStatus",
  "packSize",
  "freightPerUnit",
] as const;

export const ALL_FIELDS = [...REQUIRED_FIELDS, ...OPTIONAL_FIELDS] as const;

export type CanonicalField = (typeof ALL_FIELDS)[number];

/** columnMappings shape: { canonicalField: csvHeaderName } */
export type ColumnMappings = Partial<Record<CanonicalField, string>>;

export const FIELD_LABELS: Record<CanonicalField, string> = {
  supplierSku: "Supplier SKU",
  quantity: "Available quantity",
  unitCost: "Supplier unit cost",
  supplierName: "Supplier product name",
  barcode: "Barcode / GTIN",
  manufacturerPartNumber: "Manufacturer part number",
  msrp: "MSRP / RRP",
  supplierStatus: "Supplier status",
  packSize: "Pack size",
  freightPerUnit: "Freight per unit",
};

export interface MappingValidationResult {
  ok: boolean;
  errors: string[];
}

/** Reject duplicate header selections and missing required fields (spec 5.4). */
export function validateColumnMappings(
  mappings: ColumnMappings,
  headers: string[],
): MappingValidationResult {
  const errors: string[] = [];
  const headerSet = new Set(headers.map((h) => h.trim()));

  for (const field of REQUIRED_FIELDS) {
    if (!mappings[field]) errors.push(`Map a column for "${FIELD_LABELS[field]}".`);
  }

  const usedHeaders = new Map<string, CanonicalField[]>();
  for (const [field, header] of Object.entries(mappings) as [CanonicalField, string][]) {
    if (!header) continue;
    if (!headerSet.has(header.trim())) {
      errors.push(`Column "${header}" for "${FIELD_LABELS[field]}" is not in the file.`);
    }
    const list = usedHeaders.get(header.trim()) ?? [];
    list.push(field);
    usedHeaders.set(header.trim(), list);
  }
  for (const [header, fields] of usedHeaders) {
    if (fields.length > 1) {
      errors.push(
        `Column "${header}" is mapped to more than one field: ${fields
          .map((f) => FIELD_LABELS[f])
          .join(", ")}.`,
      );
    }
  }

  return { ok: errors.length === 0, errors };
}
