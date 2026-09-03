import type { LoaderFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import { requireShop, requireFeedRun } from "../services/shopContext.server";
import prisma from "../db.server";

/** Poll target for run progress (spec 5.8). */
export const loader = async ({ request, params }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = await requireShop(session);
  const run = await requireFeedRun(shop.id, params.runId!);

  const changeSet = await prisma.changeSet.findFirst({
    where: { feedRunId: run.id },
    orderBy: { createdAt: "desc" },
    include: { _count: { select: { items: true } } },
  });
  const itemStatus = changeSet
    ? await prisma.changeItem.groupBy({
        by: ["status"],
        where: { changeSetId: changeSet.id },
        _count: { _all: true },
      })
    : [];

  return Response.json({
    runId: run.id,
    status: run.status,
    counts: {
      rows: run.rowCount,
      valid: run.validCount,
      invalid: run.invalidCount,
      matched: run.matchedCount,
      unmatched: run.unmatchedCount,
      ambiguous: run.ambiguousCount,
      safe: run.safeChangeCount,
      warning: run.warningCount,
      blocked: run.blockedCount,
    },
    changeSet: changeSet
      ? {
          id: changeSet.id,
          status: changeSet.status,
          totalItems: changeSet._count.items,
          items: Object.fromEntries(itemStatus.map((s) => [s.status, s._count._all])),
        }
      : null,
    updatedAt: run.updatedAt.toISOString(),
  });
};
