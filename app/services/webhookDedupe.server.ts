/** Deduplicate webhook deliveries by Shopify's webhook id (spec 11). */
import prisma from "../db.server";

/** Returns true when this webhook id is new (caller should process it). */
export async function dedupeWebhook(webhookId: string, topic: string, shopDomain: string): Promise<boolean> {
  try {
    await prisma.webhookEvent.create({ data: { webhookId, topic, shopDomain } });
    return true;
  } catch {
    // Unique constraint violation => already seen.
    return false;
  }
}
