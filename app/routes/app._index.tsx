import { useEffect } from "react";
import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { useFetcher, useLoaderData, useRevalidator } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import { requireShop } from "../services/shopContext.server";
import { getDashboardData } from "../domain/dashboard.server";
import {
  EmptyState,
  ProgressMeter,
  StatCard,
  StatGrid,
  TimeAgo,
  runStatusBadge,
} from "../components/ui";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = await requireShop(session);
  return { data: await getDashboardData(shop.id) };
};

const ONBOARDING_STEPS: Array<{ key: string; label: string; href: string }> = [
  { key: "selectedLocation", label: "Select default inventory location", href: "/app/settings" },
  { key: "catalogImported", label: "Import Shopify catalog", href: "/app/settings" },
  { key: "supplierAdded", label: "Add first supplier", href: "/app/suppliers/new" },
  { key: "feedUploaded", label: "Upload first feed", href: "/app/suppliers" },
  { key: "columnsMapped", label: "Map feed columns", href: "/app/suppliers" },
  { key: "changeSetReviewed", label: "Review first change set", href: "/app/runs" },
];

export default function Home() {
  const { data } = useLoaderData<typeof loader>();
  const onboarding = data.onboarding as Record<string, boolean>;
  const doneCount = ONBOARDING_STEPS.filter((s) => onboarding[s.key]).length;

  const sync = useFetcher<{ ok: boolean; alreadyRunning?: boolean }>();
  const revalidator = useRevalidator();
  const syncing = sync.state !== "idle";

  useEffect(() => {
    if (sync.data?.ok) {
      const t = setTimeout(() => revalidator.revalidate(), 4000);
      return () => clearTimeout(t);
    }
  }, [sync.data, revalidator]);

  const unresolved = data.alerts.critical + data.alerts.warning;

  return (
    <s-page heading="MarginPilot">
      <s-button slot="primary-action" href={data.primaryCta.href} variant="primary">
        {data.primaryCta.label}
      </s-button>

      {!data.onboardingComplete && (
        <s-banner tone="info" heading="Finish setup to run your first safe sync">
          <s-paragraph>
            {doneCount} of {ONBOARDING_STEPS.length} steps complete. Next: {data.primaryCta.label.toLowerCase()}.
          </s-paragraph>
          <s-button slot="primary-action" href={data.primaryCta.href}>
            {data.primaryCta.label}
          </s-button>
        </s-banner>
      )}

      {!data.onboardingComplete && (
        <s-section heading="Setup checklist">
          <s-stack direction="block" gap="base">
            <ProgressMeter done={doneCount} total={ONBOARDING_STEPS.length} />
            <s-divider />
            <s-stack direction="block" gap="small-200">
              {ONBOARDING_STEPS.map((step) => (
                <s-stack key={step.key} direction="inline" gap="base" alignItems="center">
                  <s-badge tone={onboarding[step.key] ? "success" : "neutral"} icon={onboarding[step.key] ? "check-circle" : "circle"}>
                    {onboarding[step.key] ? "Done" : "To do"}
                  </s-badge>
                  {onboarding[step.key] ? (
                    <s-text>{step.label}</s-text>
                  ) : (
                    <s-link href={step.href}>{step.label}</s-link>
                  )}
                </s-stack>
              ))}
            </s-stack>
          </s-stack>
        </s-section>
      )}

      <s-section heading="Operations">
        <StatGrid>
          <StatCard
            label="Active suppliers"
            value={data.activeSuppliers}
            icon="store"
            tone="info"
            href="/app/suppliers"
          />
          <StatCard
            label="Variants imported"
            value={data.variantsImported.toLocaleString()}
            icon="product"
            tone="info"
            caption={data.lastCatalogSyncAt ? "From last catalog sync" : "Not synced yet"}
          />
          <StatCard
            label="SKU mapping"
            value={`${data.mappedPercent}%`}
            icon="connect"
            tone={data.mappedPercent >= 80 ? "success" : "caution"}
            href="/app/mappings"
            caption="Supplier rows matched to variants"
          />
          <StatCard
            label="Pending safe changes"
            value={data.pendingSafeChanges}
            icon="check-circle"
            tone={data.pendingSafeChanges > 0 ? "success" : "neutral"}
            href="/app/runs"
          />
          <StatCard
            label="Below margin floor"
            value={data.variantsBelowMarginFloor}
            icon="alert-triangle"
            tone={data.variantsBelowMarginFloor > 0 ? "warning" : "neutral"}
          />
          <StatCard
            label="Unresolved alerts"
            value={unresolved}
            icon="notification"
            tone={data.alerts.critical > 0 ? "critical" : unresolved > 0 ? "warning" : "success"}
            href="/app/alerts"
          />
        </StatGrid>
      </s-section>

      <s-section heading="Last run">
        {data.lastRun ? (
          <s-stack direction="block" gap="small-300">
            <s-stack direction="inline" gap="base" alignItems="center">
              <s-text type="strong">{data.lastRun.supplier}</s-text>
              {runStatusBadge(data.lastRun.status)}
            </s-stack>
            <TimeAgo iso={data.lastRun.at} />
            <s-link
              href={
                data.lastRun.status === "ready_for_review"
                  ? `/app/runs/${data.lastRun.id}/review`
                  : `/app/runs/${data.lastRun.id}`
              }
            >
              {data.lastRun.status === "ready_for_review" ? "Review changes" : "Open run"}
            </s-link>
          </s-stack>
        ) : (
          <EmptyState
            icon="file"
            heading="No feed runs yet"
            action={{ label: "Add a supplier", href: "/app/suppliers/new" }}
          >
            Add a supplier, upload a CSV, and MarginPilot will show you a safe change preview before anything touches
            Shopify.
          </EmptyState>
        )}
      </s-section>

      <s-section slot="aside" heading="Catalog">
        <s-stack direction="block" gap="base">
          <s-stack direction="inline" gap="small-200" alignItems="center">
            <s-icon type="refresh" size="small" tone={data.lastCatalogSyncAt ? "success" : "auto"} />
            <s-text color="subdued">
              {data.lastCatalogSyncAt ? (
                <>Last synced {new Date(data.lastCatalogSyncAt).toLocaleString()}</>
              ) : (
                <>Catalog not synced yet</>
              )}
            </s-text>
          </s-stack>
          <sync.Form method="post" action="/app/actions/catalog-sync">
            <s-button type="submit" {...(syncing ? { loading: true } : {})}>
              {syncing ? "Starting…" : "Sync catalog now"}
            </s-button>
          </sync.Form>
          {sync.data?.ok && (
            <s-text color="subdued">
              {sync.data.alreadyRunning ? "A sync is already running." : "Sync started — this can take a minute."}
            </s-text>
          )}
        </s-stack>
      </s-section>

      <s-section slot="aside" heading="How MarginPilot protects you">
        <s-unordered-list>
          <s-list-item>No price or inventory write happens without your explicit approval.</s-list-item>
          <s-list-item>Bad costs, negative quantities and large swings are blocked, not applied.</s-list-item>
          <s-list-item>Every applied change is kept in an audit trail.</s-list-item>
        </s-unordered-list>
      </s-section>
    </s-page>
  );
}

export const headers: HeadersFunction = (h) => boundary.headers(h);
