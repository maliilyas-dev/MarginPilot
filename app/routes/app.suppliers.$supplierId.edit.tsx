import type { ActionFunctionArgs, HeadersFunction, LoaderFunctionArgs } from "react-router";
import { Form, redirect, useActionData, useLoaderData } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { z } from "zod";
import { authenticate } from "../shopify.server";
import { requireShop, requireSupplier } from "../services/shopContext.server";
import { canUseSchedule } from "../services/entitlements.server";
import { encryptCredentials } from "../services/encryption.server";
import { recordAudit } from "../services/audit.server";
import prisma from "../db.server";

const schema = z.object({
  name: z.string().min(1).max(120),
  status: z.enum(["active", "inactive"]),
  feedUrl: z.string().url().optional().or(z.literal("")),
  basicUser: z.string().max(200).optional(),
  basicPass: z.string().max(400).optional(),
  delimiter: z.enum(["auto", "comma", "semicolon", "tab", "pipe"]),
  decimalSeparator: z.enum(["dot", "comma"]),
  thousandsSeparator: z.string().max(2).optional(),
  schedule: z.enum(["manual", "hourly", "every_6_hours", "daily"]),
  timezone: z.string().max(60).optional(),
  barcodeMatching: z.union([z.literal("on"), z.literal("")]).optional(),
});

export const loader = async ({ request, params }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = await requireShop(session);
  const s = await requireSupplier(shop.id, params.supplierId!);
  return {
    supplier: {
      id: s.id, name: s.name, status: s.status, feedType: s.feedType, feedUrl: s.feedUrl ?? "",
      credentialsConfigured: Boolean(s.encryptedCredentials), delimiter: s.delimiter,
      decimalSeparator: s.decimalSeparator, thousandsSeparator: s.thousandsSeparator ?? "",
      schedule: s.schedule, timezone: s.timezone, barcodeMatching: s.barcodeMatching,
    },
  };
};

export const action = async ({ request, params }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = await requireShop(session);
  const supplier = await requireSupplier(shop.id, params.supplierId!);
  const parsed = schema.safeParse(Object.fromEntries(await request.formData()));
  if (!parsed.success) return { error: "Check the values." };
  const d = parsed.data;

  const schedGate = await canUseSchedule(shop.id, shop.shopDomain, d.schedule);
  if (!schedGate.allowed) return { error: schedGate.reason };

  const credsProvided = Boolean(d.basicUser || d.basicPass);
  await prisma.supplier.update({
    where: { id: supplier.id },
    data: {
      name: d.name,
      status: d.status,
      feedUrl: supplier.feedType === "url_csv" ? d.feedUrl || null : supplier.feedUrl,
      ...(credsProvided
        ? { encryptedCredentials: encryptCredentials({ username: d.basicUser, password: d.basicPass }) }
        : {}),
      delimiter: d.delimiter,
      decimalSeparator: d.decimalSeparator,
      thousandsSeparator: d.thousandsSeparator || null,
      schedule: d.schedule,
      timezone: d.timezone || shop.timezone,
      barcodeMatching: d.barcodeMatching === "on",
    },
  });
  await recordAudit({
    shopId: shop.id, actorType: "merchant", actorIdentifier: session.shop,
    action: "supplier_updated", resourceType: "supplier", resourceId: supplier.id,
    summary: `Updated supplier ${d.name}.`,
  });
  return redirect(`/app/suppliers/${supplier.id}`);
};

export default function EditSupplier() {
  const { supplier } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  return (
    <s-page heading={`Edit ${supplier.name}`}>
      <s-button slot="primary-action" href={`/app/suppliers/${supplier.id}`} variant="tertiary">
        Cancel
      </s-button>
      {actionData?.error && (
        <s-section>
          <s-banner tone="critical">{actionData.error}</s-banner>
        </s-section>
      )}
      <Form method="post">
        <s-section heading="Identity">
          <s-stack direction="block" gap="base">
            <s-text-field label="Supplier name" name="name" defaultValue={supplier.name} required />
            <s-select label="Status" name="status" value={supplier.status}>
              <s-option value="active">Active</s-option>
              <s-option value="inactive">Inactive</s-option>
            </s-select>
          </s-stack>
        </s-section>

        {supplier.feedType === "url_csv" && (
          <s-section heading="Connection">
            <s-stack direction="block" gap="base">
              <s-text-field label="Feed URL" name="feedUrl" defaultValue={supplier.feedUrl} />
              <s-text-field label="HTTP Basic username (leave blank to keep)" name="basicUser" />
              <s-password-field label="HTTP Basic password (leave blank to keep)" name="basicPass" />
              <s-badge tone={supplier.credentialsConfigured ? "success" : "neutral"} icon={supplier.credentialsConfigured ? "check-circle" : "circle"}>
                {supplier.credentialsConfigured ? "Credentials configured" : "No credentials"}
              </s-badge>
            </s-stack>
          </s-section>
        )}

        <s-section heading="CSV format">
          <s-stack direction="block" gap="base">
            <s-select label="Delimiter" name="delimiter" value={supplier.delimiter}>
              <s-option value="auto">Auto-detect</s-option>
              <s-option value="comma">Comma</s-option>
              <s-option value="semicolon">Semicolon</s-option>
              <s-option value="tab">Tab</s-option>
              <s-option value="pipe">Pipe</s-option>
            </s-select>
            <s-select label="Decimal separator" name="decimalSeparator" value={supplier.decimalSeparator}>
              <s-option value="dot">Dot</s-option>
              <s-option value="comma">Comma</s-option>
            </s-select>
            <s-text-field label="Thousands separator" name="thousandsSeparator" defaultValue={supplier.thousandsSeparator} />
          </s-stack>
        </s-section>

        <s-section heading="Schedule &amp; matching">
          <s-stack direction="block" gap="base">
            <s-select label="Schedule" name="schedule" value={supplier.schedule}>
              <s-option value="manual">Manual</s-option>
              <s-option value="daily">Daily</s-option>
              <s-option value="every_6_hours">Every 6 hours</s-option>
              <s-option value="hourly">Hourly</s-option>
            </s-select>
            <s-text-field label="Time zone" name="timezone" defaultValue={supplier.timezone} />
            <s-checkbox name="barcodeMatching" value="on" label="Also match by barcode" {...(supplier.barcodeMatching ? { checked: true } : {})} />
            <s-button type="submit" variant="primary">
              Save changes
            </s-button>
          </s-stack>
        </s-section>
      </Form>
    </s-page>
  );
}

export const headers: HeadersFunction = (h) => boundary.headers(h);
