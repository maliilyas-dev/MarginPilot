import type { ActionFunctionArgs, HeadersFunction, LoaderFunctionArgs } from "react-router";
import { useRef } from "react";
import { useFetcher, useLoaderData } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import { requireShop, requireFeedRun } from "../services/shopContext.server";
import { recordAudit } from "../services/audit.server";
import { describeReason, type ReasonCodeValue } from "../domain/safety/reasonCodes";
import { Callout, StatCard, StatGrid, classificationBadge, useLiveRefresh } from "../components/ui";
import { readFields } from "../components/domForm";
import prisma from "../db.server";

const FILTERS = ["all", "safe", "warning", "blocked", "unmatched", "invalid", "unchanged"] as const;
type Filter = (typeof FILTERS)[number];
const PAGE_SIZE = 100;
const ACTIVE = ["queued", "fetching", "parsing", "validating", "mapping", "calculating", "applying"];

export const loader = async ({ request, params }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = await requireShop(session);
  const run = await requireFeedRun(shop.id, params.runId!);

  const url = new URL(request.url);
  const filter = (url.searchParams.get("filter") as Filter) || "all";
  const page = Math.max(1, Number(url.searchParams.get("page") || 1));
  const approveError = url.searchParams.get("approveError");

  const where = {
    feedRunId: run.id,
    ...(filter !== "all" ? { classification: filter } : {}),
  };

  const [rows, total, groupCounts] = await Promise.all([
    prisma.proposedChange.findMany({
      where,
      include: { feedRow: true, variant: { include: { product: true } } },
      orderBy: { feedRow: { rowNumber: "asc" } },
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
    }),
    prisma.proposedChange.count({ where }),
    prisma.proposedChange.groupBy({ by: ["classification"], where: { feedRunId: run.id }, _count: { _all: true } }),
  ]);

  const counts: Record<string, number> = {};
  for (const g of groupCounts) counts[g.classification] = g._count._all;

  // Financial exposure summary (spec 5.7)
  const safeRows = await prisma.proposedChange.findMany({
    where: { feedRunId: run.id, classification: "safe" },
    select: { currentPrice: true, recommendedPrice: true },
  });
  let priceDelta = 0;
  for (const r of safeRows) {
    if (r.currentPrice && r.recommendedPrice) priceDelta += Number(r.recommendedPrice) - Number(r.currentPrice);
  }

  return {
    run: { id: run.id, status: run.status, blocked: run.blockedCount, active: ACTIVE.includes(run.status) },
    approveError,
    filter,
    page,
    total,
    totalPages: Math.max(1, Math.ceil(total / PAGE_SIZE)),
    counts,
    exposure: { affectedVariants: safeRows.length, priceDelta: Number(priceDelta.toFixed(2)) },
    rows: rows.map((r) => ({
      id: r.id,
      row: r.feedRow.rowNumber,
      sku: r.feedRow.supplierSkuOriginal,
      variant: r.variant ? `${r.variant.product.title} — ${r.variant.skuOriginal ?? ""}` : null,
      classification: r.classification,
      currentQuantity: r.currentQuantity,
      proposedQuantity: r.proposedQuantity,
      currentPrice: r.currentPrice ? r.currentPrice.toString() : null,
      recommendedPrice: r.recommendedPrice ? r.recommendedPrice.toString() : null,
      landedCost: r.landedCost ? r.landedCost.toString() : null,
      recommendedMarginPercent: r.recommendedMarginPercent ? Number(r.recommendedMarginPercent).toFixed(1) : null,
      reasons: (r.reasonCodes as ReasonCodeValue[]).map(describeReason),
      overrideApproved: r.overrideApproved,
      selectable: r.classification === "safe" || (r.classification === "blocked" && r.overrideApproved),
    })),
  };
};

export const action = async ({ request, params }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = await requireShop(session);
  const run = await requireFeedRun(shop.id, params.runId!);
  const form = await request.formData();
  const intent = form.get("intent");

  if (intent === "override") {
    const id = String(form.get("proposedChangeId"));
    if (form.get("confirm") !== "yes") {
      return Response.json({ ok: false, message: "Override requires confirmation." }, { status: 400 });
    }
    const pc = await prisma.proposedChange.findFirst({ where: { id, feedRunId: run.id } });
    if (!pc) return Response.json({ ok: false }, { status: 404 });
    await prisma.proposedChange.update({ where: { id }, data: { overrideApproved: true } });
    await recordAudit({
      shopId: shop.id,
      actorType: "merchant",
      actorIdentifier: session.shop,
      action: "safety_override",
      resourceType: "proposed_change",
      resourceId: id,
      summary: `Overrode a blocked row (run ${run.id}).`,
      beforeData: { reasonCodes: pc.reasonCodes },
    });
    return Response.json({ ok: true });
  }

  return Response.json({ ok: false, message: "Unknown action." }, { status: 400 });
};

