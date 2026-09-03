import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import { requireShop } from "../services/shopContext.server";
import { getEntitlement, PLAN_LIMITS } from "../services/entitlements.server";
import { Callout, StatCard, StatGrid } from "../components/ui";
import prisma from "../db.server";

const PLAN_META: Record<string, { price: string; blurb: string }> = {
  free: { price: "$0", blurb: "Evaluate MarginPilot on one supplier." },
  starter: { price: "$29", blurb: "One supplier, daily scheduled feeds." },
  growth: { price: "$79", blurb: "Up to 5 suppliers, hourly feeds." },
  pro: { price: "$149", blurb: "High volume, priority processing." },
};
// Purchasable plans only — "beta" is an access state, not a plan you choose.
const PUBLIC_PLAN_ORDER = ["free", "starter", "growth", "pro"] as const;

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

  // What plan you'd effectively be on if beta access ended today.
  const effectivePlanLabel = ent.isBeta ? "Beta access" : ent.planCode[0].toUpperCase() + ent.planCode.slice(1);

  return (
    <s-page heading="Billing &amp; plan">
      <s-section heading="Your access">
        <s-stack direction="block" gap="base">
          <s-stack direction="inline" gap="small-200" alignItems="center">
            <s-badge tone={ent.isBeta ? "success" : "info"} icon={ent.isBeta ? "rocket" : "plan"} size="large">
              {effectivePlanLabel}
            </s-badge>
            {ent.isBeta && <s-badge tone="neutral">Growth-tier limits</s-badge>}
          </s-stack>

          {ent.isBeta && (
            <Callout tone="info" icon="rocket" title="Why does it say “Beta”?">
              MarginPilot isn&apos;t publicly listed yet, so paid subscriptions can&apos;t be charged through Shopify
              Billing. Until it is, your store runs on <s-text type="strong">free beta access</s-text> with Growth-tier
              limits (5 suppliers, 10,000 mapped variants, hourly schedules). Nothing is billed. When the public listing
              goes live you&apos;ll pick one of the paid plans below and it will be charged by Shopify — MarginPilot never
              creates a fake subscription.
            </Callout>
          )}

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
              value={ent.limits.minScheduleIntervalMinutes === 0 ? "Manual" : `Every ${ent.limits.minScheduleIntervalMinutes} min`}
              icon="clock"
            />
            <StatCard
              label="URL feeds"
              value={ent.limits.allowUrlFeeds ? "Included" : "Not included"}
              icon="link"
              tone={ent.limits.allowUrlFeeds ? "success" : "neutral"}
            />
          </StatGrid>
        </s-stack>
      </s-section>

      <s-section heading="Plans">
        <s-stack direction="block" gap="base">
          <s-text color="subdued">
            Prices are billed through Shopify once MarginPilot is publicly listed. During beta all stores use free
            Growth-tier access.
          </s-text>
          <s-grid gap="base" gridTemplateColumns="repeat(auto-fill, minmax(230px, 1fr))">
            {PUBLIC_PLAN_ORDER.map((code) => {
              const l = plans[code];
              const meta = PLAN_META[code];
              const current = !ent.isBeta && code === ent.planCode;
              return (
                <s-box
                  key={code}
                  padding="large-100"
                  borderRadius="base"
                  borderWidth="base"
                  background={current ? "subdued" : "base"}
                >
                  <s-stack direction="block" gap="small-300">
                    <s-stack direction="inline" gap="small-200" alignItems="center">
                      <s-text type="strong">{code[0].toUpperCase() + code.slice(1)}</s-text>
                      {current ? <s-badge tone="info">Current</s-badge> : null}
                    </s-stack>
                    <span style={{ fontSize: "1.5rem", fontWeight: 650 }}>
                      {meta.price}
                      <s-text color="subdued"> /mo</s-text>
                    </span>
                    <s-text color="subdued">{meta.blurb}</s-text>
                    <s-divider />
                    <s-stack direction="block" gap="small-300">
                      <s-text color="subdued">{l.maxSuppliers} supplier{l.maxSuppliers === 1 ? "" : "s"}</s-text>
                      <s-text color="subdued">{l.maxMappedVariants.toLocaleString()} mapped variants</s-text>
                      <s-text color="subdued">
                        {l.minScheduleIntervalMinutes === 0
                          ? "Manual runs only"
                          : `Schedule as often as every ${l.minScheduleIntervalMinutes >= 60 ? `${l.minScheduleIntervalMinutes / 60} h` : `${l.minScheduleIntervalMinutes} min`}`}
                      </s-text>
                      <s-text color="subdued">{l.allowUrlFeeds ? "URL feeds included" : "Manual CSV only"}</s-text>
                      {l.priorityProcessing ? <s-text color="subdued">Priority processing</s-text> : null}
                    </s-stack>
                  </s-stack>
                </s-box>
              );
            })}
          </s-grid>
        </s-stack>
      </s-section>
    </s-page>
  );
}

export const headers: HeadersFunction = (h) => boundary.headers(h);
