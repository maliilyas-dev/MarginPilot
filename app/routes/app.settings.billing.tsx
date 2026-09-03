import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import { requireShop } from "../services/shopContext.server";
import { getEntitlement, PLAN_LIMITS } from "../services/entitlements.server";
import prisma from "../db.server";

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
  return (
    <s-page heading="Billing & entitlement">
      <s-section heading="Current plan">
        <s-stack direction="block" gap="small-300">
          <s-stack direction="inline" gap="base">
            <s-badge tone="info">{ent.planCode}</s-badge>
            {ent.isBeta && <s-badge tone="success">beta access</s-badge>}
          </s-stack>
          <s-text>Suppliers: {supplierCount} / {ent.limits.maxSuppliers}</s-text>
          <s-text>Mapped variants: {mappedCount} / {ent.limits.maxMappedVariants}</s-text>
          <s-text>
            Fastest schedule:{" "}
            {ent.limits.minScheduleIntervalMinutes === 0 ? "manual only" : `every ${ent.limits.minScheduleIntervalMinutes} min`}
          </s-text>
          <s-text>URL feeds: {ent.limits.allowUrlFeeds ? "included" : "not included"}</s-text>
          {ent.isBeta && (
            <s-banner tone="info">
              You have beta access with Growth-tier limits. Paid plans will be activated through Shopify App Pricing
              before public launch. MarginPilot never fakes a paid subscription.
            </s-banner>
          )}
        </s-stack>
      </s-section>

      <s-section heading="Plans">
        <s-table>
          <s-table-header-row>
            <s-table-header>Plan</s-table-header>
            <s-table-header>Suppliers</s-table-header>
            <s-table-header>Mapped variants</s-table-header>
            <s-table-header>Schedule</s-table-header>
            <s-table-header>URL feeds</s-table-header>
          </s-table-header-row>
          <s-table-body>
            {Object.entries(plans).map(([code, l]) => (
              <s-table-row key={code}>
                <s-table-cell>{code}</s-table-cell>
                <s-table-cell>{l.maxSuppliers}</s-table-cell>
                <s-table-cell>{l.maxMappedVariants}</s-table-cell>
                <s-table-cell>{l.minScheduleIntervalMinutes === 0 ? "manual" : `${l.minScheduleIntervalMinutes} min`}</s-table-cell>
                <s-table-cell>{l.allowUrlFeeds ? "yes" : "no"}</s-table-cell>
              </s-table-row>
            ))}
          </s-table-body>
        </s-table>
      </s-section>
    </s-page>
  );
}

export const headers: HeadersFunction = (h) => boundary.headers(h);
