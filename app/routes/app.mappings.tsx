import type { ActionFunctionArgs, HeadersFunction, LoaderFunctionArgs } from "react-router";
import { Form, useLoaderData, useSearchParams } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { z } from "zod";
import { authenticate } from "../shopify.server";
import { requireShop, requireSupplier } from "../services/shopContext.server";
import { recordAudit } from "../services/audit.server";
import prisma from "../db.server";

const STATUSES = ["matched", "unmatched", "ambiguous", "ignored"] as const;
const PAGE_SIZE = 100;

const schema = z.object({
  intent: z.enum(["map", "unmap", "ignore"]),
  supplierId: z.string(),
  mappingId: z.string(),
  variantId: z.string().optional(),
});

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = await requireShop(session);
  const url = new URL(request.url);
  const supplierId = url.searchParams.get("supplierId") || undefined;
  const status = (url.searchParams.get("status") as (typeof STATUSES)[number]) || undefined;
  const page = Math.max(1, Number(url.searchParams.get("page") || 1));

  const suppliers = await prisma.supplier.findMany({ where: { shopId: shop.id }, orderBy: { name: "asc" } });

  const where = {
    supplier: { shopId: shop.id },
    ...(supplierId ? { supplierId } : {}),
    ...(status ? { status } : {}),
  };
  const [mappings, total] = await Promise.all([
    prisma.supplierProductMapping.findMany({
      where,
      include: { variant: { include: { product: true } }, supplier: true },
      orderBy: { supplierSkuNormalized: "asc" },
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
    }),
    prisma.supplierProductMapping.count({ where }),
  ]);

  // Candidate variants for the currently filtered supplier's unmatched rows.
  const candidateVariants = await prisma.shopifyVariant.findMany({
    where: { shopId: shop.id, activeLocally: true, skuNormalized: { not: null } },
    select: { id: true, skuOriginal: true, product: { select: { title: true } } },
    take: 500,
    orderBy: { skuOriginal: "asc" },
  });

  return {
    suppliers: suppliers.map((s) => ({ id: s.id, name: s.name })),
    supplierId,
    status,
    page,
    totalPages: Math.max(1, Math.ceil(total / PAGE_SIZE)),
    mappings: mappings.map((m) => ({
      id: m.id,
      supplierId: m.supplierId,
      supplier: m.supplier.name,
      sku: m.supplierSkuOriginal,
      status: m.status,
      matchMethod: m.matchMethod,
      variant: m.variant ? `${m.variant.product.title} — ${m.variant.skuOriginal ?? ""}` : null,
    })),
    candidateVariants: candidateVariants.map((v) => ({
      id: v.id,
      label: `${v.product.title} — ${v.skuOriginal ?? ""}`,
    })),
  };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = await requireShop(session);
  const parsed = schema.safeParse(Object.fromEntries(await request.formData()));
  if (!parsed.success) return { error: "Invalid request." };
  const d = parsed.data;
  await requireSupplier(shop.id, d.supplierId);

  const mapping = await prisma.supplierProductMapping.findFirst({
    where: { id: d.mappingId, supplierId: d.supplierId },
  });
  if (!mapping) return { error: "Mapping not found." };

  if (d.intent === "unmap") {
    await prisma.supplierProductMapping.update({
      where: { id: mapping.id },
      data: { variantId: null, status: "unmatched", matchMethod: "explicit" },
    });
  } else if (d.intent === "ignore") {
    await prisma.supplierProductMapping.update({
      where: { id: mapping.id },
      data: { variantId: null, status: "ignored", matchMethod: "ignored" },
    });
  } else if (d.intent === "map" && d.variantId) {
    const variant = await prisma.shopifyVariant.findFirst({ where: { id: d.variantId, shopId: shop.id } });
    if (!variant) return { error: "Variant not found." };
    await prisma.supplierProductMapping.update({
      where: { id: mapping.id },
      data: { variantId: variant.id, status: "matched", matchMethod: "explicit" },
    });
  }

  await recordAudit({
    shopId: shop.id,
    actorType: "merchant",
    actorIdentifier: session.shop,
    action: `mapping_${d.intent}`,
    resourceType: "supplier_product_mapping",
    resourceId: mapping.id,
    summary: `Mapping ${d.intent} for SKU ${mapping.supplierSkuOriginal}.`,
  });
  return { ok: true };
};

