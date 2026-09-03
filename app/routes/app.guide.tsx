import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import { requireShop, DEFAULT_ONBOARDING } from "../services/shopContext.server";
import { Callout, NumberedStep, ProgressMeter } from "../components/ui";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = await requireShop(session);
  const state = { ...DEFAULT_ONBOARDING, ...(shop.onboardingState as object) } as Record<string, boolean>;
  return { state };
};

const STEPS: Array<{ key: string; title: string; body: string; action: { label: string; href: string } }> = [
  {
    key: "selectedLocation",
    title: "Pick your default inventory location",
    body: "MarginPilot writes stock levels to one Shopify location. Choose the warehouse or store location your supplier feed represents.",
    action: { label: "Open Settings", href: "/app/settings" },
  },
  {
    key: "catalogImported",
    title: "Import your Shopify catalog",
    body: "We pull your products, variants, SKUs, prices and current inventory into MarginPilot so supplier rows have something to match against. Safe to re-run any time.",
    action: { label: "Sync catalog", href: "/app/settings" },
  },
  {
    key: "supplierAdded",
    title: "Add your first supplier",
    body: "A supplier holds the feed connection (manual CSV upload or a scheduled URL), the CSV format settings, and its pricing rules.",
    action: { label: "Add supplier", href: "/app/suppliers/new" },
  },
  {
    key: "feedUploaded",
    title: "Upload a feed and map the columns",
    body: "Drop in a CSV and tell MarginPilot which column is the supplier SKU, quantity and unit cost. The mapping is saved per supplier, so you only do it once.",
    action: { label: "Go to suppliers", href: "/app/suppliers" },
  },
  {
    key: "columnsMapped",
    title: "Review SKU matches",
    body: "Exact SKU matches happen automatically. Anything unmatched or ambiguous waits for you in the Mappings workspace — MarginPilot never guesses by product title.",
    action: { label: "Open Mappings", href: "/app/mappings" },
  },
  {
    key: "changeSetReviewed",
    title: "Preview, then approve",
    body: "Every run produces a change set grouped into safe / warning / blocked / unmatched. Bad costs and large swings are blocked, not applied. You approve exactly what you want — then it runs in the background.",
    action: { label: "See runs", href: "/app/runs" },
  },
];

export default function Guide() {
  const { state } = useLoaderData<typeof loader>();
  const done = STEPS.filter((s) => state[s.key]).length;

  return (
    <s-page heading="Guide me">
      <s-section heading="Your setup progress">
        <ProgressMeter done={done} total={STEPS.length} />
      </s-section>

      <s-section heading="Getting started, step by step">
        <s-stack direction="block" gap="base">
          {STEPS.map((s, i) => (
            <NumberedStep key={s.key} n={i + 1} title={s.title} action={s.action} done={state[s.key]}>
              {s.body}
            </NumberedStep>
          ))}
        </s-stack>
      </s-section>

      <s-section heading="How the price is calculated">
        <s-stack direction="block" gap="base">
          <s-text color="subdued">
            For every matched row MarginPilot builds a landed cost, then a recommended price, using decimal maths (never
            floating point):
          </s-text>
          <s-box padding="base" borderRadius="base" background="subdued">
            <pre style={{ margin: 0, whiteSpace: "pre-wrap", fontSize: 12.5, lineHeight: 1.6 }}>
{`landedCost        = supplierUnitCost + freightPerUnit + fixedHandlingPerUnit
                   + supplierUnitCost x dutyPercent/100
                   + supplierUnitCost x otherCostPercent/100

minimumSafePrice  = landedCost / (1 - minimumMarginPercent/100)
markupPrice       = landedCost x (1 + markupPercent/100)

recommendedPrice  = max(minimumSafePrice, markupPrice)   -> rounded -> clamped to min/max`}
            </pre>
          </s-box>
          <s-text color="subdued">
            You control every input from <s-link href="/app/rules">Pricing rules</s-link>. Rules are snapshotted into
            each run, so historical numbers always stay explainable.
          </s-text>
        </s-stack>
      </s-section>

      <s-section slot="aside" heading="Safety, by default">
        <s-stack direction="block" gap="base">
          <Callout tone="success" icon="shield-check-mark" title="Nothing writes without approval">
            Importing a feed changes nothing in Shopify. Price and inventory writes only happen after you approve a
            specific change set.
          </Callout>
          <Callout tone="warning" icon="lock" title="Bad data is blocked">
            Zero or negative cost, negative quantity, price moves beyond your thresholds, and feeds with too many invalid
            rows are blocked — you can override a single row, and every override is logged.
          </Callout>
          <Callout tone="info" icon="clock-revert" title="Everything is auditable">
            Each applied change stores the before value, the requested value and what Shopify returned.
          </Callout>
        </s-stack>
      </s-section>

      <s-section slot="aside" heading="Need a hand?">
        <s-stack direction="block" gap="small-300">
          <s-link href="/app/help">Help &amp; documentation</s-link>
          <s-link href="/support" target="_blank">
            Contact support
          </s-link>
        </s-stack>
      </s-section>
    </s-page>
  );
}

export const headers: HeadersFunction = (h) => boundary.headers(h);
