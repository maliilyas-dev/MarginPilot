import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import { requireShop } from "../services/shopContext.server";
import { requestCatalogSync } from "../services/catalogSyncRequest.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = await requireShop(session);
  const result = await requestCatalogSync(shop, session.shop);
  return Response.json(result);
};

// Resource route: POST only.
export const loader = () => {
  throw new Response("Method Not Allowed", { status: 405 });
};
