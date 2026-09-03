import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import { requireShop, requireFeedRun } from "../services/shopContext.server";
import { recordAudit } from "../services/audit.server";
import prisma from "../db.server";

const CANCELLABLE = ["queued", "fetching", "parsing", "validating", "mapping", "calculating", "ready_for_review"];

export const action = async ({ request, params }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = await requireShop(session);
  const run = await requireFeedRun(shop.id, params.runId!);

  if (!CANCELLABLE.includes(run.status)) {
    return Response.json({ ok: false, message: `A ${run.status} run cannot be cancelled.` }, { status: 400 });
  }

  await prisma.feedRun.update({
    where: { id: run.id },
    data: { status: "cancelled", completedAt: new Date(), errorSummary: "Cancelled by merchant." },
  });
  await prisma.feedUpload.deleteMany({ where: { feedRunId: run.id } });
  await recordAudit({
    shopId: shop.id,
    actorType: "merchant",
    actorIdentifier: session.shop,
    action: "feed_run_cancelled",
    resourceType: "feed_run",
    resourceId: run.id,
    summary: "Feed run cancelled.",
  });
  return Response.json({ ok: true });
};

// Resource route: POST only. A loader is required so React Router single-fetch
// routes fetcher submissions here instead of returning 400 Bad Request.
export const loader = () => {
  throw new Response("Method Not Allowed", { status: 405 });
};
