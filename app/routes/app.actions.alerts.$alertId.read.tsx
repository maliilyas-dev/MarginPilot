import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import { requireShop } from "../services/shopContext.server";
import prisma from "../db.server";

export const action = async ({ request, params }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = await requireShop(session);
  const { count } = await prisma.alert.updateMany({
    where: { id: params.alertId!, shopId: shop.id, status: "unread" },
    data: { status: "read" },
  });
  return Response.json({ ok: count > 0 });
};
