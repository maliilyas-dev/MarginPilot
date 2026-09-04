/**
 * Read the live values of Polaris `s-*` form fields straight off the DOM.
 *
 * Why this exists: inside the Shopify admin iframe, Polaris web-component fields
 * don't reliably feed a native FormData, and native form submits don't carry
 * the App Bridge token. So every form in this app reads its fields with this
 * helper at click time and posts an explicit payload via `fetcher.submit(...)`.
 */
export type FieldKind = "text" | "check";

/** Find the first descendant whose `name` attribute exactly equals `name`. */
function findByName(root: HTMLElement, name: string): (HTMLElement & { value?: unknown; checked?: boolean }) | null {
  // Not a CSS-selector attribute match: names like "mapping[supplier_sku]"
  // contain characters that would need care to embed in a selector string,
  // and are trivial to get wrong (see git history). Just walk the DOM.
  const all = root.querySelectorAll<HTMLElement>("*");
  for (const el of all) {
    if (el.getAttribute("name") === name) return el as HTMLElement & { value?: unknown; checked?: boolean };
  }
  return null;
}

export function readFields(
  root: HTMLElement | null,
  spec: Record<string, FieldKind>,
): Record<string, string> {
  const out: Record<string, string> = {};
  if (!root) return out;
  for (const [name, kind] of Object.entries(spec)) {
    const el = findByName(root, name);
    if (!el) {
      out[name] = "";
      continue;
    }
    out[name] =
      kind === "check"
        ? el.checked
          ? "on"
          : ""
        : el.value == null
          ? ""
          : String(el.value);
  }
  return out;
}

/**
 * A `<s-select>` whose "none/default" option has `value=""` can, on some
 * Polaris versions, report something other than an empty string for
 * `.value` when that option is selected (observed: a stray non-empty
 * string). That's silently corrupting for fields with no DB constraint to
 * catch it (a Shopify GID) and a thrown foreign-key error for fields that
 * reference another table. Use this to only accept values that actually
 * look like the Shopify GID they're supposed to be.
 */
export function sanitizeShopifyGid(value: string | null | undefined, resource?: string): string | null {
  if (!value) return null;
  const prefix = resource ? `gid://shopify/${resource}/` : "gid://shopify/";
  return value.startsWith(prefix) ? value : null;
}
