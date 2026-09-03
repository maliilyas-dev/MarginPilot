import type { ActionFunctionArgs, HeadersFunction, LoaderFunctionArgs } from "react-router";
import { Form, redirect, useActionData, useLoaderData } from "react-router";
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
  currencyCode: z.string().length(3).optional(),
  schedule: z.enum(["manual", "hourly", "every_6_hours", "daily"]),
  timezone: z.string().max(60).optional(),
  defaultLocationGid: z.string().optional(),
  barcodeMatching: z.union([z.literal("on"), z.literal("")]).optional(),
});

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = await requireShop(session);
  const locations = await prisma.variantInventory.findMany({
    where: { variant: { shopId: shop.id } },
    distinct: ["locationGid"],
    select: { locationGid: true },
  });
  return { defaultLocationGid: shop.defaultLocationGid, timezone: shop.timezone, locations: locations.map((l) => l.locationGid) };
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
};

export default function NewSupplier() {
  const { locations, timezone } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const errors = (actionData?.errors ?? {}) as Record<string, string[]>;

  return (
    <s-page heading="Add supplier">
      <s-button slot="primary-action" href="/app/suppliers" variant="tertiary">
        Cancel
      </s-button>
      {errors._form && (
        <s-section>
          <s-banner tone="critical">{errors._form.join(" ")}</s-banner>
        </s-section>
      )}
      <Form method="post">
        <s-section heading="Identity">
          <s-stack direction="block" gap="base">
            <s-text-field label="Supplier name" name="name" required error={errors.name?.[0]} />
            <s-text-field
              label="Supplier code / short name"
              name="code"
              details="Letters, numbers, dashes. Used to identify feeds and must be unique."
              required
              error={errors.code?.[0]}
            />
          </s-stack>
        </s-section>

        <s-section heading="Feed source">
          <s-stack direction="block" gap="base">
            <Callout tone="info" icon="lightbulb">
              Choose <s-text type="strong">Manual CSV</s-text> to upload files yourself, or{" "}
              <s-text type="strong">Scheduled URL CSV</s-text> to have MarginPilot fetch from a URL on a schedule. URL
              feeds are SSRF-protected: private networks, oversized responses and long redirects are refused.
            </Callout>
            <s-select label="Feed type" name="feedType" value="upload_csv">
              <s-option value="upload_csv">Manual CSV upload</s-option>
              <s-option value="url_csv">Scheduled URL CSV</s-option>
            </s-select>
            <s-text-field label="Feed URL (URL sources only)" name="feedUrl" error={errors.feedUrl?.[0]} />
            <s-text-field label="HTTP Basic username (optional)" name="basicUser" />
            <s-password-field
              label="HTTP Basic password (optional)"
              name="basicPass"
              details="Stored encrypted (AES-256-GCM). Never shown again after saving."
            />
          </s-stack>
        </s-section>

        <s-section heading="CSV format">
          <s-stack direction="block" gap="base">
            <s-select label="Delimiter" name="delimiter" value="auto">
              <s-option value="auto">Auto-detect</s-option>
              <s-option value="comma">Comma</s-option>
              <s-option value="semicolon">Semicolon</s-option>
              <s-option value="tab">Tab</s-option>
              <s-option value="pipe">Pipe</s-option>
            </s-select>
            <s-select label="Decimal separator" name="decimalSeparator" value="dot">
              <s-option value="dot">Dot (1,234.56)</s-option>
              <s-option value="comma">Comma (1.234,56)</s-option>
            </s-select>
            <s-text-field label="Thousands separator (optional)" name="thousandsSeparator" />
            <s-text-field label="Currency code" name="currencyCode" details="Display only in Release 1" />
          </s-stack>
        </s-section>

        <s-section heading="Schedule &amp; location">
          <s-stack direction="block" gap="base">
            <s-select label="Schedule" name="schedule" value="manual" error={errors.schedule?.[0]}>
              <s-option value="manual">Manual</s-option>
              <s-option value="daily">Daily</s-option>
              <s-option value="every_6_hours">Every 6 hours</s-option>
              <s-option value="hourly">Hourly</s-option>
            </s-select>
            <s-text-field label="Time zone" name="timezone" defaultValue={timezone} />
            <s-select label="Default Shopify location" name="defaultLocationGid">
              <s-option value="">Use shop default</s-option>
              {locations.map((l) => (
                <s-option key={l} value={l}>
                  {l}
                </s-option>
              ))}
            </s-select>
          </s-stack>
        </s-section>

        <s-section heading="Matching">
          <s-stack direction="block" gap="base">
            <s-checkbox name="barcodeMatching" value="on" label="Also match by barcode when the SKU does not match" />
            <s-button type="submit" variant="primary">
              Create supplier
            </s-button>
          </s-stack>
        </s-section>
      </Form>
    </s-page>
  );
}

export const headers: HeadersFunction = (h) => boundary.headers(h);
