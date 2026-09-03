/** Home dashboard aggregation (spec 6). Operational, not a welcome page. */
import prisma from "../db.server";
import { unresolvedAlertCounts } from "../services/alerts.server";
import { DEFAULT_ONBOARDING, type OnboardingState } from "../services/shopContext.server";

export interface DashboardData {
  onboarding: OnboardingState;
  onboardingComplete: boolean;
  activeSuppliers: number;
  variantsImported: number;
  mappedPercent: number;
  lastCatalogSyncAt: string | null;
  lastRun: { id: string; status: string; supplier: string; at: string } | null;
  pendingSafeChanges: number;
  variantsBelowMarginFloor: number;
  alerts: { info: number; warning: number; critical: number };
  primaryCta: { label: string; href: string };
}

export async function getDashboardData(shopId: string): Promise<DashboardData> {
  const shop = await prisma.shop.findUniqueOrThrow({ where: { id: shopId } });
  const onboarding = { ...DEFAULT_ONBOARDING, ...(shop.onboardingState as object) } as OnboardingState;

  const [activeSuppliers, variantsImported, mappedMatched, totalMappings, lastSync, lastRunRow, pendingSafe] =
    await Promise.all([
      prisma.supplier.count({ where: { shopId, status: "active" } }),
      prisma.shopifyVariant.count({ where: { shopId, activeLocally: true } }),
      prisma.supplierProductMapping.count({ where: { supplier: { shopId }, status: "matched" } }),
      prisma.supplierProductMapping.count({ where: { supplier: { shopId } } }),
      prisma.catalogSync.findFirst({ where: { shopId, status: "completed" }, orderBy: { completedAt: "desc" } }),
      prisma.feedRun.findFirst({ where: { shopId }, orderBy: { createdAt: "desc" }, include: { supplier: true } }),
      prisma.proposedChange.count({ where: { feedRun: { shopId, status: "ready_for_review" }, classification: "safe" } }),
    ]);

  // Count proposed changes flagged MARGIN_BELOW_MINIMUM without relying on a
  // JSON containment operator (portability + avoids engine quirks): pull the
  // small set of reason-code arrays for pending runs and filter in JS.
  let belowFloor = 0;
  try {
    const pendingReasons = await prisma.proposedChange.findMany({
      where: { feedRun: { shopId, status: "ready_for_review" } },
      select: { reasonCodes: true },
    });
    belowFloor = pendingReasons.filter((p) => {
      const codes = Array.isArray(p.reasonCodes) ? (p.reasonCodes as unknown[]) : [];
      return codes.includes("MARGIN_BELOW_MINIMUM");
    }).length;
  } catch {
    belowFloor = 0;
  }

  const alerts = await unresolvedAlertCounts(shopId).catch(() => ({ info: 0, warning: 0, critical: 0 }));
  const mappedPercent = totalMappings > 0 ? Math.round((mappedMatched / totalMappings) * 100) : 0;

  const onboardingComplete = Object.values(onboarding).every(Boolean);
  let primaryCta = { label: "Add supplier", href: "/app/suppliers/new" };
  if (!onboarding.catalogImported) primaryCta = { label: "Import Shopify catalog", href: "/app/settings" };
  else if (activeSuppliers === 0) primaryCta = { label: "Add supplier", href: "/app/suppliers/new" };
  else if (lastRunRow?.status === "ready_for_review") primaryCta = { label: "Review changes", href: `/app/runs/${lastRunRow.id}/review` };
  else if (mappedPercent < 80 && totalMappings > 0) primaryCta = { label: "Review mappings", href: "/app/mappings" };
  else primaryCta = { label: "Upload feed", href: "/app/suppliers" };

  return {
    onboarding,
    onboardingComplete,
    activeSuppliers,
    variantsImported,
    mappedPercent,
    lastCatalogSyncAt: lastSync?.completedAt?.toISOString() ?? null,
    lastRun: lastRunRow
      ? {
          id: lastRunRow.id,
          status: lastRunRow.status,
          supplier: lastRunRow.supplier.name,
          at: lastRunRow.createdAt.toISOString(),
        }
      : null,
    pendingSafeChanges: pendingSafe,
    variantsBelowMarginFloor: belowFloor,
    alerts,
    primaryCta,
  };
}
