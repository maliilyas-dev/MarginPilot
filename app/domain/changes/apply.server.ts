/**
 * Apply an approved ChangeSet to Shopify (spec 5.9). Bounded concurrency,
 * per-item idempotency, retry of transient errors only. One failed item never
 * fails the others. Replaying a completed set never reapplies successes.
 */
import prisma from "../../db.server";
import { logger } from "../../services/logger.server";
import { createAdminGraphqlClient, collectUserErrors, ShopifyGraphqlError } from "../../services/shopifyGraphql.server";
import { createAlert } from "../../services/alerts.server";
import { recordAudit } from "../../services/audit.server";
import {
  VARIANT_PRICE_UPDATE_MUTATION,
  INVENTORY_SET_QUANTITIES_MUTATION,
  INVENTORY_ITEM_UPDATE_COST_MUTATION,
} from "../shopify-sync/graphql";

const CONCURRENCY = 4;

export interface ApplyDeps {
  changeSetId: string;
  shopDomain: string;
  accessToken: string;
}

async function pMapBounded<T>(items: T[], limit: number, fn: (item: T) => Promise<void>) {
  const queue = [...items];
  const workers = Array.from({ length: Math.min(limit, queue.length) }, async () => {
    while (queue.length) {
      const next = queue.shift();
      if (next === undefined) break;
      await fn(next);
    }
  });
  await Promise.all(workers);
}

