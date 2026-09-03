import type { ActionFunctionArgs, HeadersFunction, LoaderFunctionArgs } from "react-router";
import { Form, useFetcher, useLoaderData } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { z } from "zod";
import { authenticate } from "../shopify.server";
import { requireShop, markOnboarding } from "../services/shopContext.server";
import { recordAudit } from "../services/audit.server";
import prisma from "../db.server";

const schema = z.object({
  intent: z.enum(["location", "safety"]),
  defaultLocationGid: z.string().optional(),
  maxPriceDecreasePercent: z.coerce.number().optional(),
  maxPriceIncreasePercent: z.coerce.number().optional(),
  maxInventoryChangePercent: z.coerce.number().optional(),
  maxInventoryAbsoluteChange: z.coerce.number().int().optional(),
  maxInvalidRowPercent: z.coerce.number().optional(),
  maxRowCountDecreasePercent: z.coerce.number().optional(),
  allowZeroCost: z.union([z.literal("on"), z.literal("")]).optional(),
});

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = await requireShop(session);
  const [safety, locations, lastSync, variantCount] = await Promise.all([
    prisma.safetyPolicy.findUnique({ where: { shopId: shop.id } }),
    prisma.variantInventory.findMany({
      where: { variant: { shopId: shop.id } },
      distinct: ["locationGid"],
      select: { locationGid: true },
    }),
    prisma.catalogSync.findFirst({ where: { shopId: shop.id }, orderBy: { startedAt: "desc" } }),
    prisma.shopifyVariant.count({ where: { shopId: shop.id, activeLocally: true } }),
  ]);
  return {
    shop: { defaultLocationGid: shop.defaultLocationGid, currencyCode: shop.currencyCode, timezone: shop.timezone },
    locations: locations.map((l) => l.locationGid),
    safety: safety && {
      maxPriceDecreasePercent: Number(safety.maxPriceDecreasePercent),
      maxPriceIncreasePercent: Number(safety.maxPriceIncreasePercent),
      maxInventoryChangePercent: Number(safety.maxInventoryChangePercent),
      maxInventoryAbsoluteChange: safety.maxInventoryAbsoluteChange,
      maxInvalidRowPercent: Number(safety.maxInvalidRowPercent),
      maxRowCountDecreasePercent: Number(safety.maxRowCountDecreasePercent),
      allowZeroCost: safety.allowZeroCost,
    },
    lastSync: lastSync && { status: lastSync.status, at: (lastSync.completedAt ?? lastSync.startedAt).toISOString(), variantCount: lastSync.variantCount },
    variantCount,
  };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = await requireShop(session);
  const parsed = schema.safeParse(Object.fromEntries(await request.formData()));
  if (!parsed.success) return { error: "Check the values." };
  const d = parsed.data;

  if (d.intent === "location") {
    await prisma.shop.update({ where: { id: shop.id }, data: { defaultLocationGid: d.defaultLocationGid || null } });
    await markOnboarding(shop.id, { selectedLocation: Boolean(d.defaultLocationGid) });
    await recordAudit({ shopId: shop.id, actorType: "merchant", action: "default_location_set", resourceType: "shop", resourceId: shop.id, summary: "Default inventory location updated." });
    return { ok: true };
  }

  await prisma.safetyPolicy.update({
    where: { shopId: shop.id },
    data: {
      maxPriceDecreasePercent: d.maxPriceDecreasePercent ?? undefined,
      maxPriceIncreasePercent: d.maxPriceIncreasePercent ?? undefined,
      maxInventoryChangePercent: d.maxInventoryChangePercent ?? undefined,
      maxInventoryAbsoluteChange: d.maxInventoryAbsoluteChange ?? undefined,
      maxInvalidRowPercent: d.maxInvalidRowPercent ?? undefined,
      maxRowCountDecreasePercent: d.maxRowCountDecreasePercent ?? undefined,
      allowZeroCost: d.allowZeroCost === "on",
    },
  });
  await recordAudit({ shopId: shop.id, actorType: "merchant", action: "safety_policy_updated", resourceType: "safety_policy", resourceId: shop.id, summary: "Safety policy updated." });
  return { ok: true };
};

export default function Settings() {
  const { shop, locations, safety, lastSync, variantCount } = useLoaderData<typeof loader>();
  const sync = useFetcher<{ ok: boolean; catalogSyncId?: string }>();

  return (
    <s-page heading="Settings">
      <s-section heading="Shopify catalog">
        <s-stack direction="block" gap="small-300">
          <s-text>Active variants imported: {variantCount}</s-text>
          <s-text>
            {lastSync ? `Last sync ${lastSync.status} at ${new Date(lastSync.at).toLocaleString()} (${lastSync.variantCount} variants)` : "Not synced yet."}
          </s-text>
          <sync.Form method="post" action="/app/actions/catalog-sync">
            <s-button type="submit" variant="primary" {...(sync.state !== "idle" ? { loading: true } : {})}>
              Sync catalog now
            </s-button>
          </sync.Form>
          {sync.data?.ok && <s-banner tone="success">Catalog sync queued. It runs in the background.</s-banner>}
        </s-stack>
      </s-section>

      <s-section heading="Default inventory location">
        <Form method="post">
          <input type="hidden" name="intent" value="location" />
          <s-stack direction="block" gap="small-300">
            <s-select label="Location" name="defaultLocationGid" value={shop.defaultLocationGid ?? ""}>
              <s-option value="">Not set</s-option>
              {locations.map((l) => (
                <s-option key={l} value={l}>
                  {l}
                </s-option>
              ))}
            </s-select>
            <s-text>Currency: {shop.currencyCode} · Time zone: {shop.timezone}</s-text>
            <s-button type="submit">Save location</s-button>
          </s-stack>
        </Form>
      </s-section>

      <s-section heading="Safety policy">
        <Form method="post">
          <input type="hidden" name="intent" value="safety" />
          <s-stack direction="block" gap="small-300">
            <s-number-field label="Max price decrease %" name="maxPriceDecreasePercent" defaultValue={String(safety?.maxPriceDecreasePercent ?? 20)} />
            <s-number-field label="Max price increase %" name="maxPriceIncreasePercent" defaultValue={String(safety?.maxPriceIncreasePercent ?? 50)} />
            <s-number-field label="Max inventory change %" name="maxInventoryChangePercent" defaultValue={String(safety?.maxInventoryChangePercent ?? 90)} />
            <s-number-field label="Max inventory absolute change" name="maxInventoryAbsoluteChange" defaultValue={String(safety?.maxInventoryAbsoluteChange ?? 1000)} />
            <s-number-field label="Max invalid-row rate % (blocks run)" name="maxInvalidRowPercent" defaultValue={String(safety?.maxInvalidRowPercent ?? 10)} />
            <s-number-field label="Max row-count drop % (needs confirm)" name="maxRowCountDecreasePercent" defaultValue={String(safety?.maxRowCountDecreasePercent ?? 50)} />
            <s-checkbox name="allowZeroCost" value="on" label="Allow zero unit cost" {...(safety?.allowZeroCost ? { checked: true } : {})} />
            <s-button type="submit">Save safety policy</s-button>
          </s-stack>
        </Form>
      </s-section>

      <s-section slot="aside" heading="Billing">
        <s-link href="/app/settings/billing">View plan &amp; entitlement</s-link>
      </s-section>
    </s-page>
  );
}

export const headers: HeadersFunction = (h) => boundary.headers(h);
