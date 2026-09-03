import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import { requireShop } from "../services/shopContext.server";
import { getEntitlement, PLAN_LIMITS } from "../services/entitlements.server";
import { Callout, StatCard, StatGrid } from "../components/ui";
import prisma from "../db.server";

const PLAN_PRICES: Record<string, string> = {
  free: "$0",
  starter: "$29",
  growth: "$79",
  pro: "$149",
};

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = await requireShop(session);
  const ent = await getEntitlement(shop.id, shop.shopDomain);
  const [supplierCount, mappedCount] = await Promise.all([
    prisma.supplier.count({ where: { shopId: shop.id } }),
    prisma.supplierProductMapping.count({ where: { supplier: { shopId: shop.id }, status: "matched" } }),
  ]);
  return { ent, supplierCount, mappedCount, plans: PLAN_LIMITS };
};

export default function Billing() {
  const { ent, supplierCount, mappedCount, plans } = useLoaderData<typeof loader>();
  const supplierPct = Math.min(100, Math.round((supplierCount / Math.max(1, ent.limits.maxSuppliers)) * 100));
  const mappedPct = Math.min(100, Math.round((mappedCount / Math.max(1, ent.limits.maxMappedVariants)) * 100));

  return (
    <s-page heading="Billing &amp; plan">
      <s-section heading="Current plan">
        <s-stack direction="block" gap="base">
          <s-stack direction="inline" gap="small-200" alignItems="center">
            <s-badge tone="info" icon="plan" size="large">
              {ent.planCode[0].toUpperCase() + ent.planCode.slice(1)}
            </s-badge>
            {ent.isBeta && <s-badge tone="success" icon="rocket">Beta access</s-badge>}
          </s-stack>
          <StatGrid>
            <StatCard
              label="Suppliers used"
              value={`${supplierCount} / ${ent.limits.maxSuppliers}`}
              icon="store"
              tone={supplierPct >= 100 ? "critical" : supplierPct >= 80 ? "warning" : "info"}
            />
            <StatCard
              label="Mapped variants"
              value={`${mappedCount.toLocaleString()} / ${ent.limits.maxMappedVariants.toLocaleString()}`}
              icon="connect"
              tone={mappedPct >= 100 ? "critical" : mappedPct >= 80 ? "warning" : "info"}
            />
            <StatCard
              label="Fastest schedule"
              value={ent.limits.minScheduleIntervalMinutes === 0 ? "Manual" : `${ent.limits.minScheduleIntervalMinutes} min`}
              icon="clock"
            />
            <StatCard
              label="URL feeds"
              value={ent.limits.allowUrlFeeds ? "Included" : "Not included"}
              icon="link"
              tone={ent.limits.allowUrlFeeds ? "success" : "neutral"}
            />
          </StatGrid>
          {ent.isBeta && (
            <Callout tone="info" icon="rocket" title="You're on beta access">
              Growth-tier limits during beta. Paid plans are activated through Shopify App Pricing before public launch —
              MarginPilot never fakes a paid subscription.
            </Callout>
          )}
        </s-stack>
      </s-section>

      <s-section heading="Plans">
        <s-grid gap="base" gridTemplateColumns="repeat(auto-fill, minmax(220px, 1fr))">
          {Object.entries(plans).map(([code, l]) => {
            const current = code === ent.planCode;
            return (
              <s-box
                key={code}
                padding="large-100"
                borderRadius="base"
                borderWidth={current ? "large" : "base"}
                background={current ? "subdued" : "base"}
              >
                <s-stack direction="block" gap="small-300">
                  <s-stack direction="inline" gap="small-200" alignItems="center">
                    <s-text type="strong">{code[0].toUpperCase() + code.slice(1)}</s-text>
                    {current ? <s-badge tone="info">Current</s-badge> : null}
                  </s-stack>
                  <span style={{ fontSize: "1.5rem", fontWeight: 650 }}>
                    {PLAN_PRICES[code] ?? "—"}
                    <s-text color="subdued"> /mo</s-text>
                  </span>
                  <s-stack direction="block" gap="small-300">
                    <s-text color="subdued">{l.maxSuppliers} supplier(s)</s-text>
                    <s-text color="subdued">{l.maxMappedVariants.toLocaleString()} mapped variants</s-text>
                    <s-text color="subdued">
                      {l.minScheduleIntervalMinutes === 0 ? "Manual runs" : `Schedule every ${l.minScheduleIntervalMinutes} min`}
                    </s-text>
                    <s-text color="subdued">{l.allowUrlFeeds ? "URL feeds included" : "Manual CSV only"}</s-text>
                  </s-stack>
                </s-stack>
              </s-box>
            );
          })}
        </s-grid>
      </s-section>
    </s-page>
  );
}

export const headers: HeadersFunction = (h) => boundary.headers(h);
