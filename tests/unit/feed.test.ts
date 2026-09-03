import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { parseCsvString } from "../../app/domain/feeds/parseCsv";
import { normalizeRecord, flagDuplicateSkus } from "../../app/domain/feeds/normalizeFeed";
import { validateColumnMappings } from "../../app/domain/feeds/canonicalFields";
import { sha256, operationKey } from "../../app/domain/feeds/checksum";
import { encryptCredentials, decryptCredentials } from "../../app/services/encryption.server";
import { assertUrlAllowed, SsrfBlockedError } from "../../app/services/safeFetch.server";

const opts = { delimiter: "auto" as const, maxRows: 1000, maxBytes: 1_000_000 };

const SAMPLE = `supplier_sku,name,available_quantity,unit_cost,msrp,freight_per_unit,barcode
ABC-100,Example Product A,24,12.50,29.99,1.25,100000000001
ABC-101,Example Product B,0,18.00,39.99,1.50,100000000002
ABC-102,Example Product C,7,0,49.99,2.00,100000000003
ABC-103,Example Product D,-5,21.50,54.99,2.25,100000000004
ABC-104,Example Product E,10000,9999.00,69.99,3.00,100000000005`;

const mappings = {
  supplierSku: "supplier_sku",
  quantity: "available_quantity",
  unitCost: "unit_cost",
  supplierName: "name",
  msrp: "msrp",
  freightPerUnit: "freight_per_unit",
  barcode: "barcode",
};

describe("parseCsvString + normalizeRecord", () => {
  it("parses the sample feed and normalizes rows", async () => {
    const { headers, records } = await parseCsvString(SAMPLE, opts);
    expect(headers).toContain("supplier_sku");
    expect(records).toHaveLength(5);

    const rows = records.map((r, i) => normalizeRecord(r, i + 1, mappings, { decimalSeparator: "dot" }));
    expect(rows[0]).toMatchObject({
      supplierSkuNormalized: "abc-100",
      quantity: 24,
      unitCost: 12.5,
      freightPerUnit: 1.25,
    });
    // zero cost parses fine here; the safety layer blocks it later
    expect(rows[2].unitCost).toBe(0);
    // negative qty parses as -5; safety layer blocks it
    expect(rows[3].quantity).toBe(-5);
    expect(rows[4].unitCost).toBe(9999);
  });

  it("detects a semicolon delimiter", async () => {
    const { records } = await parseCsvString("a;b\n1;2", opts);
    expect(records[0]).toEqual({ a: "1", b: "2" });
  });

  it("flags a row with a missing SKU as invalid", () => {
    const row = normalizeRecord({ supplier_sku: "", available_quantity: "1", unit_cost: "1" }, 1, mappings, {
      decimalSeparator: "dot",
    });
    expect(row.validationStatus).toBe("invalid");
    expect(row.validationErrors).toContain("MISSING_SKU");
  });

  it("flags invalid numerics instead of coercing to 0", () => {
    const row = normalizeRecord(
      { supplier_sku: "X", available_quantity: "ten", unit_cost: "abc" },
      1,
      mappings,
      { decimalSeparator: "dot" },
    );
    expect(row.validationErrors).toEqual(expect.arrayContaining(["INVALID_QUANTITY", "INVALID_COST"]));
  });
});

describe("flagDuplicateSkus", () => {
  it("reports duplicates without merging", () => {
    const rows = [
      { supplierSkuNormalized: "a", rowNumber: 1 },
      { supplierSkuNormalized: "a", rowNumber: 2 },
      { supplierSkuNormalized: "b", rowNumber: 3 },
    ] as any;
    const dupes = flagDuplicateSkus(rows);
    expect(dupes.get("a")).toEqual([1, 2]);
    expect(dupes.has("b")).toBe(false);
  });
});

describe("validateColumnMappings", () => {
  const headers = ["supplier_sku", "available_quantity", "unit_cost", "name", "msrp", "freight_per_unit", "barcode"];
  it("passes a valid mapping", () => {
    expect(validateColumnMappings(mappings, headers).ok).toBe(true);
  });
  it("rejects a missing required field", () => {
    const { ok, errors } = validateColumnMappings({ supplierSku: "supplier_sku" }, headers);
    expect(ok).toBe(false);
    expect(errors.join(" ")).toMatch(/unit cost/i);
  });
  it("rejects duplicate header selection", () => {
    const { ok, errors } = validateColumnMappings(
      { supplierSku: "supplier_sku", quantity: "unit_cost", unitCost: "unit_cost" },
      headers,
    );
    expect(ok).toBe(false);
    expect(errors.join(" ")).toMatch(/more than one field/i);
  });
});

describe("checksum + idempotency", () => {
  it("sha256 is stable", () => {
    expect(sha256("abc")).toBe(sha256(Buffer.from("abc")));
    expect(sha256("abc")).toHaveLength(64);
  });
  it("operationKey changes with target version", () => {
    const base = { shopId: "s", changeSetId: "cs", changeItemId: "ci", operation: "price" };
    expect(operationKey({ ...base, targetVersion: 1 })).not.toBe(operationKey({ ...base, targetVersion: 2 }));
  });
});

describe("encryption round-trip", () => {
  const prev = process.env.DATA_ENCRYPTION_KEY;
  beforeAll(() => {
    process.env.DATA_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString("base64");
  });
  afterAll(() => {
    process.env.DATA_ENCRYPTION_KEY = prev;
  });
  it("encrypts and decrypts credentials", () => {
    const payload = encryptCredentials({ username: "u", password: "p" });
    expect(payload).toBeTruthy();
    expect(payload).not.toContain("password");
    expect(payload!.startsWith("v1.")).toBe(true);
    expect(decryptCredentials(payload)).toEqual({ username: "u", password: "p" });
  });
  it("returns null when there is nothing to encrypt", () => {
    expect(encryptCredentials({})).toBeNull();
  });
});

describe("SSRF URL rejection", () => {
  it("rejects loopback and private IPs", async () => {
    await expect(assertUrlAllowed("http://127.0.0.1/feed.csv")).rejects.toBeInstanceOf(SsrfBlockedError);
    await expect(assertUrlAllowed("http://10.0.0.5/feed.csv")).rejects.toBeInstanceOf(SsrfBlockedError);
    await expect(assertUrlAllowed("http://192.168.1.1/feed.csv")).rejects.toBeInstanceOf(SsrfBlockedError);
    await expect(assertUrlAllowed("http://169.254.169.254/latest/meta-data")).rejects.toBeInstanceOf(
      SsrfBlockedError,
    );
  });
  it("rejects non-http schemes and localhost", async () => {
    await expect(assertUrlAllowed("file:///etc/passwd")).rejects.toBeInstanceOf(SsrfBlockedError);
    await expect(assertUrlAllowed("http://localhost/x")).rejects.toBeInstanceOf(SsrfBlockedError);
  });
});
