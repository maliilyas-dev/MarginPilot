import type { HeadersFunction } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import { Callout } from "../components/ui";
import { embeddedNavigate } from "../utils/embeddedNavigate";

export const loader = async ({ request }: { request: Request }) => {
  await authenticate.admin(request);
  return null;
};

const FLOW = [
  { icon: "store", label: "Add supplier" },
  { icon: "upload", label: "Upload / fetch feed" },
  { icon: "connect", label: "Match SKUs" },
  { icon: "calculator", label: "Calculate prices" },
  { icon: "shield-check-mark", label: "Safety check" },
  { icon: "view", label: "Preview" },
  { icon: "check-circle", label: "Approve" },
  { icon: "refresh", label: "Apply to Shopify" },
] as const;

const PIPELINE: Array<{ step: string; what: string }> = [
  { step: "Catalog sync", what: "Reads your products, variants, SKUs, prices, unit costs and inventory from Shopify into MarginPilot. Read-only. Safe to re-run any time." },
  { step: "Add a supplier", what: "Defines one supplier: how its feed arrives (manual CSV or scheduled URL), CSV format, currency, default location, schedule. URL feeds are SSRF-protected; credentials are encrypted." },
  { step: "Feed arrives", what: "A CSV is streamed in (never loaded whole into memory). A checksum stops the same file being processed twice by accident." },
  { step: "Map columns", what: "You point supplier SKU, quantity and unit cost (plus optional freight, barcode, MSRP) at the right columns. Saved per supplier — done once." },
  { step: "Match SKUs", what: "Exact SKU match first (case-insensitive, trimmed), then optional barcode. Unmatched or ambiguous rows wait for you in Mappings. Never matched by product title." },
  { step: "Calculate", what: "Decimal maths builds landed cost (supplier cost + freight + handling + duty% + other%), then recommendedPrice = max(minimum-margin price, markup price), rounded and clamped. The rule set is snapshotted into the run." },
  { step: "Safety check", what: "Every proposed change is classified safe / warning / blocked / unmatched / invalid / unchanged. Bad costs, negative quantities and large swings are blocked. A whole feed can be blocked if too many rows are invalid or the row count collapsed." },
  { step: "Preview", what: "You see the change set grouped by category, with before → after for price and inventory and the total financial exposure. Blocked rows can't be selected without an explicit, logged override." },
  { step: "Approve", what: "You choose price and/or inventory, select rows, confirm. This creates an immutable change set and queues background jobs." },
  { step: "Apply", what: "A separate worker writes approved changes to Shopify via the GraphQL Admin API — batched, throttle-aware, retrying transient errors. Each write records the previous value, requested value and Shopify's response. One failure doesn't fail the rest." },
  { step: "Audit", what: "Runs, change sets, overrides and results are all kept and exportable as CSV." },
];

const FAQ: Array<{ q: string; a: string }> = [
  {
    q: "Does MarginPilot ever change prices on its own?",
    a: "No. Importing a feed writes nothing to Shopify. Price and inventory updates only happen after you approve a specific change set.",
  },
  {
    q: "Why is a row blocked?",
    a: "A safety policy caught it: zero/negative cost, negative quantity, a price move past your threshold, margin below your floor, an abnormal inventory jump, or an unmatched SKU. Fix the data, adjust the policy in Settings, or override that single row (logged).",
  },
  {
    q: "Why didn't a supplier row match a variant?",
    a: "SKUs match exactly, case-insensitive and trimmed. If several Shopify variants share a SKU the row is ambiguous and you pick one in Mappings. MarginPilot never matches on product title.",
  },
  {
    q: "Can I re-run a feed safely?",
    a: "Yes. Runs are idempotent — the same file is de-duplicated by checksum, and replaying a completed apply job never double-writes a successful change.",
  },
  {
    q: "Why does my plan say “Beta”?",
    a: "MarginPilot isn't publicly listed yet, so paid subscriptions can't be billed through Shopify. Until then your store gets free beta access with Growth-tier limits. When the public listing is live you'll pick a paid plan and Shopify bills it.",
  },
  {
    q: "What happens to my data when I uninstall?",
    a: "Schedules stop and access is revoked immediately. On Shopify's shop/redact (~48h later) your suppliers, feeds, mappings, change sets and catalog mirror are deleted and the shop record anonymized.",
  },
  {
    q: "Does this affect my storefront speed?",
    a: "No. MarginPilot is admin-only and adds zero storefront code, so it has no impact on Lighthouse or Web Vitals.",
  },
];

