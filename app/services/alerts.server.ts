/** In-app alerts (spec 5.11). */
import prisma from "../db.server";

export type AlertType =
  | "feed_retrieval_failed"
  | "feed_parsing_failed"
  | "mapping_rate_low"
  | "invalid_row_rate_high"
  | "margin_below_rule"
  | "supplier_cost_change_high"
  | "shopify_update_partial_failure";

export interface CreateAlertInput {
  shopId: string;
  supplierId?: string | null;
  feedRunId?: string | null;
  severity: "info" | "warning" | "critical";
  type: AlertType;
  title: string;
  message: string;
  metadata?: Record<string, unknown>;
}

export async function createAlert(input: CreateAlertInput) {
  return prisma.alert.create({
    data: {
      shopId: input.shopId,
      supplierId: input.supplierId ?? null,
      feedRunId: input.feedRunId ?? null,
      severity: input.severity,
      type: input.type,
      title: input.title,
      message: input.message,
      metadata: (input.metadata ?? {}) as object,
    },
  });
}

export async function unresolvedAlertCounts(shopId: string) {
  const rows = await prisma.alert.groupBy({
    by: ["severity"],
    where: { shopId, status: { not: "resolved" } },
    _count: { _all: true },
  });
  const counts = { info: 0, warning: 0, critical: 0 };
  for (const r of rows) counts[r.severity] = r._count._all;
  return counts;
}
