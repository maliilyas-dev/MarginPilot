import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import db from "../db.server";
import { logger } from "../services/logger.server";
import { recordAudit } from "../services/audit.server";
import { dedupeWebhook } from "../services/webhookDedupe.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop, session, topic, webhookId } = await authenticate.webhook(request);
  logger.info({ topic, shop, webhookId }, "webhook received");

  if (webhookId && !(await dedupeWebhook(webhookId, topic, shop))) {
    return new Response();
  }

  const shopRow = await db.shop.findUnique({ where: { shopDomain: shop } });
  if (shopRow) {
    // Revoke local operational access, cancel future schedules, mark uninstalled.
    await db.$transaction([
      db.shop.update({
        where: { id: shopRow.id },
        data: { status: "uninstalled", uninstalledAt: new Date() },
      }),
      db.supplier.updateMany({
        where: { shopId: shopRow.id },
        data: { schedule: "manual", status: "inactive" },
      }),
    ]);
    await recordAudit({
      shopId: shopRow.id,
      actorType: "webhook",
      action: "app_uninstalled",
      resourceType: "shop",
      resourceId: shopRow.id,
      summary: `App uninstalled for ${shop}. Schedules cancelled.`,
    });
  }

  if (session) {
    await db.session.deleteMany({ where: { shop } });
  }

  return new Response();
};
