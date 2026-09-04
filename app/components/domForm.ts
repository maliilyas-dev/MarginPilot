/**
 * Read the live values of Polaris `s-*` form fields straight off the DOM.
 *
 * Why this exists: inside the Shopify admin iframe, Polaris web-component fields
 * don't reliably feed a native FormData, and native form submits don't carry
 * the App Bridge token. So every form in this app reads its fields with this
 * helper at click time and posts an explicit payload via `fetcher.submit(...)`.
 */
export type FieldKind = "text" | "check";

export function readFields(
  root: HTMLElement | null,
  spec: Record<string, FieldKind>,
): Record<string, string> {
  const out: Record<string, string> = {};
  if (!root) return out;
  for (const [name, kind] of Object.entries(spec)) {
    const el = root.querySelector(`[name="${CSS.escape(name)}"]`) as
      | (HTMLElement & { value?: unknown; checked?: boolean })
      | null;
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
