import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import db from "../db.server";
import { logger } from "../services/logger.server";
import { recordAudit } from "../services/audit.server";

/**
 * Mandatory GDPR topic (spec 5.12). Shopify sends this 48h after uninstall.
 * We irreversibly anonymize the shop's retained operational data and keep only
 * non-identifying audit summaries per the published privacy policy.
 */
export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop, topic } = await authenticate.webhook(request);
  logger.info({ topic, shop }, "shop/redact received");

  const shopRow = await db.shop.findUnique({ where: { shopDomain: shop } });
  if (!shopRow) {
    return new Response(JSON.stringify({ acknowledged: true }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }

  await db.$transaction(async (tx) => {
    // Delete feed content and mappings — the identifiable operational data.
    const supplierIds = (
      await tx.supplier.findMany({ where: { shopId: shopRow.id }, select: { id: true } })
    ).map((s) => s.id);

    await tx.feedRow.deleteMany({ where: { feedRun: { shopId: shopRow.id } } });
    await tx.proposedChange.deleteMany({ where: { feedRun: { shopId: shopRow.id } } });
    await tx.changeItem.deleteMany({ where: { changeSet: { shopId: shopRow.id } } });
    await tx.changeSet.deleteMany({ where: { shopId: shopRow.id } });
    await tx.feedRun.deleteMany({ where: { shopId: shopRow.id } });
    await tx.supplierProductMapping.deleteMany({ where: { supplierId: { in: supplierIds } } });
    await tx.feedMappingProfile.deleteMany({ where: { supplierId: { in: supplierIds } } });
    await tx.supplier.deleteMany({ where: { shopId: shopRow.id } });
    await tx.variantInventory.deleteMany({ where: { variant: { shopId: shopRow.id } } });
    await tx.shopifyVariant.deleteMany({ where: { shopId: shopRow.id } });
    await tx.shopifyProduct.deleteMany({ where: { shopId: shopRow.id } });
    await tx.alert.deleteMany({ where: { shopId: shopRow.id } });
    await tx.session.deleteMany({ where: { shop } });

    await tx.shop.update({
      where: { id: shopRow.id },
      data: {
        status: "redacted",
        shopifyShopGid: null,
        defaultLocationGid: null,
        onboardingState: {} as object,
        shopDomain: `redacted-${shopRow.id}.invalid`,
      },
    });
  });

  await recordAudit({
    shopId: shopRow.id,
    actorType: "webhook",
    action: "shop_redact",
    resourceType: "shop",
    resourceId: shopRow.id,
    summary: "shop/redact processed. Operational data deleted; shop anonymized.",
  });

  return new Response(JSON.stringify({ acknowledged: true }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
};
