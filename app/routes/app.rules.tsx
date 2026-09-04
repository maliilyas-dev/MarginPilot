import type { ActionFunctionArgs, HeadersFunction, LoaderFunctionArgs } from "react-router";
import { useRef } from "react";
import { useFetcher, useLoaderData } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { z } from "zod";
import { authenticate } from "../shopify.server";
import { requireShop } from "../services/shopContext.server";
import { recordAudit } from "../services/audit.server";
import { Callout, EmptyState } from "../components/ui";
import { readFields } from "../components/domForm";
import prisma from "../db.server";

const num = z.coerce.number().finite();
const schema = z.object({
  intent: z.enum(["create", "delete"]),
  id: z.string().optional(),
  name: z.string().min(1).max(120).optional(),
  supplierId: z.string().optional(),
  priority: num.optional(),
  vendorFilter: z.string().max(120).optional(),
  productTypeFilter: z.string().max(120).optional(),
  minimumMarginPercent: num.optional(),
  markupPercent: num.optional(),
  fixedHandlingPerUnit: num.optional(),
  dutyPercent: num.optional(),
  otherCostPercent: num.optional(),
  roundingRule: z.enum(["none", "whole", "end_99", "end_95", "end_97"]).optional(),
  minimumPrice: z.string().optional(),
  maximumPrice: z.string().optional(),
});

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = await requireShop(session);
  const [rules, suppliers] = await Promise.all([
    prisma.pricingRule.findMany({ where: { shopId: shop.id }, orderBy: { priority: "asc" }, include: { supplier: true } }),
    prisma.supplier.findMany({ where: { shopId: shop.id }, orderBy: { name: "asc" } }),
  ]);
  return {
    rules: rules.map((r) => ({
      id: r.id,
      name: r.name,
      supplier: r.supplier?.name ?? "All suppliers",
      priority: r.priority,
      minimumMarginPercent: Number(r.minimumMarginPercent),
      markupPercent: Number(r.markupPercent),
      roundingRule: r.roundingRule,
      vendorFilter: r.vendorFilter,
      productTypeFilter: r.productTypeFilter,
    })),
    suppliers: suppliers.map((s) => ({ id: s.id, name: s.name })),
  };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = await requireShop(session);
  const parsed = schema.safeParse(Object.fromEntries(await request.formData()));
  if (!parsed.success) return { error: "Check the form values." };
  const d = parsed.data;

  if (d.intent === "delete" && d.id) {
    await prisma.pricingRule.deleteMany({ where: { id: d.id, shopId: shop.id } });
    await recordAudit({ shopId: shop.id, actorType: "merchant", action: "pricing_rule_deleted", resourceType: "pricing_rule", resourceId: d.id, summary: "Deleted a pricing rule." });
    return { ok: true };
  }

  if ((d.minimumMarginPercent ?? 0) >= 100) {
    return { error: "Minimum margin percent must be less than 100." };
  }

  const rule = await prisma.pricingRule.create({
    data: {
      shopId: shop.id,
      supplierId: d.supplierId || null,
      name: d.name || "Rule",
      priority: d.priority ?? 100,
      vendorFilter: d.vendorFilter || null,
      productTypeFilter: d.productTypeFilter || null,
      minimumMarginPercent: d.minimumMarginPercent ?? 0,
      markupPercent: d.markupPercent ?? 0,
      fixedHandlingPerUnit: d.fixedHandlingPerUnit ?? 0,
      dutyPercent: d.dutyPercent ?? 0,
      otherCostPercent: d.otherCostPercent ?? 0,
      roundingRule: d.roundingRule ?? "none",
      minimumPrice: d.minimumPrice ? d.minimumPrice : null,
      maximumPrice: d.maximumPrice ? d.maximumPrice : null,
    },
  });
  await recordAudit({ shopId: shop.id, actorType: "merchant", action: "pricing_rule_created", resourceType: "pricing_rule", resourceId: rule.id, summary: `Created pricing rule ${rule.name}.` });
  return { ok: true };
};

