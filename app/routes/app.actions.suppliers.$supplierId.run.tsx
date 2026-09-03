import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import { requireShop, requireSupplier } from "../services/shopContext.server";
import { recordAudit } from "../services/audit.server";
import { enqueueFeedFetch } from "../services/queue.server";
import prisma from "../db.server";
import type { FeedRunStatus } from "@prisma/client";

const ACTIVE: FeedRunStatus[] = [
  "queued",
  "fetching",
  "parsing",
  "validating",
  "mapping",
  "calculating",
  "applying",
];

/** Trigger a URL-source feed run now (spec route contract). */
export const action = async ({ request, params }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = await requireShop(session);
  const supplier = await requireSupplier(shop.id, params.supplierId!);

  if (supplier.feedType !== "url_csv") {
    return Response.json(
      { ok: false, message: "This supplier uses manual upload. Upload a CSV instead." },
      { status: 400 },
    );
  }

  // Lock: only one active run per supplier (spec 11).
  const active = await prisma.feedRun.findFirst({
    where: { supplierId: supplier.id, status: { in: ACTIVE } },
  });
  if (active) {
    return Response.json({ ok: true, feedRunId: active.id, alreadyRunning: true });
  }

  const run = await prisma.feedRun.create({
    data: { shopId: shop.id, supplierId: supplier.id, trigger: "manual_url", status: "queued" },
  });
  await prisma.supplier.update({ where: { id: supplier.id }, data: { lastRunAt: new Date() } });
  await enqueueFeedFetch({ shopId: shop.id, supplierId: supplier.id, feedRunId: run.id });
  await recordAudit({
    shopId: shop.id,
    actorType: "merchant",
    actorIdentifier: session.shop,
    action: "feed_run_triggered",
    resourceType: "feed_run",
    resourceId: run.id,
    summary: `Manual URL run started for ${supplier.name}.`,
  });

  return Response.json({ ok: true, feedRunId: run.id, redirectTo: `/app/runs/${run.id}` });
};

// Resource route: POST only. A loader is required so React Router single-fetch
// routes fetcher submissions here instead of returning 400 Bad Request.
export const loader = () => {
  throw new Response("Method Not Allowed", { status: 405 });
};
