import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { Link, useLoaderData } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import { requireShop } from "../services/shopContext.server";
import { getDashboardData } from "../domain/dashboard.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = await requireShop(session);
  return { data: await getDashboardData(shop.id) };
};

const ONBOARDING_STEPS: Array<{ key: string; label: string }> = [
  { key: "selectedLocation", label: "Select default inventory location" },
  { key: "catalogImported", label: "Import Shopify catalog" },
  { key: "supplierAdded", label: "Add first supplier" },
  { key: "feedUploaded", label: "Upload first feed" },
  { key: "columnsMapped", label: "Map feed columns" },
  { key: "changeSetReviewed", label: "Review first change set" },
];

export default function Home() {
  const { data } = useLoaderData<typeof loader>();
  const onboarding = data.onboarding as Record<string, boolean>;

  return (
    <s-page heading="MarginPilot">
      <s-button slot="primary-action" href={data.primaryCta.href}>
        {data.primaryCta.label}
      </s-button>

      {!data.onboardingComplete && (
        <s-section heading="Setup checklist">
          <s-stack direction="block" gap="small-300">
            {ONBOARDING_STEPS.map((step) => (
              <s-stack key={step.key} direction="inline" gap="base">
                <s-badge tone={onboarding[step.key] ? "success" : "neutral"}>
                  {onboarding[step.key] ? "Done" : "To do"}
                </s-badge>
                <s-text>{step.label}</s-text>
              </s-stack>
            ))}
          </s-stack>
        </s-section>
      )}

      <s-section heading="Operations">
        <s-stack direction="inline" gap="base">
          <Metric label="Active suppliers" value={data.activeSuppliers} />
          <Metric label="Shopify variants imported" value={data.variantsImported} />
          <Metric label="Mapped" value={`${data.mappedPercent}%`} />
          <Metric label="Pending safe changes" value={data.pendingSafeChanges} />
          <Metric label="Variants below margin floor" value={data.variantsBelowMarginFloor} />
          <Metric label="Unresolved alerts" value={data.alerts.critical + data.alerts.warning} />
        </s-stack>
      </s-section>

      <s-section heading="Last run">
        {data.lastRun ? (
          <s-stack direction="block" gap="small-300">
            <s-text>
              <strong>{data.lastRun.supplier}</strong> — {data.lastRun.status.replace(/_/g, " ")}
            </s-text>
            <s-text>{new Date(data.lastRun.at).toLocaleString()}</s-text>
            <s-link href={`/app/runs/${data.lastRun.id}`}>Open run</s-link>
          </s-stack>
        ) : (
          <s-paragraph>No feed runs yet. Add a supplier and upload a CSV to get started.</s-paragraph>
        )}
      </s-section>

      <s-section slot="aside" heading="Catalog">
        <s-paragraph>
          {data.lastCatalogSyncAt
            ? `Last synced ${new Date(data.lastCatalogSyncAt).toLocaleString()}`
            : "Catalog not synced yet."}
        </s-paragraph>
        <s-paragraph>
          <Link to="/app/settings">Sync catalog in Settings</Link>
        </s-paragraph>
      </s-section>
    </s-page>
  );
}

function Metric({ label, value }: { label: string; value: number | string }) {
  return (
    <s-box padding="base" borderWidth="base" borderRadius="base">
      <s-stack direction="block" gap="none">
        <s-text>{label}</s-text>
        <s-heading>{String(value)}</s-heading>
      </s-stack>
    </s-box>
  );
}

export const headers: HeadersFunction = (h) => boundary.headers(h);