export default function Rules() {
  const { rules, suppliers } = useLoaderData<typeof loader>();
  const create = useFetcher<typeof action>();
  const del = useFetcher<typeof action>();
  const actionData = create.data ?? del.data;
  const formRef = useRef<HTMLDivElement>(null);
  const creating = create.state !== "idle";

  const addRule = () => {
    const f = readFields(formRef.current, {
      name: "text", supplierId: "text", priority: "text", vendorFilter: "text",
      productTypeFilter: "text", fixedHandlingPerUnit: "text", dutyPercent: "text",
      otherCostPercent: "text", minimumMarginPercent: "text", markupPercent: "text",
      roundingRule: "text", minimumPrice: "text", maximumPrice: "text",
    });
    create.submit({ intent: "create", ...f }, { method: "post" });
  };

  return (
    <s-page heading="Pricing rules">
      <s-section>
        <Callout tone="info" icon="calculator" title="How rules choose a price">
          Landed cost = supplier cost + freight + handling + duty% + other%. The recommended price is the higher of the
          minimum-margin price and the markup price, then rounded and clamped to your min/max. Lower priority number
          wins; a supplier-specific rule beats a shop-wide one at the same priority.
        </Callout>
      </s-section>

      <s-section heading="Active rules">
        {actionData?.error && <s-banner tone="critical">{actionData.error}</s-banner>}
        {rules.length === 0 ? (
          <EmptyState icon="calculator" heading="No pricing rules yet">
            Add a rule below. Without one, matched rows can still be previewed but have no recommended price.
          </EmptyState>
        ) : (
          <s-table>
            <s-table-header-row>
              <s-table-header>#</s-table-header>
              <s-table-header>Name</s-table-header>
              <s-table-header>Scope</s-table-header>
              <s-table-header>Min margin %</s-table-header>
              <s-table-header>Markup %</s-table-header>
              <s-table-header>Rounding</s-table-header>
              <s-table-header></s-table-header>
            </s-table-header-row>
            <s-table-body>
              {rules.map((r) => (
                <s-table-row key={r.id}>
                  <s-table-cell>
                    <s-badge>{r.priority}</s-badge>
                  </s-table-cell>
                  <s-table-cell>
                    <s-text type="strong">{r.name}</s-text>
                  </s-table-cell>
                  <s-table-cell>
                    <s-badge tone={r.supplier === "All suppliers" ? "neutral" : "info"}>{r.supplier}</s-badge>
                  </s-table-cell>
                  <s-table-cell>{r.minimumMarginPercent}%</s-table-cell>
                  <s-table-cell>{r.markupPercent}%</s-table-cell>
                  <s-table-cell>{r.roundingRule.replace(/_/g, " ")}</s-table-cell>
                  <s-table-cell>
                    <s-button
                      type="button"
                      variant="tertiary"
                      onClick={() => del.submit({ intent: "delete", id: r.id }, { method: "post" })}
                      {...(del.state !== "idle" ? { loading: true } : {})}
                    >
                      Delete
                    </s-button>
                  </s-table-cell>
                </s-table-row>
              ))}
            </s-table-body>
          </s-table>
        )}
      </s-section>

      <div ref={formRef}>

        <s-section heading="New rule — scope">
          <s-stack direction="block" gap="base">
            <s-text-field
              label="Rule name"
              name="name"
              placeholder="e.g. Auto parts — 40% floor"
              details="Just a label so you recognise it in the list."
              required
            />
            <s-select
              label="Applies to"
              name="supplierId"
              value=""
              details="A supplier-specific rule beats a shop-wide one at the same priority."
            >
              <s-option value="">All suppliers (shop-wide)</s-option>
              {suppliers.map((s) => (
                <s-option key={s.id} value={s.id}>
                  {s.name}
                </s-option>
              ))}
            </s-select>
            <s-number-field
              label="Priority"
              name="priority"
              defaultValue="100"
              details="Lower number wins when more than one rule could apply."
            />
            <s-text-field
              label="Only products from this Shopify vendor"
              name="vendorFilter"
              placeholder="optional"
              details="Leave blank to apply regardless of vendor."
            />
            <s-text-field
              label="Only this Shopify product type"
              name="productTypeFilter"
              placeholder="optional"
            />
          </s-stack>
        </s-section>

        <s-section heading="Extra costs to fold into landed cost">
          <s-stack direction="block" gap="base">
            <s-number-field
              label="Fixed handling cost per unit"
              name="fixedHandlingPerUnit"
              defaultValue="0"
              details="A flat amount added to every unit (your currency)."
            />
            <s-number-field
              label="Duty %"
              name="dutyPercent"
              defaultValue="0"
              details="Percentage of supplier unit cost added as import duty."
            />
            <s-number-field
              label="Other cost %"
              name="otherCostPercent"
              defaultValue="0"
              details="Any other percentage-based cost (insurance, broker fees…)."
            />
          </s-stack>
        </s-section>

        <s-section heading="Margin &amp; markup">
          <s-stack direction="block" gap="base">
            <s-number-field
              label="Minimum gross margin %"
              name="minimumMarginPercent"
              defaultValue="0"
              details="The recommended price will never sit below this margin on landed cost. Must be under 100."
            />
            <s-number-field
              label="Markup %"
              name="markupPercent"
              defaultValue="0"
              details="Recommended price is the higher of the minimum-margin price and (landed cost + this markup)."
            />
          </s-stack>
        </s-section>

        <s-section heading="Rounding &amp; guard rails">
          <s-stack direction="block" gap="base">
            <s-select label="Round the recommended price" name="roundingRule" value="none">
              <s-option value="none">Do not round</s-option>
              <s-option value="whole">Nearest whole amount</s-option>
              <s-option value="end_99">End in .99</s-option>
              <s-option value="end_95">End in .95</s-option>
              <s-option value="end_97">End in .97</s-option>
            </s-select>
            <s-text-field
              label="Never price below"
              name="minimumPrice"
              placeholder="optional"
              details="A hard floor applied after rounding."
            />
            <s-text-field
              label="Never price above"
              name="maximumPrice"
              placeholder="optional"
              details="A hard ceiling applied after rounding."
            />
            <s-button type="button" variant="primary" onClick={addRule} {...(creating ? { loading: true } : {})}>
              {creating ? "Adding…" : "Add rule"}
            </s-button>
          </s-stack>
        </s-section>
      </div>

      <s-section slot="aside" heading="Worked example">
        <s-box padding="base" borderRadius="base" background="subdued">
          <pre style={{ margin: 0, whiteSpace: "pre-wrap", fontSize: 12, lineHeight: 1.6 }}>
{`supplier unit cost   10.00
+ freight (per row)   1.00
+ handling            0.50
+ duty 5%             0.50
= landed cost        12.00

min margin 40%  -> 12.00 / (1 - .40) = 20.00
markup 30%      -> 12.00 x 1.30       = 15.60
recommended     -> max(20.00, 15.60)  = 20.00
round .99       -> 20.99  (then min/max clamp)`}
          </pre>
        </s-box>
        <s-text color="subdued">
          Freight is read per row from the feed if you mapped that column; everything else comes from the rule.
        </s-text>
      </s-section>
    </s-page>
  );
}

export const headers: HeadersFunction = (h) => boundary.headers(h);
