/**
 * Enqueue a catalog sync for a shop. Shared by the dashboard action, the
 * settings action, and the /app/actions/catalog-sync resource route so the
 * behaviour is identical however it's triggered.
 */
import prisma from "../db.server";
import { markOnboarding } from "./shopContext.server";
import { recordAudit } from "./audit.server";
import { enqueueCatalogSync } from "./queue.server";

export interface RequestCatalogSyncResult {
  ok: boolean;
  catalogSyncId?: string;
  alreadyRunning?: boolean;
  message?: string;
}

export async function requestCatalogSync(
  shop: { id: string; shopDomain: string },
  actorIdentifier: string,
): Promise<RequestCatalogSyncResult> {
  const active = await prisma.catalogSync.findFirst({
    where: { shopId: shop.id, status: { in: ["queued", "running"] } },
    orderBy: { startedAt: "desc" },
  });
  if (active) {
    // Recover from a sync that died without recording a terminal status.
    const staleMs = Date.now() - new Date(active.startedAt).getTime();
    if (staleMs < 3 * 60 * 1000) {
      return { ok: true, catalogSyncId: active.id, alreadyRunning: true };
    }
    await prisma.catalogSync.update({
      where: { id: active.id },
      data: { status: "failed", completedAt: new Date(), errorSummary: "Timed out — superseded by a new sync." },
    });
  }

  const cs = await prisma.catalogSync.create({ data: { shopId: shop.id, status: "queued" } });
  try {
    await enqueueCatalogSync({ shopId: shop.id, shopDomain: shop.shopDomain, catalogSyncId: cs.id });
  } catch (err) {
    await prisma.catalogSync.update({
      where: { id: cs.id },
      data: { status: "failed", errorSummary: "Could not enqueue the sync job. Check the worker/Redis connection." },
    });
    console.error("[catalog-sync] enqueue failed", err);
    return { ok: false, message: "Could not start the sync. Please try again shortly." };
  }

  await markOnboarding(shop.id, { catalogImported: true });
  await recordAudit({
    shopId: shop.id,
    actorType: "merchant",
    actorIdentifier,
    action: "catalog_sync_requested",
    resourceType: "catalog_sync",
    resourceId: cs.id,
    summary: "Catalog synchronization enqueued.",
  });
  return { ok: true, catalogSyncId: cs.id };
}
