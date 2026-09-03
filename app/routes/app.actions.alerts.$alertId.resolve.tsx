import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import { requireShop } from "../services/shopContext.server";
import { recordAudit } from "../services/audit.server";
import prisma from "../db.server";

export const action = async ({ request, params }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = await requireShop(session);
  const { count } = await prisma.alert.updateMany({
    where: { id: params.alertId!, shopId: shop.id },
    data: { status: "resolved" },
  });
  if (count > 0) {
    await recordAudit({
      shopId: shop.id,
      actorType: "merchant",
      actorIdentifier: session.shop,
      action: "alert_resolved",
      resourceType: "alert",
      resourceId: params.alertId!,
      summary: "Alert marked resolved.",
    });
  }
  return Response.json({ ok: count > 0 });
};
