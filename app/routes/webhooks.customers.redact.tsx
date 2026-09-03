import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import db from "../db.server";
import { logger } from "../services/logger.server";
import { recordAudit } from "../services/audit.server";

/**
 * Mandatory GDPR topic. No customer personal data is stored, so redaction is a
 * no-op beyond the required audit log.
 */
export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop, topic, payload } = await authenticate.webhook(request);
  logger.info({ topic, shop }, "compliance webhook received");

  const shopRow = await db.shop.findUnique({ where: { shopDomain: shop } });
  if (shopRow) {
    await recordAudit({
      shopId: shopRow.id,
      actorType: "webhook",
      action: "customers_redact",
      resourceType: "compliance",
      resourceId: String((payload as { customer?: { id?: unknown } })?.customer?.id ?? "unknown"),
      summary: "customers/redact received. No customer personal data is stored; nothing to redact.",
    });
  }

  return new Response(JSON.stringify({ acknowledged: true }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
};
