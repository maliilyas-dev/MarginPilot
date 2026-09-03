/**
 * Resolve the current Shop row from a Shopify session and enforce tenant
 * isolation (spec 12). Every loader/action that touches merchant data must go
 * through `requireShop` and then scope queries by `shop.id`.
 */
import type { Session } from "@shopify/shopify-app-react-router/server";
import prisma from "../db.server";
import { ensureEntitlementRow } from "./entitlements.server";

export const DEFAULT_ONBOARDING = {
  selectedLocation: false,
  catalogImported: false,
  supplierAdded: false,
  feedUploaded: false,
  columnsMapped: false,
  changeSetReviewed: false,
};

export type OnboardingState = typeof DEFAULT_ONBOARDING;

export async function upsertShopFromSession(session: Session) {
  const shop = await prisma.shop.upsert({
    where: { shopDomain: session.shop },
    create: {
      shopDomain: session.shop,
      status: "active",
      onboardingState: DEFAULT_ONBOARDING as object,
    },
    update: { status: "active", uninstalledAt: null },
  });
  await ensureEntitlementRow(shop.id);
  await prisma.safetyPolicy.upsert({
    where: { shopId: shop.id },
    create: { shopId: shop.id },
    update: {},
  });
  return shop;
}

export async function requireShop(session: Session) {
  const shop = await prisma.shop.findUnique({ where: { shopDomain: session.shop } });
  if (!shop) {
    return upsertShopFromSession(session);
  }
  return shop;
}

/** Merge partial onboarding progress and persist. */
export async function markOnboarding(shopId: string, patch: Partial<OnboardingState>) {
  const shop = await prisma.shop.findUniqueOrThrow({ where: { id: shopId } });
  const current = { ...DEFAULT_ONBOARDING, ...(shop.onboardingState as object) };
  const next = { ...current, ...patch };
  await prisma.shop.update({ where: { id: shopId }, data: { onboardingState: next as object } });
  return next as OnboardingState;
}

/** Guard: load a supplier and 404-equivalent if it is not this shop's. */
export async function requireSupplier(shopId: string, supplierId: string) {
  const supplier = await prisma.supplier.findFirst({ where: { id: supplierId, shopId } });
  if (!supplier) {
    throw new Response("Not found", { status: 404 });
  }
  return supplier;
}

export async function requireFeedRun(shopId: string, feedRunId: string) {
  const run = await prisma.feedRun.findFirst({ where: { id: feedRunId, shopId } });
  if (!run) throw new Response("Not found", { status: 404 });
  return run;
}
