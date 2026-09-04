/**
 * Full-page navigation that preserves Shopify's embedded query params
 * (embedded=1, host, shop, id_token, …).
 *
 * A bare `window.location.assign("/app/foo")` drops the current URL's query
 * string entirely. The server's `authenticate.admin()` treats a request with
 * no `embedded`/`host`/`id_token` params as needing Shopify's session-token
 * "bounce" flow — a fragile round trip that, combined with any hydration
 * hiccup on the bounce page, can strand the iframe on a dead page instead of
 * completing the redirect. Carrying the current query string forward avoids
 * triggering that path in the first place.
 */
export function embeddedNavigate(path: string): void {
  const target = new URL(path, window.location.href);
  const current = new URLSearchParams(window.location.search);
  for (const [key, value] of current) {
    if (!target.searchParams.has(key)) target.searchParams.set(key, value);
  }
  window.location.assign(`${target.pathname}${target.search}${target.hash}`);
}
