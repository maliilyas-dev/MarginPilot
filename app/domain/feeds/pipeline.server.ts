/**
 * Feed processing pipeline (spec 10). State machine:
 *   QUEUED -> FETCHING/UPLOADED -> PARSING -> VALIDATING -> MAPPING
 *   -> CALCULATING -> READY_FOR_REVIEW
 *
 * No Shopify writes happen here. Runs are idempotent: the same supplier +
 * checksum is rejected unless explicitly re-run.
 */
import { Readable } from "node:stream";
import prisma from "../../db.server";
import { logger } from "../../services/logger.server";
import { decryptCredentials } from "../../services/encryption.server";
import { safeFetchFeed } from "../../services/safeFetch.server";
import { createAlert } from "../../services/alerts.server";
import { parseCsvStream } from "./parseCsv";
import { normalizeRecord, flagDuplicateSkus, type NormalizedFeedRow } from "./normalizeFeed";
import { sha256 } from "./checksum";
import type { ColumnMappings } from "./canonicalFields";
import { buildVariantIndex, resolveMatch } from "../mapping/matcher";
import { selectPricingRule, type SelectableRule } from "../pricing/rules";
import { computeRecommendedPrice, type PricingRuleInput } from "../pricing/pricing";
import { marginPercent, toDecimal, Decimal } from "../money/money";
import { classifyRow, evaluateRunGates } from "../safety/safety";
import { ReasonCode } from "../safety/reasonCodes";

const BATCH = 500;

export interface RunPipelineDeps {
  feedRunId: string;
  /** local path or buffer for manual uploads */
  uploadBuffer?: Buffer;
  rowCountDropConfirmed?: boolean;
}