export default function Help() {
  return (
    <s-page heading="Help &amp; docs">
      <s-section>
        <s-button type="button" variant="primary" onClick={() => embeddedNavigate("/app/guide")}>
          Open the guide
        </s-button>
      </s-section>

      <s-section heading="What MarginPilot is for">
        <s-stack direction="block" gap="base">
          <s-text color="subdued">
            It solves one expensive problem: merchants who restock from suppliers get inventory and cost data as CSV
            files or feed URLs, and pushing that data into Shopify blindly loses money.
          </s-text>
          <s-stack direction="block" gap="small-300">
            <s-text type="strong">It prevents things like:</s-text>
            <s-unordered-list>
              <s-list-item>A supplier&apos;s cost rises but your Shopify price doesn&apos;t — you sell at a loss.</s-list-item>
              <s-list-item>A feed says quantity <s-text type="strong">10000</s-text> or <s-text type="strong">0</s-text> by mistake — you oversell or hide stock.</s-list-item>
              <s-list-item>A price cell reads <s-text type="strong">9999</s-text> or <s-text type="strong">0</s-text> and gets applied.</s-list-item>
              <s-list-item>Supplier SKU and Shopify SKU don&apos;t line up — the wrong product is updated.</s-list-item>
              <s-list-item>Freight, duty and handling aren&apos;t in your &ldquo;cost&rdquo;, so your margin maths is wrong.</s-list-item>
              <s-list-item>You can&apos;t see what a sync will change before it changes it.</s-list-item>
            </s-unordered-list>
          </s-stack>
          <Callout tone="info" icon="person" title="Best fit">
            A store with roughly 100–50,000 variants, one or more suppliers, restocking regularly from
            spreadsheets/feeds, that cares more about protecting margin than about &ldquo;fully automatic&rdquo;.
          </Callout>
        </s-stack>
      </s-section>

      <s-section heading="How it operates">
        <s-stack direction="block" gap="base">
          <Callout tone="success" icon="shield-check-mark" title="The core principle">
            Importing a feed never changes Shopify. Nothing is written to your store until you look at a preview and
            approve it. The risky step — bulk-editing prices and stock — is made the most reviewed, auditable and
            reversible one, not the fastest.
          </Callout>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
            {FLOW.map((f, i) => (
              <div key={f.label} style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <s-box padding="small-200" borderRadius="base" borderWidth="base" background="base">
                  <s-stack direction="inline" gap="small-300" alignItems="center">
                    <s-icon type={f.icon} size="small" />
                    <s-text>{f.label}</s-text>
                  </s-stack>
                </s-box>
                {i < FLOW.length - 1 ? <s-text color="subdued">→</s-text> : null}
              </div>
            ))}
          </div>
          <s-table>
            <s-table-header-row>
              <s-table-header>Step</s-table-header>
              <s-table-header>What happens</s-table-header>
            </s-table-header-row>
            <s-table-body>
              {PIPELINE.map((row) => (
                <s-table-row key={row.step}>
                  <s-table-cell>
                    <s-text type="strong">{row.step}</s-text>
                  </s-table-cell>
                  <s-table-cell>
                    <s-text color="subdued">{row.what}</s-text>
                  </s-table-cell>
                </s-table-row>
              ))}
            </s-table-body>
          </s-table>
        </s-stack>
      </s-section>

      <s-section heading="Safety guarantees">
        <s-unordered-list>
          <s-list-item>No Shopify write without your approval.</s-list-item>
          <s-list-item>Bad data is blocked, not applied.</s-list-item>
          <s-list-item>Idempotent — re-running a feed or replaying a job never double-writes.</s-list-item>
          <s-list-item>Strict per-shop isolation on every query.</s-list-item>
          <s-list-item>Supplier credentials encrypted; webhooks verified; URL feeds SSRF-protected.</s-list-item>
          <s-list-item>No customer, order or storefront data is touched at all.</s-list-item>
        </s-unordered-list>
      </s-section>

      <s-section heading="Architecture">
        <s-stack direction="block" gap="small-300">
          <s-text color="subdued">
            <s-text type="strong">Web</s-text> — the embedded admin UI, auth, uploads, webhooks, job enqueueing.
          </s-text>
          <s-text color="subdued">
            <s-text type="strong">Worker</s-text> — catalog sync, feed parsing, calculation, Shopify writes, scheduled
            runs, cleanup. Feed processing never runs inside a browser request.
          </s-text>
          <s-text color="subdued">Backed by PostgreSQL (data) and Redis / BullMQ (jobs).</s-text>
        </s-stack>
      </s-section>

      <s-section heading="FAQ">
        <s-stack direction="block" gap="base">
          {FAQ.map((item) => (
            <s-box key={item.q} padding="base" borderRadius="base" borderWidth="base" background="base">
              <s-stack direction="block" gap="small-300">
                <s-text type="strong">{item.q}</s-text>
                <s-text color="subdued">{item.a}</s-text>
              </s-stack>
            </s-box>
          ))}
        </s-stack>
      </s-section>

      <s-section slot="aside" heading="Links">
        <s-stack direction="block" gap="small-300">
          <s-link href="/app/guide">Guided setup walkthrough</s-link>
          <s-link href="/support" target="_blank">
            Support &amp; contact
          </s-link>
          <s-link href="/privacy" target="_blank">
            Privacy policy
          </s-link>
          <s-link href="/terms" target="_blank">
            Terms of service
          </s-link>
        </s-stack>
      </s-section>

      <s-section slot="aside" heading="Contact support">
        <Callout tone="info" icon="chat" title="support@marginpilot.app">
          Include your store domain, the supplier name and the feed run ID from the Runs page. Never send tokens or
          passwords.
        </Callout>
      </s-section>
    </s-page>
  );
}

export const headers: HeadersFunction = (h) => boundary.headers(h);
