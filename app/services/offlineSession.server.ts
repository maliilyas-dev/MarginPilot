/**
 * Look up a shop's stored offline access token for use by the worker (which
 * runs outside a request). The official Prisma session storage writes offline
 * sessions with id `offline_<shop-domain>`.
 */
import prisma from "../db.server";

export interface OfflineToken {
  shopDomain: string;
  accessToken: string;
}

export async function getOfflineToken(shopDomain: string): Promise<OfflineToken | null> {
  const session =
    (await prisma.session.findFirst({
      where: { shop: shopDomain, isOnline: false },
      orderBy: { expires: "desc" },
    })) ?? (await prisma.session.findFirst({ where: { shop: shopDomain } }));

  if (!session?.accessToken) return null;
  return { shopDomain, accessToken: session.accessToken };
}

export async function requireOfflineToken(shopDomain: string): Promise<OfflineToken> {
  const token = await getOfflineToken(shopDomain);
  if (!token) throw new Error(`No offline access token stored for ${shopDomain}. The merchant may need to reopen the app.`);
  return token;
}
