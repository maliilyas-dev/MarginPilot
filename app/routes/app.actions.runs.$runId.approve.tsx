import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import { requireShop, requireFeedRun, markOnboarding } from "../services/shopContext.server";
import { recordAudit } from "../services/audit.server";
import { enqueueChangesApply } from "../services/queue.server";
import { checkMappedVariantBudget } from "../services/entitlements.server";
import { sha256 } from "../domain/feeds/checksum";
import prisma from "../db.server";

/**
 * Approve selected safe changes (spec 5.8). Creates an immutable ChangeSet +
 * ChangeItems snapshot and enqueues async apply jobs. No Shopify write here.
 */
export const action = async ({ request, params }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = await requireShop(session);
  const run = await requireFeedRun(shop.id, params.runId!);

  if (run.status !== "ready_for_review") {
    return Response.json({ ok: false, message: "This run is not awaiting review." }, { status: 400 });
  }

  const form = await request.formData();
  const proposedChangeIds = form.getAll("proposedChangeId").map(String).filter(Boolean);
  const updateInventory = form.get("updateInventory") === "on";
  const updatePrice = form.get("updatePrice") === "on";
  const updateUnitCost = form.get("updateUnitCost") === "on";
  const confirmToken = form.get("confirm");

  if (!confirmToken) {
    return Response.json({ ok: false, message: "Confirmation required." }, { status: 400 });
  }
  if (proposedChangeIds.length === 0) {
    return Response.json({ ok: false, message: "Select at least one change." }, { status: 400 });
  }
  if (!updateInventory && !updatePrice && !updateUnitCost) {
    return Response.json({ ok: false, message: "Choose what to update: inventory, price, or both." }, { status: 400 });
  }

  const changes = await prisma.proposedChange.findMany({
    where: { id: { in: proposedChangeIds }, feedRunId: run.id },
    include: { variant: true },
  });

  // Only genuinely selectable rows: safe, or blocked+explicitly overridden.
  const selectable = changes.filter(
    (c) =>
      c.variantId &&
      (c.classification === "safe" || (c.classification === "blocked" && c.overrideApproved)),
  );
  if (selectable.length === 0) {
    return Response.json(
      { ok: false, message: "None of the selected rows are safe to apply. Resolve or override blocked rows first." },
      { status: 400 },
    );
  }

  const budget = await checkMappedVariantBudget(shop.id, shop.shopDomain, 0);
  if (!budget.allowed) {
    return Response.json({ ok: false, message: budget.reason }, { status: 400 });
  }

  const idempotencyKey = sha256(
    [shop.id, run.id, updateInventory, updatePrice, updateUnitCost, selectable.map((c) => c.id).sort().join(",")].join(
      "|",
    ),
  );

  const existing = await prisma.changeSet.findUnique({ where: { idempotencyKey } });
  if (existing) {
    return Response.json({ ok: true, changeSetId: existing.id, deduped: true });
  }

  const changeSet = await prisma.$transaction(async (tx) => {
    const cs = await tx.changeSet.create({
      data: {
        shopId: shop.id,
        feedRunId: run.id,
        status: "queued",
        updateInventory,
        updatePrice,
        updateUnitCost,
        approvedBy: session.shop,
        approvedAt: new Date(),
        idempotencyKey,
      },
    });
    for (const c of selectable) {
      await tx.changeItem.create({
        data: {
          changeSetId: cs.id,
          proposedChangeId: c.id,
          variantId: c.variantId!,
          operationSnapshot: {
            updateInventory,
            updatePrice,
            updateUnitCost,
            price: updatePrice && c.recommendedPrice ? c.recommendedPrice.toString() : undefined,
            quantity: updateInventory && c.proposedQuantity !== null ? c.proposedQuantity : undefined,
            unitCost: updateUnitCost && c.supplierUnitCost ? c.supplierUnitCost.toString() : undefined,
          } as object,
          previousValues: {
            price: c.currentPrice?.toString() ?? null,
            quantity: c.currentQuantity,
            unitCost: c.currentUnitCost?.toString() ?? null,
          } as object,
        },
      });
    }
    await tx.feedRun.update({ where: { id: run.id }, data: { status: "applying" } });
    return cs;
  });

  await enqueueChangesApply({ shopId: shop.id, changeSetId: changeSet.id });
  await markOnboarding(shop.id, { changeSetReviewed: true });
  await recordAudit({
    shopId: shop.id,
    actorType: "merchant",
    actorIdentifier: session.shop,
    action: "change_set_approved",
    resourceType: "change_set",
    resourceId: changeSet.id,
    summary: `Approved ${selectable.length} change(s): ${[updatePrice && "price", updateInventory && "inventory", updateUnitCost && "cost"].filter(Boolean).join(", ")}.`,
    afterData: { itemCount: selectable.length },
    ip: request.headers.get("x-forwarded-for"),
  });

  return Response.json({ ok: true, changeSetId: changeSet.id, redirectTo: `/app/runs/${run.id}` });
};

// Resource route: POST only. A loader is required so React Router single-fetch
// routes fetcher submissions here instead of returning 400 Bad Request.
export const loader = () => {
  throw new Response("Method Not Allowed", { status: 405 });
};
