import { describe, it, expect } from "vitest";
import {
  normalizeSku,
  normalizeBarcode,
  parseLocaleNumber,
  parseQuantity,
  headerFingerprint,
} from "../../app/domain/mapping/normalize";

describe("normalizeSku", () => {
  it("trims and case-folds", () => {
    expect(normalizeSku("  ABC-100  ")).toBe("abc-100");
  });
  it("keeps meaningful punctuation", () => {
    expect(normalizeSku("ABC-100/X_2")).toBe("abc-100/x_2");
  });
  it("collapses internal whitespace", () => {
    expect(normalizeSku("ABC  100")).toBe("abc 100");
  });
  it("NFKC-normalizes full-width characters", () => {
    expect(normalizeSku("ＡＢＣ－１００")).toBe("abc-100");
  });
  it("returns null for empty / nullish", () => {
    expect(normalizeSku("")).toBeNull();
    expect(normalizeSku("   ")).toBeNull();
    expect(normalizeSku(null)).toBeNull();
    expect(normalizeSku(undefined)).toBeNull();
  });
});

describe("normalizeBarcode", () => {
  it("strips all whitespace", () => {
    expect(normalizeBarcode(" 100 000 001 ")).toBe("100000001");
  });
  it("returns null when empty", () => {
    expect(normalizeBarcode("   ")).toBeNull();
  });
});

describe("parseLocaleNumber", () => {
  it("parses dot-decimal with comma thousands", () => {
    expect(parseLocaleNumber("1,234.56", { decimalSeparator: "dot" })).toMatchObject({
      ok: true,
      value: 1234.56,
    });
  });
  it("parses comma-decimal with dot thousands", () => {
    expect(parseLocaleNumber("1.234,56", { decimalSeparator: "comma" })).toMatchObject({
      ok: true,
      value: 1234.56,
    });
  });
  it("parses plain integer", () => {
    expect(parseLocaleNumber("42", { decimalSeparator: "dot" })).toMatchObject({ ok: true, value: 42 });
  });
  it("handles negative", () => {
    expect(parseLocaleNumber("-5", { decimalSeparator: "dot" })).toMatchObject({ ok: true, value: -5 });
  });
  it("strips a currency symbol", () => {
    expect(parseLocaleNumber("$12.50", { decimalSeparator: "dot" })).toMatchObject({
      ok: true,
      value: 12.5,
    });
  });
  it("rejects garbage rather than coercing to 0", () => {
    expect(parseLocaleNumber("abc", { decimalSeparator: "dot" }).ok).toBe(false);
    expect(parseLocaleNumber("1.2.3", { decimalSeparator: "dot" }).ok).toBe(false);
    expect(parseLocaleNumber("", { decimalSeparator: "dot" }).ok).toBe(false);
  });
  it("passes through a numeric input", () => {
    expect(parseLocaleNumber(9.99, { decimalSeparator: "dot" })).toMatchObject({ ok: true, value: 9.99 });
  });
});

describe("parseQuantity", () => {
  it("accepts whole numbers", () => {
    expect(parseQuantity("10", { decimalSeparator: "dot" })).toMatchObject({ ok: true, value: 10 });
  });
  it("rejects fractional quantities", () => {
    expect(parseQuantity("10.5", { decimalSeparator: "dot" }).ok).toBe(false);
  });
  it("accepts negative integers (safety layer flags them later)", () => {
    expect(parseQuantity("-5", { decimalSeparator: "dot" })).toMatchObject({ ok: true, value: -5 });
  });
});

describe("headerFingerprint", () => {
  it("is order-independent and case-insensitive", () => {
    expect(headerFingerprint(["SKU", "Qty", "Cost"])).toBe(headerFingerprint(["cost", "sku", "qty"]));
  });
});
