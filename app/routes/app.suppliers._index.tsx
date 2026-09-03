import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import { requireShop } from "../services/shopContext.server";
import prisma from "../db.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = await requireShop(session);
  const suppliers = await prisma.supplier.findMany({
    where: { shopId: shop.id },
    orderBy: { createdAt: "desc" },
    include: {
      _count: { select: { productMappings: true } },
      feedRuns: { orderBy: { createdAt: "desc" }, take: 1 },
    },
  });
  const mappedCounts = await prisma.supplierProductMapping.groupBy({
    by: ["supplierId"],
    where: { supplier: { shopId: shop.id }, status: "matched" },
    _count: { _all: true },
  });
  const mappedBySupplier = new Map(mappedCounts.map((m) => [m.supplierId, m._count._all]));

  return {
    suppliers: suppliers.map((s) => ({
      id: s.id,
      name: s.name,
      code: s.code,
      status: s.status,
      feedType: s.feedType,
      schedule: s.schedule,
      lastRunAt: s.lastRunAt?.toISOString() ?? null,
      lastSuccessAt: s.lastSuccessAt?.toISOString() ?? null,
      lastRunStatus: s.feedRuns[0]?.status ?? null,
      mappedPercent:
        s._count.productMappings > 0
          ? Math.round(((mappedBySupplier.get(s.id) ?? 0) / s._count.productMappings) * 100)
          : 0,
    })),
  };
};

export default function SuppliersIndex() {
  const { suppliers } = useLoaderData<typeof loader>();
  return (
    <s-page heading="Suppliers">
      <s-button slot="primary-action" href="/app/suppliers/new">
        Add supplier
      </s-button>
      <s-section>
        {suppliers.length === 0 ? (
          <s-paragraph>No suppliers yet. Add one to import a supplier feed.</s-paragraph>
        ) : (
          <s-table>
            <s-table-header-row>
              <s-table-header>Supplier</s-table-header>
              <s-table-header>Source</s-table-header>
              <s-table-header>Schedule</s-table-header>
              <s-table-header>Last run</s-table-header>
              <s-table-header>Mapped</s-table-header>
              <s-table-header>Status</s-table-header>
              <s-table-header>Actions</s-table-header>
            </s-table-header-row>
            <s-table-body>
              {suppliers.map((s) => (
                <s-table-row key={s.id}>
                  <s-table-cell>
                    <s-link href={`/app/suppliers/${s.id}`}>{s.name}</s-link>
                    <s-text> ({s.code})</s-text>
                  </s-table-cell>
                  <s-table-cell>{s.feedType === "url_csv" ? "URL CSV" : "Manual CSV"}</s-table-cell>
                  <s-table-cell>{s.schedule.replace(/_/g, " ")}</s-table-cell>
                  <s-table-cell>
                    {s.lastRunAt ? `${new Date(s.lastRunAt).toLocaleDateString()} — ${s.lastRunStatus ?? ""}` : "—"}
                  </s-table-cell>
                  <s-table-cell>{s.mappedPercent}%</s-table-cell>
                  <s-table-cell>
                    <s-badge tone={s.status === "active" ? "success" : "neutral"}>{s.status}</s-badge>
                  </s-table-cell>
                  <s-table-cell>
                    <s-link href={`/app/suppliers/${s.id}`}>Open</s-link>
                  </s-table-cell>
                </s-table-row>
              ))}
            </s-table-body>
          </s-table>
        )}
      </s-section>
    </s-page>
  );
}

export const headers: HeadersFunction = (h) => boundary.headers(h);
