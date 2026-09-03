/**
 * SKU normalization and locale-aware number parsing.
 *
 * Normalization rules (spec 10.7): Unicode NFKC normalize, trim, case-fold.
 * Do NOT strip meaningful punctuation — supplier SKUs like "ABC-100/X" must
 * keep their separators. Original value is always preserved by the caller for
 * display; this returns the match key only.
 */

export function normalizeSku(raw: string | null | undefined): string | null {
  if (raw === null || raw === undefined) return null;
  const trimmed = String(raw).normalize("NFKC").trim();
  if (trimmed === "") return null;
  // Collapse internal whitespace runs, then case-fold. toLowerCase is an
  // adequate case fold for the Latin/parts-catalog SKUs we target.
  return trimmed.replace(/\s+/g, " ").toLowerCase();
}

export function normalizeBarcode(raw: string | null | undefined): string | null {
  if (raw === null || raw === undefined) return null;
  const cleaned = String(raw).normalize("NFKC").trim().replace(/\s+/g, "");
  return cleaned === "" ? null : cleaned;
}

export interface NumberLocaleOptions {
  /** "dot" -> 1,234.56 ; "comma" -> 1.234,56 */
  decimalSeparator: "dot" | "comma";
  /** optional explicit thousands separator to strip; when omitted we infer */
  thousandsSeparator?: string | null;
}

export interface ParsedNumber {
  ok: boolean;
  value: number | null;
  /** raw string as received, for diagnostics */
  raw: string;
}

/**
 * Parse a supplier-provided numeric string honoring their locale settings.
 * Rejects (ok:false) rather than silently coercing garbage to 0.
 */
export function parseLocaleNumber(
  raw: string | number | null | undefined,
  opts: NumberLocaleOptions,
): ParsedNumber {
  const rawStr = raw === null || raw === undefined ? "" : String(raw).trim();
  if (rawStr === "") return { ok: false, value: null, raw: rawStr };
  if (typeof raw === "number") {
    return Number.isFinite(raw) ? { ok: true, value: raw, raw: rawStr } : { ok: false, value: null, raw: rawStr };
  }

  // Strip currency symbols / spaces / NBSP but keep sign, digits, . and ,
  let s = rawStr.replace(/[\s\u00A0\u202F]/g, "").replace(/[^0-9.,+-]/g, "");
  if (s === "" || s === "+" || s === "-") return { ok: false, value: null, raw: rawStr };

  const decSep = opts.decimalSeparator === "comma" ? "," : ".";
  const thouSep = opts.thousandsSeparator ?? (decSep === "." ? "," : ".");

  // Remove thousands separators, normalize decimal separator to "."
  if (thouSep && thouSep !== decSep) {
    s = s.split(thouSep).join("");
  }
  if (decSep === ",") {
    s = s.replace(/,/g, ".");
  }

  // After normalization there must be at most one "."
  if ((s.match(/\./g) || []).length > 1) {
    return { ok: false, value: null, raw: rawStr };
  }
  if (!/^[+-]?(\d+)(\.\d+)?$/.test(s) && !/^[+-]?\.\d+$/.test(s)) {
    return { ok: false, value: null, raw: rawStr };
  }
  const n = Number(s);
  return Number.isFinite(n) ? { ok: true, value: n, raw: rawStr } : { ok: false, value: null, raw: rawStr };
}

/** Parse an integer quantity. Fractional input is rejected. */
export function parseQuantity(
  raw: string | number | null | undefined,
  opts: NumberLocaleOptions,
): ParsedNumber {
  const parsed = parseLocaleNumber(raw, opts);
  if (!parsed.ok || parsed.value === null) return parsed;
  if (!Number.isInteger(parsed.value)) {
    return { ok: false, value: null, raw: parsed.raw };
  }
  return parsed;
}

/**
 * Stable fingerprint of a CSV header row so saved mapping profiles can be
 * matched to future uploads regardless of column order.
 */
export function headerFingerprint(headers: string[]): string {
  return headers
    .map((h) => h.normalize("NFKC").trim().toLowerCase())
    .filter((h) => h !== "")
    .sort()
    .join("|");
}