const CLASSES = ["safe", "warning", "blocked", "unmatched", "invalid", "unchanged"] as const;
const toneFor: Record<string, "success" | "warning" | "critical" | "neutral"> = {
  safe: "success",
  warning: "warning",
  blocked: "critical",
  unmatched: "neutral",
  invalid: "critical",
  unchanged: "neutral",
};

export default function Review() {
  const data = useLoaderData<typeof loader>();
  const override = useFetcher();
  const approve = useFetcher();
  const approveRef = useRef<HTMLDivElement>(null);
  useLiveRefresh(data.run.active);

  const doApprove = () => {
    const root = approveRef.current;
    if (!root) return;
    const ids = Array.from(root.querySelectorAll<HTMLInputElement>('input[name="proposedChangeId"]:checked')).map(
      (el) => el.value,
    );
    const flags = readFields(root, { updatePrice: "check", updateInventory: "check", updateUnitCost: "check" });
    const fd = new FormData();
    for (const id of ids) fd.append("proposedChangeId", id);
    if (flags.updatePrice) fd.append("updatePrice", "on");
    if (flags.updateInventory) fd.append("updateInventory", "on");
    if (flags.updateUnitCost) fd.append("updateUnitCost", "on");
    fd.append("confirm", "yes");
    approve.submit(fd, { method: "post", action: `/app/actions/runs/${data.run.id}/approve` });
  };

  const doOverride = (proposedChangeId: string) => {
    override.submit(
      { intent: "override", proposedChangeId, confirm: "yes" },
      { method: "post", action: `/app/runs/${data.run.id}/review` },
    );
  };

  const ready = data.run.status === "ready_for_review";

  return (
    <s-page heading="Review changes">
      {data.run.active && !ready ? (
        <s-section>
          <Callout tone="info" icon="clock" title="Still processing">
            MarginPilot is still calculating this run. This page will refresh automatically when it&apos;s ready.
          </Callout>
        </s-section>
      ) : null}

      {data.approveError ? (
        <s-section>
          <s-banner tone="critical" heading="Could not approve">
            <s-paragraph>{data.approveError}</s-paragraph>
          </s-banner>
        </s-section>
      ) : null}

      <s-section>
        <Callout tone="info" icon="view" title="How to approve">
          Everything below is a <s-text type="strong">preview</s-text> — nothing reaches Shopify yet. Safe rows are
          pre-selected. Tick the boxes for the rows you want, choose whether to update price, inventory or both at the
          bottom, then <s-text type="strong">Approve selected changes</s-text>. Blocked rows can&apos;t be selected until
          you fix the data or override them individually.
        </Callout>
      </s-section>

      <s-section heading="Summary">
        {data.run.blocked > 0 && (
          <s-banner tone="warning" heading={`${data.run.blocked} row(s) blocked by a safety policy`}>
            <s-paragraph>
              Blocked rows cannot be selected. Fix the supplier data and re-run, or override a specific row below (each
              override is logged).
            </s-paragraph>
          </s-banner>
        )}

        <StatGrid>
          {CLASSES.map((c) => (
            <StatCard
              key={c}
              label={c[0].toUpperCase() + c.slice(1)}
              value={data.counts[c] ?? 0}
              tone={toneFor[c]}
              href={`/app/runs/${data.run.id}/review?filter=${c}`}
            />
          ))}
        </StatGrid>
      </s-section>

      <s-section heading="Financial exposure">
        <s-stack direction="block" gap="small-200">
          <span style={{ fontSize: "1.6rem", fontWeight: 650, letterSpacing: "-0.01em" }}>
            {data.exposure.priceDelta >= 0 ? "+" : "−"}
            {Math.abs(data.exposure.priceDelta).toLocaleString(undefined, { minimumFractionDigits: 2 })}
          </span>
          <s-text color="subdued">
            Total selling-price change across {data.exposure.affectedVariants} safe variant(s) if you approve all safe
            rows.
          </s-text>
        </s-stack>
      </s-section>

      <s-section>
        <s-stack direction="inline" gap="small-200">
          {FILTERS.map((f) => (
            <s-button
              key={f}
              href={`/app/runs/${data.run.id}/review?filter=${f}`}
              variant={data.filter === f ? "primary" : "tertiary"}
            >
              {f}
              {data.counts[f] !== undefined ? ` (${data.counts[f]})` : ""}
            </s-button>
          ))}
        </s-stack>
      </s-section>

      <div ref={approveRef}>
        <s-section>
          <div style={{ overflowX: "auto" }}>
            <s-table>
              <s-table-header-row>
                <s-table-header>Pick</s-table-header>
                <s-table-header>Row</s-table-header>
                <s-table-header>Supplier SKU</s-table-header>
                <s-table-header>Shopify variant</s-table-header>
                <s-table-header>Inventory</s-table-header>
                <s-table-header>Price → recommended</s-table-header>
                <s-table-header>Landed / margin</s-table-header>
                <s-table-header>Status</s-table-header>
                <s-table-header>Why</s-table-header>
              </s-table-header-row>
              <s-table-body>
                {data.rows.map((r) => (
                  <s-table-row key={r.id}>
                    <s-table-cell>
                      <input
                        type="checkbox"
                        name="proposedChangeId"
                        value={r.id}
                        disabled={!r.selectable}
                        defaultChecked={r.classification === "safe"}
                        aria-label={`Select row ${r.row}`}
                      />
                    </s-table-cell>
                    <s-table-cell>{r.row}</s-table-cell>
                    <s-table-cell>
                      <s-text type="strong">{r.sku ?? "—"}</s-text>
                    </s-table-cell>
                    <s-table-cell>{r.variant ?? <s-text color="subdued">Unmatched</s-text>}</s-table-cell>
                    <s-table-cell>
                      {r.currentQuantity ?? "—"} → {r.proposedQuantity ?? "—"}
                    </s-table-cell>
                    <s-table-cell>
                      {r.currentPrice ?? "—"} → <s-text type="strong">{r.recommendedPrice ?? "—"}</s-text>
                    </s-table-cell>
                    <s-table-cell>
                      {r.landedCost ?? "—"} / {r.recommendedMarginPercent ? `${r.recommendedMarginPercent}%` : "—"}
                    </s-table-cell>
                    <s-table-cell>
                      <s-stack direction="block" gap="small-300">
                        {classificationBadge(r.classification)}
                        {r.classification === "blocked" && !r.overrideApproved && (
                          <s-button
                            type="button"
                            variant="tertiary"
                            onClick={() => doOverride(r.id)}
                            {...(override.state !== "idle" ? { loading: true } : {})}
                          >
                            Override
                          </s-button>
                        )}
                      </s-stack>
                    </s-table-cell>
                    <s-table-cell>
                      <s-text color="subdued">{r.reasons.join("; ")}</s-text>
                    </s-table-cell>
                  </s-table-row>
                ))}
              </s-table-body>
            </s-table>
          </div>

          {data.totalPages > 1 && (
            <s-stack direction="inline" gap="base">
              {data.page > 1 && (
                <s-link href={`/app/runs/${data.run.id}/review?filter=${data.filter}&page=${data.page - 1}`}>
                  Previous
                </s-link>
              )}
              <s-text>
                Page {data.page} of {data.totalPages}
              </s-text>
              {data.page < data.totalPages && (
                <s-link href={`/app/runs/${data.run.id}/review?filter=${data.filter}&page=${data.page + 1}`}>Next</s-link>
              )}
            </s-stack>
          )}
        </s-section>

        <s-section heading="Approve &amp; apply">
          <s-stack direction="block" gap="base">
            <s-banner tone="info">
              <s-paragraph>
                Approving creates an immutable change set and queues Shopify updates in the background. You can close this
                tab — the job keeps running. Nothing is written to Shopify until you approve.
              </s-paragraph>
            </s-banner>
            <s-stack direction="block" gap="small-300">
              <s-checkbox name="updatePrice" value="on" label="Update selling price" />
              <s-checkbox name="updateInventory" value="on" label="Update inventory quantity" />
              <s-checkbox name="updateUnitCost" value="on" label="Update unit cost (if authorized)" />
            </s-stack>
            <s-button
              type="button"
              variant="primary"
              onClick={doApprove}
              {...(!ready ? { disabled: true } : {})}
              {...(approve.state !== "idle" ? { loading: true } : {})}
            >
              Approve selected changes
            </s-button>
          </s-stack>
        </s-section>
      </div>
    </s-page>
  );
}

export const headers: HeadersFunction = (h) => boundary.headers(h);
