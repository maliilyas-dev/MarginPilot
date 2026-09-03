import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import db from "../db.server";
import { logger } from "../services/logger.server";
import { recordAudit } from "../services/audit.server";

/**
 * Mandatory GDPR topic. MarginPilot (Release 1) stores NO customer or order
 * personal data, so there is nothing to export. We still perform the required
 * internal lookup + audit log and acknowledge with 200. Invalid HMAC is
 * rejected with 401 by `authenticate.webhook`.
 */
export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop, topic, payload } = await authenticate.webhook(request);
  logger.info({ topic, shop }, "compliance webhook received");

  const shopRow = await db.shop.findUnique({ where: { shopDomain: shop } });
  if (shopRow) {
    await recordAudit({
      shopId: shopRow.id,
      actorType: "webhook",
      action: "customers_data_request",
      resourceType: "compliance",
      resourceId: String((payload as { customer?: { id?: unknown } })?.customer?.id ?? "unknown"),
      summary:
        "customers/data_request received. No customer personal data is stored by MarginPilot; nothing to provide.",
    });
  }

  return new Response(
    JSON.stringify({ acknowledged: true, customer_data_stored: false }),
    { status: 200, headers: { "Content-Type": "application/json" } },
  );
};
