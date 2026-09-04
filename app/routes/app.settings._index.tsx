import { useRef } from "react";
import type { ActionFunctionArgs, HeadersFunction, LoaderFunctionArgs } from "react-router";
import { useFetcher, useLoaderData } from "react-router";
import { readFields, sanitizeShopifyGid } from "../components/domForm";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { z } from "zod";
import { authenticate } from "../shopify.server";
import { requireShop, markOnboarding } from "../services/shopContext.server";
import { recordAudit } from "../services/audit.server";
import { requestCatalogSync } from "../services/catalogSyncRequest.server";
import { Callout, JobProgress, StatCard, StatGrid, useLiveRefresh } from "../components/ui";
import { formatDateTime, formatNumber } from "../utils/format";
import prisma from "../db.server";

const schema = z.object({
  intent: z.enum(["location", "safety", "catalog-sync"]),
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
  const { session, admin } = await authenticate.admin(request);
  const shop = await requireShop(session);
  const [safety, lastSync, variantCount] = await Promise.all([
    prisma.safetyPolicy.findUnique({ where: { shopId: shop.id } }),
    prisma.catalogSync.findFirst({ where: { shopId: shop.id }, orderBy: { startedAt: "desc" } }),
    prisma.shopifyVariant.count({ where: { shopId: shop.id, activeLocally: true } }),
  ]);

  // List the shop's real Shopify locations directly (don't derive from synced
  // inventory — a store can have locations with no stock).
  let locations: Array<{ gid: string; name: string }> = [];
  try {
    const res = await admin.graphql(
      `#graphql
      query MarginPilotSettingsLocations {
        locations(first: 50, includeInactive: false) {
          edges { node { id name } }
        }
      }`,
    );
    const body = (await res.json()) as {
      data?: { locations?: { edges?: Array<{ node?: { id?: string; name?: string } }> } };
    };
    locations = (body.data?.locations?.edges ?? [])
      .map((e) => ({ gid: e.node?.id ?? "", name: e.node?.name ?? e.node?.id ?? "" }))
      .filter((l) => l.gid);
  } catch {
    locations = [];
  }

  return {
    shop: { defaultLocationGid: shop.defaultLocationGid, currencyCode: shop.currencyCode, timezone: shop.timezone },
    locations,
    safety: safety && {
      maxPriceDecreasePercent: Number(safety.maxPriceDecreasePercent),
      maxPriceIncreasePercent: Number(safety.maxPriceIncreasePercent),
      maxInventoryChangePercent: Number(safety.maxInventoryChangePercent),
      maxInventoryAbsoluteChange: safety.maxInventoryAbsoluteChange,
      maxInvalidRowPercent: Number(safety.maxInvalidRowPercent),
      maxRowCountDecreasePercent: Number(safety.maxRowCountDecreasePercent),
      allowZeroCost: safety.allowZeroCost,
    },
    lastSync: lastSync && {
      status: lastSync.status,
      at: (lastSync.completedAt ?? lastSync.startedAt).toISOString(),
      startedAt: lastSync.startedAt.toISOString(),
      variantCount: lastSync.variantCount,
      errorSummary: lastSync.errorSummary,
      progressPhase: lastSync.progressPhase,
      progressDone: lastSync.progressDone,
      progressTotal: lastSync.progressTotal,
      active: lastSync.status === "queued" || lastSync.status === "running",
    },
    variantCount,
  };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = await requireShop(session);
  const parsed = schema.safeParse(Object.fromEntries(await request.formData()));
  if (!parsed.success) {
    const first = Object.values(parsed.error.flatten().fieldErrors)[0]?.[0];
    return { error: first ?? "Check the values." };
  }
  const d = parsed.data;

  try {
    if (d.intent === "catalog-sync") {
      return Response.json(await requestCatalogSync(shop, session.shop));
    }

    if (d.intent === "location") {
      const locationGid = sanitizeShopifyGid(d.defaultLocationGid, "Location");
      await prisma.shop.update({ where: { id: shop.id }, data: { defaultLocationGid: locationGid } });
      await markOnboarding(shop.id, { selectedLocation: Boolean(locationGid) });
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
  } catch (err) {
    console.error("[settings] action failed", err);
    const message = err instanceof Error ? err.message : String(err);
    return { error: `Could not save: ${message}` };
  }
};

export default function Settings() {
  const { shop, locations, safety, lastSync, variantCount } = useLoaderData<typeof loader>();
  const sync = useFetcher<{ ok: boolean; catalogSyncId?: string; alreadyRunning?: boolean; message?: string }>();
  const saveLocation = useFetcher<{ ok?: boolean; error?: string }>();
  const saveSafety = useFetcher<{ ok?: boolean; error?: string }>();
  const syncActive = Boolean(lastSync?.active) || sync.state !== "idle";
  useLiveRefresh(syncActive);

  const locationRef = useRef<HTMLDivElement>(null);
  const safetyRef = useRef<HTMLDivElement>(null);

  const submitLocation = () => {
    const f = readFields(locationRef.current, { defaultLocationGid: "text" });
    saveLocation.submit({ intent: "location", ...f }, { method: "post" });
  };
  const submitSafety = () => {
    const f = readFields(safetyRef.current, {
      maxPriceDecreasePercent: "text",
      maxPriceIncreasePercent: "text",
      maxInventoryChangePercent: "text",
      maxInventoryAbsoluteChange: "text",
      maxInvalidRowPercent: "text",
      maxRowCountDecreasePercent: "text",
      allowZeroCost: "check",
    });
    saveSafety.submit({ intent: "safety", ...f }, { method: "post" });
  };

  return (
    <s-page heading="Settings">
      <s-section heading="Shopify catalog">
        <s-stack direction="block" gap="base">
          <Callout tone="info" icon="refresh" title="Keep your catalog in sync">
            MarginPilot needs an up-to-date copy of your products, variants, SKUs, prices and inventory to match supplier
            rows against. This is read-only and safe to run any time — do it after you add or edit products in Shopify.
          </Callout>

          <StatGrid>
            <StatCard label="Active variants imported" value={formatNumber(variantCount)} icon="product" tone="info" />
            <StatCard
              label="Last sync"
              value={lastSync ? lastSync.status : "Never"}
              icon="refresh"
              tone={
                lastSync?.status === "completed"
                  ? "success"
                  : lastSync?.status === "failed"
                    ? "critical"
                    : "neutral"
              }
              caption={lastSync ? formatDateTime(lastSync.at) : "Run a sync to get started"}
            />
          </StatGrid>

          {lastSync?.active ? (
            <s-box padding="base" borderRadius="base" borderWidth="base" background="base">
              <JobProgress
                phase={lastSync.progressPhase}
                done={lastSync.progressDone}
                total={lastSync.progressTotal}
                startedAt={lastSync.startedAt}
                active
              />
            </s-box>
          ) : null}

          {lastSync?.status === "failed" && lastSync.errorSummary ? (
            <s-banner tone="critical" heading="Last sync failed">
              <s-paragraph>{lastSync.errorSummary}</s-paragraph>
            </s-banner>
          ) : null}

          <s-button
            type="button"
            variant="primary"
            onClick={() => sync.submit({ intent: "catalog-sync" }, { method: "post" })}
            {...(sync.state !== "idle" || lastSync?.active ? { loading: true } : {})}
          >
            {lastSync?.active ? "Sync running…" : "Sync catalog now"}
          </s-button>
          {sync.data?.ok && !lastSync?.active && (
            <s-banner tone="success">
              {sync.data.alreadyRunning ? "A sync is already running." : "Catalog sync queued — it runs in the background."}
            </s-banner>
          )}
          {sync.data && !sync.data.ok && <s-banner tone="critical">{sync.data.message ?? "Could not start the sync."}</s-banner>}
        </s-stack>
      </s-section>

      <s-section heading="Default inventory location">
        <div ref={locationRef}>
          <s-stack direction="block" gap="base">
            <s-select
              label="Location"
              name="defaultLocationGid"
              value={shop.defaultLocationGid ?? ""}
              details="Where MarginPilot writes inventory quantities. A supplier can override this. Locations appear here after a catalog sync."
            >
              <s-option value="">Not set</s-option>
              {locations.map((l) => (
                <s-option key={l.gid} value={l.gid}>
                  {l.name}
                </s-option>
              ))}
            </s-select>
            <s-text color="subdued">
              Currency: {shop.currencyCode} · Time zone: {shop.timezone}
            </s-text>
            <s-button
              type="button"
              variant="primary"
              onClick={submitLocation}
              {...(saveLocation.state !== "idle" ? { loading: true } : {})}
            >
              Save location
            </s-button>
            {saveLocation.data?.error && <s-banner tone="critical">{saveLocation.data.error}</s-banner>}
          </s-stack>
        </div>
      </s-section>

      <s-section heading="Safety policy">
        <Callout tone="warning" icon="shield-check-mark" title="These thresholds block dangerous changes">
          A row that exceeds any limit is marked <s-text type="strong">blocked</s-text> and cannot be applied until you
          fix the data or override that single row. Run-level limits can stop a whole feed.
        </Callout>
        <div ref={safetyRef}>
          <s-stack direction="block" gap="base">
            <s-text color="subdued">Per-row limits — a row past any of these is blocked.</s-text>
            <s-number-field
              label="Max price decrease %"
              name="maxPriceDecreasePercent"
              defaultValue={String(safety?.maxPriceDecreasePercent ?? 20)}
              details="Block a row if the recommended price is more than this % below the current price."
            />
            <s-number-field
              label="Max price increase %"
              name="maxPriceIncreasePercent"
              defaultValue={String(safety?.maxPriceIncreasePercent ?? 50)}
              details="Block a row if the recommended price is more than this % above the current price."
            />
            <s-number-field
              label="Max inventory change %"
              name="maxInventoryChangePercent"
              defaultValue={String(safety?.maxInventoryChangePercent ?? 90)}
              details="Block a row if the quantity would move by more than this % of the current quantity."
            />
            <s-number-field
              label="Max inventory change (absolute units)"
              name="maxInventoryAbsoluteChange"
              defaultValue={String(safety?.maxInventoryAbsoluteChange ?? 1000)}
              details="Block a row if the quantity would move by more than this many units."
            />
            <s-divider />
            <s-text color="subdued">Whole-run limits — these can stop an entire feed.</s-text>
            <s-number-field
              label="Max invalid-row rate %"
              name="maxInvalidRowPercent"
              defaultValue={String(safety?.maxInvalidRowPercent ?? 10)}
              details="If more than this % of rows fail validation, the whole run is blocked."
            />
            <s-number-field
              label="Max row-count drop %"
              name="maxRowCountDecreasePercent"
              defaultValue={String(safety?.maxRowCountDecreasePercent ?? 50)}
              details="If this feed has this much fewer rows than the last successful run, it needs your confirmation."
            />
            <s-checkbox
              name="allowZeroCost"
              value="on"
              label="Allow zero unit cost"
              details="Off by default — a $0 cost is usually a feed error and is blocked."
              {...(safety?.allowZeroCost ? { checked: true } : {})}
            />
            <s-button
              type="button"
              variant="primary"
              onClick={submitSafety}
              {...(saveSafety.state !== "idle" ? { loading: true } : {})}
            >
              Save safety policy
            </s-button>
            {saveSafety.data?.error && <s-banner tone="critical">{saveSafety.data.error}</s-banner>}
          </s-stack>
        </div>
      </s-section>

      <s-section slot="aside" heading="Billing">
        <s-link href="/app/settings/billing">View plan &amp; entitlement</s-link>
      </s-section>
    </s-page>
  );
}

export const headers: HeadersFunction = (h) => boundary.headers(h);
