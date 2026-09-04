import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import { requireShop } from "../services/shopContext.server";
import { Callout, EmptyState, runStatusBadge, useLiveRefresh } from "../components/ui";
import { computeProgress } from "../domain/progress";
import { formatDateTime } from "../utils/format";
import prisma from "../db.server";

const ACTIVE_STATUSES = ["queued", "fetching", "parsing", "validating", "mapping", "calculating", "applying"];

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
      startedAt: r.startedAt?.toISOString() ?? null,
      rows: r.rowCount,
      matched: r.matchedCount,
      warnings: r.warningCount,
      blocked: r.blockedCount,
      safe: r.safeChangeCount,
      progressPhase: r.progressPhase,
      progressDone: r.progressDone,
      progressTotal: r.progressTotal,
      active: ACTIVE_STATUSES.includes(r.status),
    })),
  };
};

export default function RunsIndex() {
  const { runs, page, totalPages } = useLoaderData<typeof loader>();
  useLiveRefresh(runs.some((r) => r.active));
  return (
    <s-page heading="Runs">
      {runs.length > 0 && (
        <s-section>
          <Callout tone="info" icon="clock-revert" title="Every feed you process shows up here">
            A run moves through fetch → parse → validate → match → calculate, then waits at{" "}
            <s-text type="strong">Ready for review</s-text>. Nothing is written to Shopify until you approve a run&apos;s
            change set.
          </Callout>
        </s-section>
      )}
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
                    <s-text color="subdued">{formatDateTime(r.at)}</s-text>
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
                  <s-table-cell>
                    <s-stack direction="block" gap="none">
                      {runStatusBadge(r.status)}
                      {r.active ? (
                        <s-text color="subdued">
                          {(() => {
                            const p = computeProgress(
                              {
                                phase: r.progressPhase,
                                done: r.progressDone,
                                total: r.progressTotal,
                                startedAt: r.startedAt,
                                active: true,
                              },
                              // Deterministic across server render + client hydration: anchor
                              // "now" to startedAt (0s elapsed) instead of reading the wall
                              // clock, which would render different text on each side and
                              // trigger a React hydration mismatch. The next periodic
                              // useLiveRefresh poll brings in real elapsed/ETA.
                              r.startedAt ? new Date(r.startedAt).getTime() : undefined,
                            );
                            return `${r.progressPhase ?? "Working"} · ${p.percent}%${p.etaLabel ? ` · ${p.etaLabel}` : ""}`;
                          })()}
                        </s-text>
                      ) : null}
                    </s-stack>
                  </s-table-cell>
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
