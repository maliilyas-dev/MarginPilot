import { useRef, useState } from "react";
import type { ActionFunctionArgs, HeadersFunction, LoaderFunctionArgs } from "react-router";
import { redirect, useFetcher, useLoaderData } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { z } from "zod";
import { authenticate } from "../shopify.server";
import { requireShop, markOnboarding } from "../services/shopContext.server";
import { canAddSupplier, canUseUrlFeed, canUseSchedule } from "../services/entitlements.server";
import { encryptCredentials } from "../services/encryption.server";
import { recordAudit, hashIp } from "../services/audit.server";
import { Callout } from "../components/ui";
import prisma from "../db.server";

const schema = z.object({
  name: z.string().min(1).max(120),
  code: z.string().min(1).max(40).regex(/^[a-zA-Z0-9_-]+$/, "Use letters, numbers, dashes or underscores"),
  feedType: z.enum(["upload_csv", "url_csv"]),
  feedUrl: z.string().url().optional().or(z.literal("")),
  basicUser: z.string().max(200).optional(),
  basicPass: z.string().max(400).optional(),
  delimiter: z.enum(["auto", "comma", "semicolon", "tab", "pipe"]),
  decimalSeparator: z.enum(["dot", "comma"]),
  thousandsSeparator: z.string().max(2).optional(),
  currencyCode: z.string().length(3).optional().or(z.literal("")),
  schedule: z.enum(["manual", "hourly", "every_6_hours", "daily"]),
  timezone: z.string().max(60).optional(),
  defaultLocationGid: z.string().optional(),
  barcodeMatching: z.union([z.literal("on"), z.literal("")]).optional(),
});

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session, admin } = await authenticate.admin(request);
  const shop = await requireShop(session);
  let locations: Array<{ gid: string; name: string }> = [];
  try {
    const res = await admin.graphql(
      `#graphql
      query MarginPilotNewSupplierLocations {
        locations(first: 50, includeInactive: false) { edges { node { id name } } }
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
  return { defaultLocationGid: shop.defaultLocationGid, timezone: shop.timezone, locations };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = await requireShop(session);

  const form = Object.fromEntries(await request.formData());
  const parsed = schema.safeParse(form);
  if (!parsed.success) {
    return { errors: parsed.error.flatten().fieldErrors };
  }
  const d = parsed.data;

  try {
    const gate = await canAddSupplier(shop.id, shop.shopDomain);
    if (!gate.allowed) return { errors: { _form: [gate.reason ?? "Plan limit reached"] } };

    if (d.feedType === "url_csv") {
      const urlGate = await canUseUrlFeed(shop.id, shop.shopDomain);
      if (!urlGate.allowed) return { errors: { _form: [urlGate.reason ?? "URL feeds not on your plan"] } };
      if (!d.feedUrl) return { errors: { feedUrl: ["A feed URL is required for URL sources."] } };
    }
    const schedGate = await canUseSchedule(shop.id, shop.shopDomain, d.schedule);
    if (!schedGate.allowed) return { errors: { schedule: [schedGate.reason ?? "Schedule not on your plan"] } };

    const existing = await prisma.supplier.findFirst({ where: { shopId: shop.id, code: d.code } });
    if (existing) return { errors: { code: ["A supplier with that code already exists."] } };

    const supplier = await prisma.supplier.create({
      data: {
        shopId: shop.id,
        name: d.name,
        code: d.code,
        feedType: d.feedType,
        feedUrl: d.feedType === "url_csv" ? d.feedUrl || null : null,
        encryptedCredentials:
          d.feedType === "url_csv" ? encryptCredentials({ username: d.basicUser, password: d.basicPass }) : null,
        delimiter: d.delimiter,
        decimalSeparator: d.decimalSeparator,
        thousandsSeparator: d.thousandsSeparator || null,
        currencyCode: d.currencyCode || shop.currencyCode,
        schedule: d.schedule,
        timezone: d.timezone || shop.timezone,
        defaultLocationGid: d.defaultLocationGid || shop.defaultLocationGid,
        barcodeMatching: d.barcodeMatching === "on",
      },
    });

    await markOnboarding(shop.id, { supplierAdded: true });
    await recordAudit({
      shopId: shop.id,
      actorType: "merchant",
      actorIdentifier: session.shop,
      action: "supplier_created",
      resourceType: "supplier",
      resourceId: supplier.id,
      summary: `Created supplier ${supplier.name} (${supplier.code})`,
      ip: request.headers.get("x-forwarded-for"),
    });
    void hashIp;

    return redirect(`/app/suppliers/${supplier.id}`);
  } catch (err) {
    if (err instanceof Response) throw err; // let redirect() through
    console.error("[suppliers.new] action failed", err);
    const message = err instanceof Error ? err.message : String(err);
    return { errors: { _form: [`Could not create the supplier: ${message}`] } };
  }
};

export default function NewSupplier() {
  const { locations, timezone } = useLoaderData<typeof loader>();
  const fetcher = useFetcher<typeof action>();
  const actionData = fetcher.data;
  const errors = (actionData?.errors ?? {}) as Record<string, string[]>;
  const [feedType, setFeedType] = useState<"upload_csv" | "url_csv">("upload_csv");
  const isUrl = feedType === "url_csv";
  const rootRef = useRef<HTMLDivElement>(null);
  const submitting = fetcher.state !== "idle";

  // Read every field's live value straight off the DOM at submit time and post
  // it as an explicit payload — no dependence on Polaris fields feeding native
  // FormData, no submit-button event, no form element at all.
  const submit = () => {
    const root = rootRef.current;
    if (!root) return;
    const val = (name: string) => {
      const el = root.querySelector(`[name="${name}"]`) as (HTMLElement & { value?: unknown }) | null;
      return el?.value == null ? "" : String(el.value);
    };
    const checked = (name: string) => {
      const el = root.querySelector(`[name="${name}"]`) as (HTMLElement & { checked?: boolean }) | null;
      return el?.checked ? "on" : "";
    };
    fetcher.submit(
      {
        name: val("name"),
        code: val("code"),
        feedType,
        feedUrl: val("feedUrl"),
        basicUser: val("basicUser"),
        basicPass: val("basicPass"),
        delimiter: val("delimiter") || "auto",
        decimalSeparator: val("decimalSeparator") || "dot",
        thousandsSeparator: val("thousandsSeparator"),
        currencyCode: val("currencyCode"),
        schedule: val("schedule") || "manual",
        timezone: val("timezone") || timezone,
        defaultLocationGid: val("defaultLocationGid"),
        barcodeMatching: checked("barcodeMatching"),
      },
      { method: "post" },
    );
  };

  return (
    <s-page heading="Add supplier">
      {errors._form && (
        <s-section>
          <s-banner tone="critical">{errors._form.join(" ")}</s-banner>
        </s-section>
      )}
      <div ref={rootRef}>
        <s-section heading="Identity">
          <s-stack direction="block" gap="base">
            <s-text-field
              label="Supplier name"
              name="name"
              placeholder="e.g. Acme Auto Parts Distribution"
              details="Shown throughout MarginPilot. Use the name you recognise the supplier by."
              required
              error={errors.name?.[0]}
            />
            <s-text-field
              label="Supplier code"
              name="code"
              placeholder="e.g. acme-auto"
              details="A short unique handle (letters, numbers, dashes). Used in run history and exports. You can't change it later."
              required
              error={errors.code?.[0]}
            />
          </s-stack>
        </s-section>

        <s-section heading="Feed source">
          <s-stack direction="block" gap="base">
            <s-select
              label="How does this supplier's data arrive?"
              name="feedType"
              value={feedType}
              onChange={(e) => setFeedType((e.target as HTMLSelectElement).value as "upload_csv" | "url_csv")}
            >
              <s-option value="upload_csv">I will upload a CSV file each time</s-option>
              <s-option value="url_csv">Fetch a CSV from a URL on a schedule</s-option>
            </s-select>

            {isUrl ? (
              <>
                <Callout tone="info" icon="shield-check-mark" title="URL feeds are fetched safely">
                  MarginPilot refuses private/loopback addresses, limits redirects and response size, and times out — so
                  a bad or malicious URL can&apos;t reach your internal network. You can test the connection from the
                  supplier page before the first real run.
                </Callout>
                <s-text-field
                  label="Feed URL"
                  name="feedUrl"
                  placeholder="https://supplier.example.com/exports/stock.csv"
                  details="Direct link to a CSV. Google Sheets 'publish to web → CSV' links work too."
                  error={errors.feedUrl?.[0]}
                />
                <s-text-field
                  label="HTTP Basic username"
                  name="basicUser"
                  details="Only if the URL is password-protected. Leave blank otherwise."
                />
                <s-password-field
                  label="HTTP Basic password"
                  name="basicPass"
                  details="Stored encrypted (AES-256-GCM) and never shown again after saving."
                />
              </>
            ) : (
              <Callout tone="info" icon="upload" title="Manual upload">
                You&apos;ll drop a CSV onto the supplier page whenever you want to sync. Nothing is fetched automatically.
                You can switch this supplier to a scheduled URL later.
              </Callout>
            )}
          </s-stack>
        </s-section>

        <s-section heading="CSV format">
          <s-stack direction="block" gap="base">
            <s-text color="subdued">
              Only change these if your supplier&apos;s file isn&apos;t a standard comma-separated, dot-decimal CSV.
              Auto-detect handles most files.
            </s-text>
            <s-select label="Column delimiter" name="delimiter" value="auto">
              <s-option value="auto">Auto-detect (recommended)</s-option>
              <s-option value="comma">Comma ,</s-option>
              <s-option value="semicolon">Semicolon ;</s-option>
              <s-option value="tab">Tab</s-option>
              <s-option value="pipe">Pipe |</s-option>
            </s-select>
            <s-select
              label="Decimal separator"
              name="decimalSeparator"
              value="dot"
              details="How the supplier writes decimals in prices and costs."
            >
              <s-option value="dot">Dot — 1,234.56</s-option>
              <s-option value="comma">Comma — 1.234,56</s-option>
            </s-select>
            <s-text-field
              label="Thousands separator"
              name="thousandsSeparator"
              placeholder="usually blank"
              details="Leave blank unless the supplier groups thousands with an unusual character."
            />
            <s-text-field
              label="Currency code"
              name="currencyCode"
              placeholder="USD"
              details="Display only in this release — MarginPilot does not convert currencies."
            />
          </s-stack>
        </s-section>

        <s-section heading="Schedule &amp; location">
          <s-stack direction="block" gap="base">
            <s-select
              label="Run schedule"
              name="schedule"
              value="manual"
              details={
                isUrl
                  ? "How often to fetch and process the URL. You still approve every change set."
                  : "Leave on Manual for uploaded files."
              }
              error={errors.schedule?.[0]}
            >
              <s-option value="manual">Manual — only when I trigger it</s-option>
              <s-option value="daily">Daily</s-option>
              <s-option value="every_6_hours">Every 6 hours</s-option>
              <s-option value="hourly">Hourly</s-option>
            </s-select>
            <s-text-field
              label="Time zone"
              name="timezone"
              defaultValue={timezone}
              details="Used to interpret the schedule. Timestamps are always stored in UTC."
            />
            <s-select
              label="Shopify location for inventory writes"
              name="defaultLocationGid"
              details="Where this supplier's stock levels are applied. Defaults to your shop-wide setting."
            >
              <s-option value="">Use shop default</s-option>
              {locations.map((l) => (
                <s-option key={l.gid} value={l.gid}>
                  {l.name}
                </s-option>
              ))}
            </s-select>
          </s-stack>
        </s-section>

        <s-section heading="SKU matching">
          <s-stack direction="block" gap="base">
            <s-checkbox
              name="barcodeMatching"
              value="on"
              label="Also match by barcode when the SKU doesn't match"
              details="MarginPilot always tries exact SKU first. Enable this to fall back to an exact barcode match. It never matches on product title."
            />
            <s-stack direction="inline" gap="base" alignItems="center">
              <s-button
                type="button"
                variant="primary"
                onClick={submit}
                {...(submitting ? { loading: true } : {})}
              >
                {submitting ? "Creating…" : "Create supplier"}
              </s-button>
              <s-link href="/app/suppliers">Cancel</s-link>
            </s-stack>
          </s-stack>
        </s-section>
      </div>

      <s-section slot="aside" heading="What happens next">
        <s-stack direction="block" gap="small-300">
          <s-text color="subdued">After you create the supplier you&apos;ll:</s-text>
          <s-ordered-list>
            <s-list-item>Upload a CSV (or test the URL) on the supplier page.</s-list-item>
            <s-list-item>Map its columns to supplier SKU, quantity and unit cost — saved after the first time.</s-list-item>
            <s-list-item>Review matches, then a safe change preview.</s-list-item>
            <s-list-item>Approve exactly what you want applied to Shopify.</s-list-item>
          </s-ordered-list>
          <s-link href="/app/guide">Open the full guide</s-link>
        </s-stack>
      </s-section>
    </s-page>
  );
}

export const headers: HeadersFunction = (h) => boundary.headers(h);
