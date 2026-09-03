import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { useLoaderData, useRevalidator } from "react-router";
import { useEffect } from "react";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import { requireShop, requireFeedRun } from "../services/shopContext.server";
import { StatCard, StatGrid, runStatusBadge } from "../components/ui";
import prisma from "../db.server";

const ACTIVE = ["queued", "fetching", "parsing", "validating", "mapping", "calculating", "applying"];

export const loader = async ({ request, params }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = await requireShop(session);
  const run = await requireFeedRun(shop.id, params.runId!);
  const supplier = await prisma.supplier.findUnique({ where: { id: run.supplierId } });

  const changeSet = await prisma.changeSet.findFirst({
    where: { feedRunId: run.id },
    orderBy: { createdAt: "desc" },
  });
  const itemStatus = changeSet
    ? await prisma.changeItem.groupBy({ by: ["status"], where: { changeSetId: changeSet.id }, _count: { _all: true } })
    : [];
  const failedItems = changeSet
    ? await prisma.changeItem.findMany({
        where: { changeSetId: changeSet.id, status: "failed" },
        include: { variant: true },
        take: 50,
      })
    : [];

  return {
    run: {
      id: run.id,
      status: run.status,
      supplier: supplier?.name ?? "",
      trigger: run.trigger,
      at: run.createdAt.toISOString(),
      completedAt: run.completedAt?.toISOString() ?? null,
      errorSummary: run.errorSummary,
      counts: {
        rows: run.rowCount, valid: run.validCount, invalid: run.invalidCount,
        matched: run.matchedCount, unmatched: run.unmatchedCount, ambiguous: run.ambiguousCount,
        safe: run.safeChangeCount, warning: run.warningCount, blocked: run.blockedCount,
      },
    },
    changeSet: changeSet
      ? { id: changeSet.id, status: changeSet.status, items: Object.fromEntries(itemStatus.map((s) => [s.status, s._count._all])) }
      : null,
    failedItems: failedItems.map((i) => ({
      id: i.id,
      variant: i.variant.skuOriginal ?? i.variant.shopifyVariantGid,
      error: i.lastError,
      userErrors: i.shopifyUserErrors,
    })),
    isActive: ACTIVE.includes(run.status) || changeSet?.status === "applying",
  };
};

export default function RunDetail() {
  const { run, changeSet, failedItems, isActive } = useLoaderData<typeof loader>();
  const revalidator = useRevalidator();

  useEffect(() => {
    if (!isActive) return;
    const t = setInterval(() => revalidator.revalidate(), 3000);
    return () => clearInterval(t);
  }, [isActive, revalidator]);

  return (
    <s-page heading={`Run — ${run.supplier}`}>
      {run.status === "ready_for_review" && (
        <s-button slot="primary-action" href={`/app/runs/${run.id}/review`}>
          Review changes
        </s-button>
      )}
      <s-section heading="Status">
        <s-stack direction="block" gap="base">
          <s-stack direction="inline" gap="base" alignItems="center">
            {runStatusBadge(run.status)}
            {isActive ? <s-spinner size="base" /> : null}
          </s-stack>
          <s-text color="subdued">
            Started {new Date(run.at).toLocaleString()}
            {run.completedAt ? ` · finished ${new Date(run.completedAt).toLocaleString()}` : ""}
          </s-text>
          {run.errorSummary && <s-banner tone="critical">{run.errorSummary}</s-banner>}
          <div>
            <s-link href={`/app/resources/runs/${run.id}/export`} download="">
              Export rows (CSV)
            </s-link>
          </div>
        </s-stack>
      </s-section>

      <s-section heading="Import results">
        <StatGrid>
          <StatCard label="Rows" value={run.counts.rows} icon="list-bulleted" />
          <StatCard label="Valid" value={run.counts.valid} icon="check-circle" tone="success" />
          <StatCard label="Invalid" value={run.counts.invalid} icon="x-circle" tone={run.counts.invalid > 0 ? "critical" : "neutral"} />
          <StatCard label="Matched" value={run.counts.matched} icon="connect" tone="info" />
          <StatCard label="Unmatched" value={run.counts.unmatched} icon="question-circle" tone={run.counts.unmatched > 0 ? "caution" : "neutral"} />
          <StatCard label="Ambiguous" value={run.counts.ambiguous} icon="alert-triangle" tone={run.counts.ambiguous > 0 ? "warning" : "neutral"} />
          <StatCard label="Safe changes" value={run.counts.safe} icon="check-circle" tone="success" />
          <StatCard label="Warnings" value={run.counts.warning} icon="alert-triangle" tone={run.counts.warning > 0 ? "warning" : "neutral"} />
          <StatCard label="Blocked" value={run.counts.blocked} icon="lock" tone={run.counts.blocked > 0 ? "critical" : "neutral"} />
        </StatGrid>
      </s-section>

      {changeSet && (
        <s-section heading="Apply results">
          <s-stack direction="block" gap="base">
            <s-stack direction="inline" gap="base" alignItems="center">
              <s-text type="strong">Change set</s-text>
              {runStatusBadge(changeSet.status)}
            </s-stack>
            <s-stack direction="inline" gap="small-200">
              {Object.entries(changeSet.items).map(([k, v]) => (
                <s-badge
                  key={k}
                  tone={k === "succeeded" ? "success" : k === "failed" ? "critical" : "neutral"}
                >
                  {k}: {v as number}
                </s-badge>
              ))}
            </s-stack>
            {failedItems.length > 0 && (
              <s-box padding="base" borderRadius="base" borderWidth="base" background="base">
                <s-stack direction="block" gap="small-300">
                  <s-text type="strong">Failed items</s-text>
                  {failedItems.map((f) => (
                    <s-text key={f.id} color="subdued">
                      {f.variant}: {f.error}
                    </s-text>
                  ))}
                </s-stack>
              </s-box>
            )}
          </s-stack>
        </s-section>
      )}
    </s-page>
  );
}

export const headers: HeadersFunction = (h) => boundary.headers(h);