export async function runFeedPipeline(deps: RunPipelineDeps) {
  const run = await prisma.feedRun.findUniqueOrThrow({
    where: { id: deps.feedRunId },
    include: { supplier: true, shop: true },
  });
  const log = logger.child({ scope: "feed-pipeline", feedRunId: run.id, shopId: run.shopId });
  const supplier = run.supplier;

  const fail = async (summary: string, alertType: Parameters<typeof createAlert>[0]["type"]) => {
    await prisma.feedRun.update({
      where: { id: run.id },
      data: { status: "failed", errorSummary: summary, completedAt: new Date() },
    });
    await createAlert({
      shopId: run.shopId,
      supplierId: supplier.id,
      feedRunId: run.id,
      severity: "critical",
      type: alertType,
      title: "Feed run failed",
      message: summary,
    });
  };

  // ---- FETCH / UPLOAD ----
  let source: Readable;
  let sourceBytes: Buffer;
  try {
    await prisma.feedRun.update({ where: { id: run.id }, data: { status: "fetching", startedAt: new Date() } });
    if (deps.uploadBuffer) {
      sourceBytes = deps.uploadBuffer;
    } else {
      if (!supplier.feedUrl) throw new Error("Supplier has no feed URL");
      const creds = decryptCredentials(supplier.encryptedCredentials);
      const result = await safeFetchFeed(supplier.feedUrl, {
        maxBytes: Number(process.env.MAX_REMOTE_FEED_BYTES || 20_971_520),
        timeoutMs: Number(process.env.REMOTE_FETCH_TIMEOUT_MS || 30_000),
        maxRedirects: Number(process.env.REMOTE_FETCH_MAX_REDIRECTS || 3),
        basicAuth:
          creds.username || creds.password
            ? { username: creds.username ?? "", password: creds.password ?? "" }
            : null,
      });
      sourceBytes = result.body;
    }
    source = Readable.from([sourceBytes]);
  } catch (err) {
    await fail(`Could not retrieve the feed: ${(err as Error).message}`, "feed_retrieval_failed");
    return;
  }

  // ---- CHECKSUM / IDEMPOTENCY ----
  const checksum = sha256(sourceBytes);
  const dup = await prisma.feedRun.findFirst({
    where: { supplierId: supplier.id, sourceChecksum: checksum, id: { not: run.id }, status: { in: ["completed", "partially_completed", "ready_for_review"] } },
  });
  if (dup && !deps.rowCountDropConfirmed) {
    await prisma.feedRun.update({
      where: { id: run.id },
      data: { status: "cancelled", errorSummary: `Identical feed already processed in run ${dup.id}. Re-run explicitly to force.`, completedAt: new Date() },
    });
    return;
  }

  // ---- PARSE ----
  await prisma.feedRun.update({ where: { id: run.id }, data: { status: "parsing", sourceChecksum: checksum } });
  const profile = await prisma.feedMappingProfile.findFirst({
    where: { supplierId: supplier.id, isDefault: true },
  });
  if (!profile) {
    await fail("No column mapping profile is configured for this supplier.", "feed_parsing_failed");
    return;
  }
  const mappings = profile.columnMappings as ColumnMappings;

  const normalizedRows: NormalizedFeedRow[] = [];
  try {
    const parsed = await parseCsvStream(source, {
      delimiter: (supplier.delimiter as "auto") ?? "auto",
      maxRows: Number(process.env.MAX_FEED_ROWS || 100_000),
      maxBytes: Number(process.env.MAX_REMOTE_FEED_BYTES || 20_971_520),
    });
    let rowNumber = 0;
    for await (const record of parsed.rows) {
      rowNumber += 1;
      normalizedRows.push(
        normalizeRecord(record, rowNumber, mappings, {
          decimalSeparator: supplier.decimalSeparator === "comma" ? "comma" : "dot",
          thousandsSeparator: supplier.thousandsSeparator,
        }),
      );
    }
  } catch (err) {
    await fail(`The feed could not be parsed: ${(err as Error).message}`, "feed_parsing_failed");
    return;
  }

  // ---- VALIDATING ----
  await prisma.feedRun.update({ where: { id: run.id }, data: { status: "validating", headerFingerprint: profile.headerFingerprint } });
  const dupes = flagDuplicateSkus(normalizedRows);
  for (const row of normalizedRows) {
    if (row.supplierSkuNormalized && dupes.has(row.supplierSkuNormalized)) {
      row.validationErrors.push(ReasonCode.DUPLICATE_SUPPLIER_SKU);
      row.validationStatus = "invalid";
    }
  }

  // Persist feed rows in batches.
  for (let i = 0; i < normalizedRows.length; i += BATCH) {
    const slice = normalizedRows.slice(i, i + BATCH);
    await prisma.feedRow.createMany({
      data: slice.map((r) => ({
        feedRunId: run.id,
        rowNumber: r.rowNumber,
        supplierSkuOriginal: r.supplierSkuOriginal,
        supplierSkuNormalized: r.supplierSkuNormalized,
        supplierName: r.supplierName,
        barcode: r.barcode,
        manufacturerPartNumber: r.manufacturerPartNumber,
        quantity: r.quantity ?? null,
        unitCost: r.unitCost ?? null,
        msrp: r.msrp ?? null,
        packSize: r.packSize ?? null,
        freightPerUnit: r.freightPerUnit ?? null,
        rawData: r.raw as object,
        validationStatus: r.validationStatus,
        validationErrors: r.validationErrors as object,
      })),
    });
  }

  const invalidCount = normalizedRows.filter((r) => r.validationStatus === "invalid").length;
  const validCount = normalizedRows.length - invalidCount;

  // ---- RUN-LEVEL GATES ----
  const safety = await prisma.safetyPolicy.findUniqueOrThrow({ where: { shopId: run.shopId } });
  const prevRun = await prisma.feedRun.findFirst({
    where: { supplierId: supplier.id, status: { in: ["completed", "partially_completed"] }, id: { not: run.id } },
    orderBy: { createdAt: "desc" },
  });
  const gate = evaluateRunGates({
    totalRows: normalizedRows.length,
    invalidRows: invalidCount,
    previousSuccessfulRowCount: prevRun?.rowCount ?? null,
    maxInvalidRowPercent: safety.maxInvalidRowPercent.toString(),
    maxRowCountDecreasePercent: safety.maxRowCountDecreasePercent.toString(),
    rowCountDropConfirmed: !!deps.rowCountDropConfirmed,
  });

  // ---- MAPPING ----
  await prisma.feedRun.update({ where: { id: run.id }, data: { status: "mapping" } });
  const variants = await prisma.shopifyVariant.findMany({
    where: { shopId: run.shopId, activeLocally: true },
    select: {
      id: true, skuNormalized: true, barcode: true, price: true, unitCost: true,
      product: { select: { vendor: true, productType: true } },
      inventory: { select: { locationGid: true, availableQuantity: true } },
    },
  });
  const index = buildVariantIndex(
    variants.map((v) => ({
      variantId: v.id,
      skuNormalized: v.skuNormalized,
      barcodeNormalized: v.barcode ? v.barcode.replace(/\s+/g, "") : null,
    })),
  );
  const variantById = new Map(variants.map((v) => [v.id, v]));

  const explicitMappings = await prisma.supplierProductMapping.findMany({
    where: { supplierId: supplier.id },
  });
  const explicitBySku = new Map(explicitMappings.map((m) => [m.supplierSkuNormalized, m]));

  // ---- CALCULATING ----
  await prisma.feedRun.update({ where: { id: run.id }, data: { status: "calculating" } });
  const rules = (await prisma.pricingRule.findMany({
    where: { shopId: run.shopId, OR: [{ supplierId: supplier.id }, { supplierId: null }] },
  })) as unknown as SelectableRule[];

  const feedRowRecords = await prisma.feedRow.findMany({ where: { feedRunId: run.id }, orderBy: { rowNumber: "asc" } });

  let matchedCount = 0;
  let unmatchedCount = 0;
  let ambiguousCount = 0;
  let safeChangeCount = 0;
  let warningCount = 0;
  let blockedCount = 0;

  const location = supplier.defaultLocationGid || run.shop.defaultLocationGid;

  for (let i = 0; i < feedRowRecords.length; i += BATCH) {
    const slice = feedRowRecords.slice(i, i + BATCH);
    const creates: Array<Parameters<typeof prisma.proposedChange.create>[0]["data"]> = [];

    for (const fr of slice) {
      const explicit = fr.supplierSkuNormalized ? explicitBySku.get(fr.supplierSkuNormalized) : undefined;
      const match = resolveMatch(
        {
          supplierSkuNormalized: fr.supplierSkuNormalized,
          barcodeNormalized: fr.barcode ? fr.barcode.replace(/\s+/g, "") : null,
          explicit: explicit ? { variantId: explicit.variantId, status: explicit.status } : null,
          barcodeMatchingEnabled: supplier.barcodeMatching,
        },
        index,
      );

      if (match.status === "matched") matchedCount += 1;
      else if (match.status === "ambiguous") ambiguousCount += 1;
      else if (match.status === "unmatched") unmatchedCount += 1;

      const variant = match.variantId ? variantById.get(match.variantId) : null;
      const rowValid = fr.validationStatus === "valid";

      let landedCost: Decimal | null = null;
      let recommendedPrice: Decimal | null = null;
      let currentMarginPercent: Decimal | null = null;
      let recommendedMarginPercent: Decimal | null = null;
      let ruleUsedId: string | null = null;

      if (variant && rowValid && fr.unitCost !== null) {
        const rule = selectPricingRule(rules, {
          supplierId: supplier.id,
          vendor: variant.product.vendor,
          productType: variant.product.productType,
        });
        if (rule) {
          ruleUsedId = rule.id;
          const ruleInput: PricingRuleInput = {
            minimumMarginPercent: rule.minimumMarginPercent,
            markupPercent: rule.markupPercent,
            fixedHandlingPerUnit: rule.fixedHandlingPerUnit,
            dutyPercent: rule.dutyPercent,
            otherCostPercent: rule.otherCostPercent,
            roundingRule: rule.roundingRule,
            minimumPrice: rule.minimumPrice,
            maximumPrice: rule.maximumPrice,
          };
          const calc = computeRecommendedPrice(
            { supplierUnitCost: fr.unitCost.toString(), freightPerUnit: fr.freightPerUnit?.toString() ?? 0 },
            ruleInput,
          );
          landedCost = calc.landedCost;
          recommendedPrice = calc.recommendedPrice;
          recommendedMarginPercent = marginPercent(recommendedPrice, landedCost);
          currentMarginPercent = variant.price ? marginPercent(variant.price.toString(), landedCost) : null;
        }
      }

      const currentQuantity =
        variant && location
          ? variant.inventory.find((inv) => inv.locationGid === location)?.availableQuantity ?? 0
          : null;

      const rule = ruleUsedId ? rules.find((r) => r.id === ruleUsedId) : undefined;
      const safetyResult = classifyRow(
        {
          mappingStatus: match.status,
          rowValid,
          updateInventory: fr.quantity !== null,
          updatePrice: recommendedPrice !== null,
          supplierUnitCost: fr.unitCost?.toString() ?? null,
          landedCost: landedCost?.toString() ?? null,
          currentPrice: variant?.price?.toString() ?? null,
          recommendedPrice: recommendedPrice?.toString() ?? null,
          minimumMarginPercent: rule ? String(rule.minimumMarginPercent) : null,
          currentQuantity,
          proposedQuantity: fr.quantity,
        },
        {
          maxPriceDecreasePercent: safety.maxPriceDecreasePercent.toString(),
          maxPriceIncreasePercent: safety.maxPriceIncreasePercent.toString(),
          maxInventoryChangePercent: safety.maxInventoryChangePercent.toString(),
          maxInventoryAbsoluteChange: safety.maxInventoryAbsoluteChange,
          allowZeroCost: safety.allowZeroCost,
        },
      );

      const reasonCodes = new Set<string>(safetyResult.reasonCodes);
      for (const e of fr.validationErrors as string[]) reasonCodes.add(e);
      if (gate.blockRun) for (const rc of gate.reasonCodes) reasonCodes.add(rc);

      let classification = safetyResult.classification;
      if (gate.blockRun && classification === "safe") classification = "blocked";

      if (classification === "safe") safeChangeCount += 1;
      else if (classification === "warning") warningCount += 1;
      else if (classification === "blocked") blockedCount += 1;

      creates.push({
        feedRunId: run.id,
        feedRowId: fr.id,
        variantId: match.variantId,
        mappingStatus: match.status,
        currentQuantity,
        proposedQuantity: fr.quantity,
        currentUnitCost: variant?.unitCost ?? null,
        supplierUnitCost: fr.unitCost ?? null,
        landedCost: landedCost ? landedCost.toString() : null,
        currentPrice: variant?.price ?? null,
        recommendedPrice: recommendedPrice ? recommendedPrice.toString() : null,
        currentMarginPercent: currentMarginPercent ? currentMarginPercent.toString() : null,
        recommendedMarginPercent: recommendedMarginPercent ? recommendedMarginPercent.toString() : null,
        classification,
        reasonCodes: [...reasonCodes] as object,
      });
    }

    for (const data of creates) {
      // create (not createMany) so the 1:1 feedRowId unique is enforced cleanly
      await prisma.proposedChange.create({ data });
    }
  }

  // Persist explicit mapping rows discovered by exact match so future runs are faster.
  const toPersist = feedRowRecords
    .filter((fr) => fr.supplierSkuNormalized && !explicitBySku.has(fr.supplierSkuNormalized));
  for (let i = 0; i < toPersist.length; i += BATCH) {
    const slice = toPersist.slice(i, i + BATCH);
    for (const fr of slice) {
      const match = resolveMatch(
        {
          supplierSkuNormalized: fr.supplierSkuNormalized,
          barcodeNormalized: fr.barcode ? fr.barcode.replace(/\s+/g, "") : null,
          explicit: null,
          barcodeMatchingEnabled: supplier.barcodeMatching,
        },
        index,
      );
      if (match.status === "matched" && match.matchMethod && fr.supplierSkuNormalized) {
        await prisma.supplierProductMapping.upsert({
          where: { supplierId_supplierSkuNormalized: { supplierId: supplier.id, supplierSkuNormalized: fr.supplierSkuNormalized } },
          create: {
            supplierId: supplier.id,
            supplierSkuOriginal: fr.supplierSkuOriginal ?? fr.supplierSkuNormalized,
            supplierSkuNormalized: fr.supplierSkuNormalized,
            variantId: match.variantId,
            matchMethod: match.matchMethod,
            status: "matched",
          },
          update: {},
        });
      }
    }
  }

  await prisma.feedRun.update({
    where: { id: run.id },
    data: {
      status: "ready_for_review",
      rowCount: normalizedRows.length,
      validCount,
      invalidCount,
      matchedCount,
      unmatchedCount,
      ambiguousCount,
      safeChangeCount,
      warningCount,
      blockedCount,
      rulesSnapshot: rules as object,
      safetySnapshot: safety as object,
      completedAt: null,
    },
  });

  // Alerts (spec 5.11)
  const mappingRate = normalizedRows.length > 0 ? matchedCount / normalizedRows.length : 1;
  if (mappingRate < 0.8) {
    await createAlert({
      shopId: run.shopId, supplierId: supplier.id, feedRunId: run.id,
      severity: "warning", type: "mapping_rate_low",
      title: "Low mapping rate",
      message: `Only ${Math.round(mappingRate * 100)}% of feed rows matched a Shopify variant.`,
    });
  }
  if (gate.reasonCodes.includes(ReasonCode.INVALID_ROW_RATE_THRESHOLD)) {
    await createAlert({
      shopId: run.shopId, supplierId: supplier.id, feedRunId: run.id,
      severity: "critical", type: "invalid_row_rate_high",
      title: "High invalid-row rate",
      message: `${invalidCount} of ${normalizedRows.length} rows are invalid. The run is blocked until you resolve or override.`,
    });
  }

  log.info(
    { rowCount: normalizedRows.length, matchedCount, blockedCount, safeChangeCount, blockRun: gate.blockRun },
    "feed pipeline ready for review",
  );
  void toDecimal;
}
