import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import { requireShop } from "../services/shopContext.server";
import { EmptyState, runStatusBadge } from "../components/ui";
import prisma from "../db.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = await requireShop(session);
  const url = new URL(request.url);
  const take = 50;
  const page = Math.max(1, Number(url.searchParams.get("page") || 1));

  const [runs, total] = await Promise.all([
    prisma.feedRun.findMany({
      where: { shopId: shop.id },
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * take,
      take,
      include: { supplier: true },
    }),
    prisma.feedRun.count({ where: { shopId: shop.id } }),
  ]);

  return {
    page,
    totalPages: Math.max(1, Math.ceil(total / take)),
    runs: runs.map((r) => ({
      id: r.id,
      supplier: r.supplier.name,
      trigger: r.trigger,
      status: r.status,
      at: r.createdAt.toISOString(),
      rows: r.rowCount,
      matched: r.matchedCount,
      warnings: r.warningCount,
      blocked: r.blockedCount,
      safe: r.safeChangeCount,
    })),
  };
};

export default function RunsIndex() {
  const { runs, page, totalPages } = useLoaderData<typeof loader>();
  return (
    <s-page heading="Runs">
      <s-section>
        {runs.length === 0 ? (
          <EmptyState
            icon="file"
            heading="No feed runs yet"
            action={{ label: "Go to suppliers", href: "/app/suppliers" }}
          >
            Upload a CSV or trigger a URL feed from a supplier to create your first run.
          </EmptyState>
        ) : (
          <s-table>
            <s-table-header-row>
              <s-table-header>When</s-table-header>
              <s-table-header>Supplier</s-table-header>
              <s-table-header>Source</s-table-header>
              <s-table-header>Rows</s-table-header>
              <s-table-header>Matched</s-table-header>
              <s-table-header>Safe</s-table-header>
              <s-table-header>Warnings</s-table-header>
              <s-table-header>Blocked</s-table-header>
              <s-table-header>Status</s-table-header>
              <s-table-header></s-table-header>
            </s-table-header-row>
            <s-table-body>
              {runs.map((r) => (
                <s-table-row key={r.id}>
                  <s-table-cell>
                    <s-text color="subdued">{new Date(r.at).toLocaleString()}</s-text>
                  </s-table-cell>
                  <s-table-cell>
                    <s-text type="strong">{r.supplier}</s-text>
                  </s-table-cell>
                  <s-table-cell>{r.trigger.replace(/_/g, " ")}</s-table-cell>
                  <s-table-cell>{r.rows}</s-table-cell>
                  <s-table-cell>{r.matched}</s-table-cell>
                  <s-table-cell>
                    <s-text tone={r.safe > 0 ? "success" : "auto"}>{r.safe}</s-text>
                  </s-table-cell>
                  <s-table-cell>
                    <s-text tone={r.warnings > 0 ? "warning" : "auto"}>{r.warnings}</s-text>
                  </s-table-cell>
                  <s-table-cell>
                    <s-text tone={r.blocked > 0 ? "critical" : "auto"}>{r.blocked}</s-text>
                  </s-table-cell>
                  <s-table-cell>{runStatusBadge(r.status)}</s-table-cell>
                  <s-table-cell>
                    <s-link href={r.status === "ready_for_review" ? `/app/runs/${r.id}/review` : `/app/runs/${r.id}`}>
                      {r.status === "ready_for_review" ? "Review" : "Open"}
                    </s-link>
                  </s-table-cell>
                </s-table-row>
              ))}
            </s-table-body>
          </s-table>
        )}
        {totalPages > 1 && (
          <s-stack direction="inline" gap="base">
            {page > 1 && <s-link href={`/app/runs?page=${page - 1}`}>Previous</s-link>}
            <s-text>
              Page {page} of {totalPages}
            </s-text>
            {page < totalPages && <s-link href={`/app/runs?page=${page + 1}`}>Next</s-link>}
          </s-stack>
        )}
      </s-section>
    </s-page>
  );
}

export const headers: HeadersFunction = (h) => boundary.headers(h);
