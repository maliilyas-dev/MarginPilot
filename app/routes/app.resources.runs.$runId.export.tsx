import type { LoaderFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import { requireShop, requireFeedRun } from "../services/shopContext.server";
import prisma from "../db.server";

function csvCell(v: unknown): string {
  const s = v === null || v === undefined ? "" : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** CSV export of preview / result rows for a run (spec 5.10). */
export const loader = async ({ request, params }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = await requireShop(session);
  const run = await requireFeedRun(shop.id, params.runId!);

  const rows = await prisma.proposedChange.findMany({
    where: { feedRunId: run.id },
    include: { feedRow: true, variant: true },
    orderBy: { feedRow: { rowNumber: "asc" } },
  });

  const header = [
    "row",
    "supplier_sku",
    "shopify_variant_gid",
    "classification",
    "mapping_status",
    "current_quantity",
    "proposed_quantity",
    "current_price",
    "recommended_price",
    "landed_cost",
    "current_margin_pct",
    "recommended_margin_pct",
    "reason_codes",
  ];
  const lines = [header.join(",")];
  for (const r of rows) {
    lines.push(
      [
        r.feedRow.rowNumber,
        r.feedRow.supplierSkuOriginal,
        r.variant?.shopifyVariantGid ?? "",
        r.classification,
        r.mappingStatus,
        r.currentQuantity ?? "",
        r.proposedQuantity ?? "",
        r.currentPrice ?? "",
        r.recommendedPrice ?? "",
        r.landedCost ?? "",
        r.currentMarginPercent ?? "",
        r.recommendedMarginPercent ?? "",
        (r.reasonCodes as string[]).join(" "),
      ]
        .map(csvCell)
        .join(","),
    );
  }

  return new Response(lines.join("\n"), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="marginpilot-run-${run.id}.csv"`,
    },
  });
};
