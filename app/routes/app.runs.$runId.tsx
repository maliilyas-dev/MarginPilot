import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { useLoaderData, useRevalidator } from "react-router";
import { useEffect } from "react";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import { requireShop, requireFeedRun } from "../services/shopContext.server";
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
        <s-stack direction="block" gap="small-300">
          <s-badge tone={run.status === "completed" ? "success" : run.status === "failed" ? "critical" : "info"}>
            {run.status.replace(/_/g, " ")}
          </s-badge>
          <s-text>Started {new Date(run.at).toLocaleString()}</s-text>
          {run.completedAt && <s-text>Finished {new Date(run.completedAt).toLocaleString()}</s-text>}
          {run.errorSummary && <s-banner tone="critical">{run.errorSummary}</s-banner>}
          <s-link href={`/app/resources/runs/${run.id}/export`} download="">
            Export rows (CSV)
          </s-link>
        </s-stack>
      </s-section>

      <s-section heading="Import results">
        <s-stack direction="inline" gap="base">
          <s-text>Rows {run.counts.rows}</s-text>
          <s-text>Valid {run.counts.valid}</s-text>
          <s-text>Invalid {run.counts.invalid}</s-text>
          <s-text>Matched {run.counts.matched}</s-text>
          <s-text>Unmatched {run.counts.unmatched}</s-text>
          <s-text>Ambiguous {run.counts.ambiguous}</s-text>
        </s-stack>
        <s-stack direction="inline" gap="base">
          <s-badge tone="success">Safe {run.counts.safe}</s-badge>
          <s-badge tone="warning">Warnings {run.counts.warning}</s-badge>
          <s-badge tone="critical">Blocked {run.counts.blocked}</s-badge>
        </s-stack>
      </s-section>

      {changeSet && (
        <s-section heading="Apply results">
          <s-text>Change set: {changeSet.status.replace(/_/g, " ")}</s-text>
          <s-stack direction="inline" gap="base">
            {Object.entries(changeSet.items).map(([k, v]) => (
              <s-text key={k}>
                {k}: {v as number}
              </s-text>
            ))}
          </s-stack>
          {failedItems.length > 0 && (
            <s-stack direction="block" gap="small-300">
              <s-heading>Failed items</s-heading>
              {failedItems.map((f) => (
                <s-text key={f.id}>
                  {f.variant}: {f.error}
                </s-text>
              ))}
            </s-stack>
          )}
        </s-section>
      )}
    </s-page>
  );
}

export const headers: HeadersFunction = (h) => boundary.headers(h);