export async function applyChangeSet(deps: ApplyDeps) {
  const changeSet = await prisma.changeSet.findUniqueOrThrow({
    where: { id: deps.changeSetId },
    include: { items: { include: { variant: { include: { product: true } }, proposedChange: true } }, feedRun: true },
  });
  const log = logger.child({ scope: "changes-apply", changeSetId: changeSet.id, shopId: changeSet.shopId });

  if (["completed", "partially_completed", "cancelled"].includes(changeSet.status)) {
    log.info({ status: changeSet.status }, "change set already finalized; nothing to do");
    return;
  }

  await prisma.changeSet.update({
    where: { id: changeSet.id },
    data: {
      status: "applying",
      startedAt: changeSet.startedAt ?? new Date(),
      itemsTotal: changeSet.items.length,
      itemsDone: changeSet.items.filter((i) => i.status === "succeeded").length,
    },
  });
  await prisma.feedRun.update({
    where: { id: changeSet.feedRunId },
    data: { status: "applying", progressPhase: "Writing to Shopify", progressTotal: changeSet.items.length, progressDone: 0 },
  });

  let processed = 0;
  const bumpDone = () => {
    processed += 1;
    if (processed % 5 === 0 || processed === changeSet.items.length) {
      const done = processed;
      void prisma.changeSet.update({ where: { id: changeSet.id }, data: { itemsDone: done } }).catch(() => undefined);
      void prisma.feedRun.update({ where: { id: changeSet.feedRunId }, data: { progressDone: done } }).catch(() => undefined);
    }
  };

  const client = createAdminGraphqlClient({ shopDomain: deps.shopDomain, accessToken: deps.accessToken });
  const location = changeSet.feedRun.supplierId
    ? (await prisma.supplier.findUnique({ where: { id: changeSet.feedRun.supplierId } }))?.defaultLocationGid
    : null;
  const shopLocation = (await prisma.shop.findUnique({ where: { id: changeSet.shopId } }))?.defaultLocationGid;
  const targetLocation = location || shopLocation;

  let succeeded = 0;
  let failed = 0;
  let skipped = 0;

  await pMapBounded(changeSet.items, CONCURRENCY, async (item) => {
    if (item.status === "succeeded") {
      skipped += 1;
      bumpDone();
      return;
    }
    const variant = item.variant;
    const op = item.operationSnapshot as {
      updatePrice?: boolean;
      updateInventory?: boolean;
      updateUnitCost?: boolean;
      price?: string;
      quantity?: number;
      unitCost?: string;
    };

    await prisma.changeItem.update({
      where: { id: item.id },
      data: { status: "applying", attemptCount: { increment: 1 } },
    });

    const previousValues: Record<string, unknown> = {};
    const requestedValues: Record<string, unknown> = {};
    const returnedValues: Record<string, unknown> = {};
    const userErrors: Array<{ path: string; field: string[] | null; message: string }> = [];
    let requestId: string | null = null;

    try {
      if (op.updatePrice && op.price) {
        previousValues.price = variant.price?.toString() ?? null;
        requestedValues.price = op.price;
        const res = await client.request<{ productVariantsBulkUpdate: unknown }>(
          VARIANT_PRICE_UPDATE_MUTATION,
          { productId: variant.product.shopifyProductGid, variants: [{ id: variant.shopifyVariantGid, price: op.price }] },
        );
        requestId = res.requestId;
        const ue = collectUserErrors(res.data);
        userErrors.push(...ue);
        const updated = (res.data as { productVariantsBulkUpdate?: { productVariants?: Array<{ price: string }> } })
          ?.productVariantsBulkUpdate?.productVariants?.[0];
        if (updated) returnedValues.price = updated.price;
        if (ue.length === 0 && updated) {
          await prisma.shopifyVariant.update({ where: { id: variant.id }, data: { price: updated.price } });
        }
      }

      if (op.updateInventory && typeof op.quantity === "number" && userErrors.length === 0) {
        if (!targetLocation || !variant.shopifyInventoryItemGid) {
          userErrors.push({ path: "inventory", field: null, message: "Missing inventory item or location." });
        } else {
          previousValues.quantity = item.proposedChange.currentQuantity;
          requestedValues.quantity = op.quantity;
          const res = await client.request<{ inventorySetQuantities: unknown }>(
            INVENTORY_SET_QUANTITIES_MUTATION,
            {
              input: {
                name: "available",
                reason: "correction",
                ignoreCompareQuantity: true,
                quantities: [
                  {
                    inventoryItemId: variant.shopifyInventoryItemGid,
                    locationId: targetLocation,
                    quantity: op.quantity,
                  },
                ],
              },
            },
          );
          requestId = res.requestId ?? requestId;
          const ue = collectUserErrors(res.data);
          userErrors.push(...ue);
          if (ue.length === 0) {
            returnedValues.quantity = op.quantity;
            const inv = await prisma.variantInventory.findFirst({
              where: { variantId: variant.id, locationGid: targetLocation },
            });
            if (inv) {
              await prisma.variantInventory.update({ where: { id: inv.id }, data: { availableQuantity: op.quantity } });
            }
          }
        }
      }

      if (op.updateUnitCost && op.unitCost && userErrors.length === 0 && variant.shopifyInventoryItemGid) {
        previousValues.unitCost = variant.unitCost?.toString() ?? null;
        requestedValues.unitCost = op.unitCost;
        const res = await client.request<{ inventoryItemUpdate: unknown }>(
          INVENTORY_ITEM_UPDATE_COST_MUTATION,
          { id: variant.shopifyInventoryItemGid, input: { cost: op.unitCost } },
        );
        requestId = res.requestId ?? requestId;
        const ue = collectUserErrors(res.data);
        userErrors.push(...ue);
        if (ue.length === 0) {
          returnedValues.unitCost = op.unitCost;
          await prisma.shopifyVariant.update({ where: { id: variant.id }, data: { unitCost: op.unitCost } });
        }
      }

      if (userErrors.length > 0) {
        failed += 1;
        await prisma.changeItem.update({
          where: { id: item.id },
          data: {
            status: "failed",
            previousValues: previousValues as object,
            requestedValues: requestedValues as object,
            returnedValues: returnedValues as object,
            shopifyUserErrors: userErrors as object,
            lastError: userErrors.map((u) => u.message).join("; "),
          },
        });
      } else {
        succeeded += 1;
        await prisma.changeItem.update({
          where: { id: item.id },
          data: {
            status: "succeeded",
            previousValues: previousValues as object,
            requestedValues: requestedValues as object,
            returnedValues: returnedValues as object,
            appliedAt: new Date(),
            lastError: null,
          },
        });
      }
    } catch (err) {
      failed += 1;
      const retryable = err instanceof ShopifyGraphqlError ? err.retryable : true;
      await prisma.changeItem.update({
        where: { id: item.id },
        data: {
          status: "failed",
          lastError: `${(err as Error).message}${retryable ? " (retryable)" : ""}`,
          requestedValues: requestedValues as object,
          previousValues: previousValues as object,
        },
      });
    }
    void requestId;
    bumpDone();
  });

  const finalStatus =
    failed === 0 ? "completed" : succeeded === 0 ? "failed" : "partially_completed";

  await prisma.changeSet.update({
    where: { id: changeSet.id },
    data: { status: finalStatus, finishedAt: new Date(), itemsDone: changeSet.items.length },
  });
  await prisma.feedRun.update({
    where: { id: changeSet.feedRunId },
    data: {
      status: finalStatus === "completed" ? "completed" : finalStatus === "failed" ? "failed" : "partially_completed",
      completedAt: new Date(),
      progressPhase: finalStatus === "completed" ? "Completed" : "Finished with errors",
      progressDone: changeSet.items.length,
      progressTotal: changeSet.items.length,
    },
  });

  await recordAudit({
    shopId: changeSet.shopId,
    actorType: "system",
    action: "change_set_applied",
    resourceType: "change_set",
    resourceId: changeSet.id,
    summary: `Applied change set: ${succeeded} succeeded, ${failed} failed, ${skipped} already applied.`,
  });

  if (failed > 0) {
    await createAlert({
      shopId: changeSet.shopId,
      feedRunId: changeSet.feedRunId,
      severity: "critical",
      type: "shopify_update_partial_failure",
      title: "Some Shopify updates failed",
      message: `${failed} of ${changeSet.items.length} updates failed. Open the run to review and retry.`,
    });
  }

  log.info({ succeeded, failed, skipped, finalStatus }, "change set apply finished");
  return { succeeded, failed, skipped, finalStatus };
}
