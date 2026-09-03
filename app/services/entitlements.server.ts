/**
 * Entitlement service (spec 13). One place that answers "what is this shop
 * allowed to do". UI and jobs call this instead of scattering plan checks.
 *
 * Release 1 does not create real Shopify subscriptions. Beta shops (or all
 * shops while BETA_ACCESS_ENABLED=true and public pricing is inactive) get
 * Growth-tier limits so development stores can be tested end to end.
 */
import prisma from "../db.server";

export type PlanCode = "free" | "starter" | "growth" | "pro" | "beta";

export interface PlanLimits {
  maxSuppliers: number;
  maxMappedVariants: number;
  minScheduleIntervalMinutes: number; // 0 = manual only
  allowUrlFeeds: boolean;
  priorityProcessing: boolean;
}

export const PLAN_LIMITS: Record<PlanCode, PlanLimits> = {
  free: { maxSuppliers: 1, maxMappedVariants: 50, minScheduleIntervalMinutes: 0, allowUrlFeeds: false, priorityProcessing: false },
  starter: { maxSuppliers: 1, maxMappedVariants: 1_000, minScheduleIntervalMinutes: 60 * 24, allowUrlFeeds: true, priorityProcessing: false },
  growth: { maxSuppliers: 5, maxMappedVariants: 10_000, minScheduleIntervalMinutes: 60, allowUrlFeeds: true, priorityProcessing: false },
  pro: { maxSuppliers: 20, maxMappedVariants: 50_000, minScheduleIntervalMinutes: 60, allowUrlFeeds: true, priorityProcessing: true },
  beta: { maxSuppliers: 5, maxMappedVariants: 10_000, minScheduleIntervalMinutes: 60, allowUrlFeeds: true, priorityProcessing: false },
};

const SCHEDULE_MINUTES: Record<string, number> = {
  manual: 0,
  daily: 60 * 24,
  every_6_hours: 60 * 6,
  hourly: 60,
};

export interface Entitlement {
  planCode: PlanCode;
  status: string;
  limits: PlanLimits;
  isBeta: boolean;
}

function betaShops(): Set<string> {
  return new Set(
    (process.env.BETA_SHOPS || "")
      .split(",")
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean),
  );
}

export async function getEntitlement(shopId: string, shopDomain: string): Promise<Entitlement> {
  const row = await prisma.billingEntitlement.findUnique({ where: { shopId } });
  const betaEnabled = process.env.BETA_ACCESS_ENABLED === "true";
  const isBeta =
    betaEnabled && (betaShops().size === 0 || betaShops().has(shopDomain.toLowerCase()));

  let planCode: PlanCode = (row?.planCode as PlanCode) ?? "free";
  if (isBeta && (planCode === "free" || planCode === "beta")) {
    planCode = "beta";
  }

  return {
    planCode,
    status: row?.status ?? "active",
    limits: PLAN_LIMITS[planCode] ?? PLAN_LIMITS.free,
    isBeta,
  };
}

export interface GuardResult {
  allowed: boolean;
  reason?: string;
  upgradeHint?: string;
}

export async function canAddSupplier(shopId: string, shopDomain: string): Promise<GuardResult> {
  const ent = await getEntitlement(shopId, shopDomain);
  const count = await prisma.supplier.count({ where: { shopId } });
  if (count >= ent.limits.maxSuppliers) {
    return {
      allowed: false,
      reason: `Your ${ent.planCode} plan allows ${ent.limits.maxSuppliers} supplier(s).`,
      upgradeHint: "Upgrade to add more suppliers.",
    };
  }
  return { allowed: true };
}

export async function canUseSchedule(
  shopId: string,
  shopDomain: string,
  schedule: string,
): Promise<GuardResult> {
  const ent = await getEntitlement(shopId, shopDomain);
  const wanted = SCHEDULE_MINUTES[schedule] ?? 0;
  if (wanted === 0) return { allowed: true };
  if (ent.limits.minScheduleIntervalMinutes === 0) {
    return { allowed: false, reason: `Your ${ent.planCode} plan is manual-only.`, upgradeHint: "Upgrade for scheduled runs." };
  }
  if (wanted < ent.limits.minScheduleIntervalMinutes) {
    return {
      allowed: false,
      reason: `Your ${ent.planCode} plan's fastest schedule is every ${ent.limits.minScheduleIntervalMinutes} minutes.`,
      upgradeHint: "Upgrade for more frequent syncs.",
    };
  }
  return { allowed: true };
}

export async function canUseUrlFeed(shopId: string, shopDomain: string): Promise<GuardResult> {
  const ent = await getEntitlement(shopId, shopDomain);
  return ent.limits.allowUrlFeeds
    ? { allowed: true }
    : { allowed: false, reason: `Your ${ent.planCode} plan supports manual CSV upload only.`, upgradeHint: "Upgrade for scheduled URL feeds." };
}

export async function checkMappedVariantBudget(
  shopId: string,
  shopDomain: string,
  additional: number,
): Promise<GuardResult> {
  const ent = await getEntitlement(shopId, shopDomain);
  const current = await prisma.supplierProductMapping.count({
    where: { supplier: { shopId }, status: "matched" },
  });
  if (current + additional > ent.limits.maxMappedVariants) {
    return {
      allowed: false,
      reason: `This run would exceed your ${ent.planCode} plan limit of ${ent.limits.maxMappedVariants} mapped variants.`,
      upgradeHint: "Upgrade to map more variants. We never silently process a subset.",
    };
  }
  return { allowed: true };
}

export async function ensureEntitlementRow(shopId: string) {
  await prisma.billingEntitlement.upsert({
    where: { shopId },
    create: { shopId, planCode: "free", status: "active", limits: PLAN_LIMITS.free as object },
    update: {},
  });
}
