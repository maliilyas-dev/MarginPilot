import type { HeadersFunction } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import { Callout } from "../components/ui";

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
      <s-button slot="primary-action" href="/app/guide" variant="primary">
        Open the guide
      </s-button>

      <s-section heading="How MarginPilot works">
        <s-stack direction="block" gap="base">
          <s-text color="subdued">
            Every run moves through the same pipeline. Nothing reaches Shopify until the “Approve” step, which is yours.
          </s-text>
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