export default function Mappings() {
  const data = useLoaderData<typeof loader>();
  const [sp, setSp] = useSearchParams();

  return (
    <s-page heading="Mappings">
      <s-section>
        <s-stack direction="inline" gap="base">
          <s-select
            label="Supplier"
            name="supplierFilter"
            value={data.supplierId ?? ""}
            onChange={(e) => {
              const v = (e.target as HTMLSelectElement).value;
              const next = new URLSearchParams(sp);
              if (v) next.set("supplierId", v);
              else next.delete("supplierId");
              next.delete("page");
              setSp(next);
            }}
          >
            <s-option value="">All suppliers</s-option>
            {data.suppliers.map((s) => (
              <s-option key={s.id} value={s.id}>
                {s.name}
              </s-option>
            ))}
          </s-select>
          <s-stack direction="inline" gap="base">
            {STATUSES.map((st) => (
              <s-link key={st} href={`/app/mappings?${data.supplierId ? `supplierId=${data.supplierId}&` : ""}status=${st}`}>
                {st}
              </s-link>
            ))}
            <s-link href={`/app/mappings${data.supplierId ? `?supplierId=${data.supplierId}` : ""}`}>all</s-link>
          </s-stack>
        </s-stack>
      </s-section>

      <s-section>
        {data.mappings.length === 0 ? (
          <s-paragraph>No mappings for this filter. Run a feed to generate mapping rows.</s-paragraph>
        ) : (
          <s-table>
            <s-table-header-row>
              <s-table-header>Supplier</s-table-header>
              <s-table-header>Supplier SKU</s-table-header>
              <s-table-header>Shopify variant</s-table-header>
              <s-table-header>Status</s-table-header>
              <s-table-header>Actions</s-table-header>
            </s-table-header-row>
            <s-table-body>
              {data.mappings.map((m) => (
                <s-table-row key={m.id}>
                  <s-table-cell>{m.supplier}</s-table-cell>
                  <s-table-cell>{m.sku}</s-table-cell>
                  <s-table-cell>{m.variant ?? "—"}</s-table-cell>
                  <s-table-cell>
                    <s-badge
                      tone={
                        m.status === "matched" ? "success" : m.status === "ambiguous" ? "critical" : m.status === "ignored" ? "neutral" : "warning"
                      }
                    >
                      {m.status}
                    </s-badge>
                  </s-table-cell>
                  <s-table-cell>
                    <Form method="post">
                      <input type="hidden" name="supplierId" value={m.supplierId} />
                      <input type="hidden" name="mappingId" value={m.id} />
                      <s-stack direction="inline" gap="small-300">
                        <select name="variantId" defaultValue="">
                          <option value="">Pick variant…</option>
                          {data.candidateVariants.map((v) => (
                            <option key={v.id} value={v.id}>
                              {v.label}
                            </option>
                          ))}
                        </select>
                        <button type="submit" name="intent" value="map">
                          Map
                        </button>
                        <button type="submit" name="intent" value="unmap">
                          Unmap
                        </button>
                        <button type="submit" name="intent" value="ignore">
                          Ignore
                        </button>
                      </s-stack>
                    </Form>
                  </s-table-cell>
                </s-table-row>
              ))}
            </s-table-body>
          </s-table>
        )}
        {data.totalPages > 1 && (
          <s-stack direction="inline" gap="base">
            {data.page > 1 && (
              <s-link href={`/app/mappings?${sp.toString()}&page=${data.page - 1}`}>Previous</s-link>
            )}
            <s-text>
              Page {data.page} of {data.totalPages}
            </s-text>
            {data.page < data.totalPages && (
              <s-link href={`/app/mappings?${sp.toString()}&page=${data.page + 1}`}>Next</s-link>
            )}
          </s-stack>
        )}
      </s-section>
    </s-page>
  );
}

export const headers: HeadersFunction = (h) => boundary.headers(h);
