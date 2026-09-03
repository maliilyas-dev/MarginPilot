import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import { requireShop, markOnboarding } from "../services/shopContext.server";
import { recordAudit } from "../services/audit.server";
import { enqueueCatalogSync } from "../services/queue.server";
import prisma from "../db.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = await requireShop(session);

  const active = await prisma.catalogSync.findFirst({
    where: { shopId: shop.id, status: { in: ["queued", "running"] } },
  });
  if (active) {
    return Response.json({ ok: true, catalogSyncId: active.id, alreadyRunning: true });
  }

  const cs = await prisma.catalogSync.create({ data: { shopId: shop.id, status: "queued" } });
  await enqueueCatalogSync({ shopId: shop.id, shopDomain: shop.shopDomain, catalogSyncId: cs.id });
  await markOnboarding(shop.id, { catalogImported: true });
  await recordAudit({
    shopId: shop.id,
    actorType: "merchant",
    actorIdentifier: session.shop,
    action: "catalog_sync_requested",
    resourceType: "catalog_sync",
    resourceId: cs.id,
    summary: "Catalog synchronization enqueued.",
  });
  return Response.json({ ok: true, catalogSyncId: cs.id });
};
