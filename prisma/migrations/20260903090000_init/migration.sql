-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "ShopStatus" AS ENUM ('active', 'uninstalled', 'redaction_pending', 'redacted');

-- CreateEnum
CREATE TYPE "SupplierStatus" AS ENUM ('active', 'inactive');

-- CreateEnum
CREATE TYPE "FeedType" AS ENUM ('upload_csv', 'url_csv');

-- CreateEnum
CREATE TYPE "MatchMethod" AS ENUM ('explicit', 'exact_sku', 'exact_barcode', 'ignored');

-- CreateEnum
CREATE TYPE "MappingStatus" AS ENUM ('matched', 'unmatched', 'ambiguous', 'ignored');

-- CreateEnum
CREATE TYPE "FeedRunStatus" AS ENUM ('queued', 'fetching', 'parsing', 'validating', 'mapping', 'calculating', 'ready_for_review', 'applying', 'completed', 'partially_completed', 'failed', 'cancelled');

-- CreateEnum
CREATE TYPE "FeedRunTrigger" AS ENUM ('manual_upload', 'manual_url', 'scheduled');

-- CreateEnum
CREATE TYPE "ChangeClassification" AS ENUM ('unchanged', 'safe', 'warning', 'blocked', 'invalid', 'unmatched');

-- CreateEnum
CREATE TYPE "ChangeSetStatus" AS ENUM ('pending', 'queued', 'applying', 'completed', 'partially_completed', 'failed', 'cancelled');

-- CreateEnum
CREATE TYPE "ChangeItemStatus" AS ENUM ('queued', 'applying', 'succeeded', 'failed', 'skipped');

-- CreateEnum
CREATE TYPE "AlertSeverity" AS ENUM ('info', 'warning', 'critical');

-- CreateEnum
CREATE TYPE "AlertStatus" AS ENUM ('unread', 'read', 'resolved');

-- CreateTable
CREATE TABLE "Session" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "state" TEXT NOT NULL,
    "isOnline" BOOLEAN NOT NULL DEFAULT false,
    "scope" TEXT,
    "expires" TIMESTAMP(3),
    "accessToken" TEXT NOT NULL,
    "userId" BIGINT,
    "firstName" TEXT,
    "lastName" TEXT,
    "email" TEXT,
    "accountOwner" BOOLEAN NOT NULL DEFAULT false,
    "locale" TEXT,
    "collaborator" BOOLEAN DEFAULT false,
    "emailVerified" BOOLEAN DEFAULT false,
    "refreshToken" TEXT,
    "refreshTokenExpires" TIMESTAMP(3),

    CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Shop" (
    "id" TEXT NOT NULL,
    "shopDomain" TEXT NOT NULL,
    "shopifyShopGid" TEXT,
    "status" "ShopStatus" NOT NULL DEFAULT 'active',
    "defaultLocationGid" TEXT,
    "timezone" TEXT NOT NULL DEFAULT 'UTC',
    "currencyCode" TEXT NOT NULL DEFAULT 'USD',
    "onboardingState" JSONB NOT NULL DEFAULT '{}',
    "installedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "uninstalledAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Shop_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CatalogSync" (
    "id" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'queued',
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),
    "productCount" INTEGER NOT NULL DEFAULT 0,
    "variantCount" INTEGER NOT NULL DEFAULT 0,
    "errorSummary" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CatalogSync_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ShopifyProduct" (
    "id" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "shopifyProductGid" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "vendor" TEXT,
    "productType" TEXT,
    "status" TEXT,
    "activeLocally" BOOLEAN NOT NULL DEFAULT true,
    "shopifyUpdatedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ShopifyProduct_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ShopifyVariant" (
    "id" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "shopifyVariantGid" TEXT NOT NULL,
    "shopifyInventoryItemGid" TEXT,
    "skuOriginal" TEXT,
    "skuNormalized" TEXT,
    "barcode" TEXT,
    "title" TEXT,
    "price" DECIMAL(18,4),
    "compareAtPrice" DECIMAL(18,4),
    "unitCost" DECIMAL(18,4),
    "inventoryTracked" BOOLEAN NOT NULL DEFAULT false,
    "activeLocally" BOOLEAN NOT NULL DEFAULT true,
    "shopifyUpdatedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ShopifyVariant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VariantInventory" (
    "id" TEXT NOT NULL,
    "variantId" TEXT NOT NULL,
    "locationGid" TEXT NOT NULL,
    "availableQuantity" INTEGER NOT NULL DEFAULT 0,
    "lastSyncedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "VariantInventory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Supplier" (
    "id" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "status" "SupplierStatus" NOT NULL DEFAULT 'active',
    "feedType" "FeedType" NOT NULL DEFAULT 'upload_csv',
    "feedUrl" TEXT,
    "encryptedCredentials" TEXT,
    "delimiter" TEXT NOT NULL DEFAULT 'auto',
    "decimalSeparator" TEXT NOT NULL DEFAULT 'dot',
    "thousandsSeparator" TEXT,
    "currencyCode" TEXT NOT NULL DEFAULT 'USD',
    "defaultLocationGid" TEXT,
    "schedule" TEXT NOT NULL DEFAULT 'manual',
    "timezone" TEXT NOT NULL DEFAULT 'UTC',
    "barcodeMatching" BOOLEAN NOT NULL DEFAULT false,
    "lastRunAt" TIMESTAMP(3),
    "lastSuccessAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Supplier_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FeedMappingProfile" (
    "id" TEXT NOT NULL,
    "supplierId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "headerFingerprint" TEXT NOT NULL,
    "columnMappings" JSONB NOT NULL,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FeedMappingProfile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SupplierProductMapping" (
    "id" TEXT NOT NULL,
    "supplierId" TEXT NOT NULL,
    "supplierSkuOriginal" TEXT NOT NULL,
    "supplierSkuNormalized" TEXT NOT NULL,
    "variantId" TEXT,
    "matchMethod" "MatchMethod" NOT NULL DEFAULT 'exact_sku',
    "status" "MappingStatus" NOT NULL DEFAULT 'unmatched',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SupplierProductMapping_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PricingRule" (
    "id" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "supplierId" TEXT,
    "name" TEXT NOT NULL,
    "priority" INTEGER NOT NULL DEFAULT 100,
    "vendorFilter" TEXT,
    "productTypeFilter" TEXT,
    "minimumMarginPercent" DECIMAL(9,4) NOT NULL DEFAULT 0,
    "markupPercent" DECIMAL(9,4) NOT NULL DEFAULT 0,
    "fixedHandlingPerUnit" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "dutyPercent" DECIMAL(9,4) NOT NULL DEFAULT 0,
    "otherCostPercent" DECIMAL(9,4) NOT NULL DEFAULT 0,
    "roundingRule" TEXT NOT NULL DEFAULT 'none',
    "minimumPrice" DECIMAL(18,4),
    "maximumPrice" DECIMAL(18,4),
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PricingRule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SafetyPolicy" (
    "id" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "maxPriceDecreasePercent" DECIMAL(9,4) NOT NULL DEFAULT 20,
    "maxPriceIncreasePercent" DECIMAL(9,4) NOT NULL DEFAULT 50,
    "maxInventoryChangePercent" DECIMAL(9,4) NOT NULL DEFAULT 90,
    "maxInventoryAbsoluteChange" INTEGER NOT NULL DEFAULT 1000,
    "maxInvalidRowPercent" DECIMAL(9,4) NOT NULL DEFAULT 10,
    "maxRowCountDecreasePercent" DECIMAL(9,4) NOT NULL DEFAULT 50,
    "allowZeroCost" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SafetyPolicy_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FeedRun" (
    "id" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "supplierId" TEXT NOT NULL,
    "trigger" "FeedRunTrigger" NOT NULL,
    "status" "FeedRunStatus" NOT NULL DEFAULT 'queued',
    "sourceFilename" TEXT,
    "sourceChecksum" TEXT,
    "headerFingerprint" TEXT,
    "rowCount" INTEGER NOT NULL DEFAULT 0,
    "validCount" INTEGER NOT NULL DEFAULT 0,
    "invalidCount" INTEGER NOT NULL DEFAULT 0,
    "matchedCount" INTEGER NOT NULL DEFAULT 0,
    "unmatchedCount" INTEGER NOT NULL DEFAULT 0,
    "ambiguousCount" INTEGER NOT NULL DEFAULT 0,
    "safeChangeCount" INTEGER NOT NULL DEFAULT 0,
    "warningCount" INTEGER NOT NULL DEFAULT 0,
    "blockedCount" INTEGER NOT NULL DEFAULT 0,
    "rulesSnapshot" JSONB,
    "safetySnapshot" JSONB,
    "errorSummary" TEXT,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FeedRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FeedRow" (
    "id" TEXT NOT NULL,
    "feedRunId" TEXT NOT NULL,
    "rowNumber" INTEGER NOT NULL,
    "supplierSkuOriginal" TEXT,
    "supplierSkuNormalized" TEXT,
    "supplierName" TEXT,
    "barcode" TEXT,
    "manufacturerPartNumber" TEXT,
    "quantity" INTEGER,
    "unitCost" DECIMAL(18,4),
    "msrp" DECIMAL(18,4),
    "packSize" DECIMAL(18,4),
    "freightPerUnit" DECIMAL(18,4),
    "rawData" JSONB,
    "validationStatus" TEXT NOT NULL DEFAULT 'valid',
    "validationErrors" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FeedRow_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProposedChange" (
    "id" TEXT NOT NULL,
    "feedRunId" TEXT NOT NULL,
    "feedRowId" TEXT NOT NULL,
    "variantId" TEXT,
    "mappingStatus" "MappingStatus" NOT NULL DEFAULT 'unmatched',
    "currentQuantity" INTEGER,
    "proposedQuantity" INTEGER,
    "currentUnitCost" DECIMAL(18,4),
    "supplierUnitCost" DECIMAL(18,4),
    "landedCost" DECIMAL(18,4),
    "currentPrice" DECIMAL(18,4),
    "recommendedPrice" DECIMAL(18,4),
    "currentMarginPercent" DECIMAL(9,4),
    "recommendedMarginPercent" DECIMAL(9,4),
    "classification" "ChangeClassification" NOT NULL DEFAULT 'unmatched',
    "reasonCodes" JSONB NOT NULL DEFAULT '[]',
    "overrideApproved" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProposedChange_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ChangeSet" (
    "id" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "feedRunId" TEXT NOT NULL,
    "status" "ChangeSetStatus" NOT NULL DEFAULT 'pending',
    "updateInventory" BOOLEAN NOT NULL DEFAULT false,
    "updatePrice" BOOLEAN NOT NULL DEFAULT false,
    "updateUnitCost" BOOLEAN NOT NULL DEFAULT false,
    "approvedBy" TEXT,
    "approvedAt" TIMESTAMP(3),
    "idempotencyKey" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ChangeSet_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ChangeItem" (
    "id" TEXT NOT NULL,
    "changeSetId" TEXT NOT NULL,
    "proposedChangeId" TEXT NOT NULL,
    "variantId" TEXT NOT NULL,
    "operationSnapshot" JSONB NOT NULL,
    "status" "ChangeItemStatus" NOT NULL DEFAULT 'queued',
    "attemptCount" INTEGER NOT NULL DEFAULT 0,
    "previousValues" JSONB,
    "requestedValues" JSONB,
    "returnedValues" JSONB,
    "shopifyUserErrors" JSONB,
    "lastError" TEXT,
    "appliedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ChangeItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Alert" (
    "id" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "supplierId" TEXT,
    "feedRunId" TEXT,
    "severity" "AlertSeverity" NOT NULL DEFAULT 'info',
    "type" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "status" "AlertStatus" NOT NULL DEFAULT 'unread',
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Alert_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditEvent" (
    "id" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "actorType" TEXT NOT NULL,
    "actorIdentifier" TEXT,
    "action" TEXT NOT NULL,
    "resourceType" TEXT NOT NULL,
    "resourceId" TEXT,
    "summary" TEXT NOT NULL,
    "beforeData" JSONB,
    "afterData" JSONB,
    "ipHash" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BillingEntitlement" (
    "id" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "planCode" TEXT NOT NULL DEFAULT 'free',
    "status" TEXT NOT NULL DEFAULT 'active',
    "trialEndsAt" TIMESTAMP(3),
    "subscriptionReference" TEXT,
    "limits" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BillingEntitlement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FeedUpload" (
    "id" TEXT NOT NULL,
    "feedRunId" TEXT NOT NULL,
    "filename" TEXT NOT NULL,
    "bytes" BYTEA NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FeedUpload_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WebhookEvent" (
    "id" TEXT NOT NULL,
    "webhookId" TEXT NOT NULL,
    "topic" TEXT NOT NULL,
    "shopDomain" TEXT NOT NULL,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WebhookEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Session_shop_idx" ON "Session"("shop");

-- CreateIndex
CREATE UNIQUE INDEX "Shop_shopDomain_key" ON "Shop"("shopDomain");

-- CreateIndex
CREATE INDEX "CatalogSync_shopId_startedAt_idx" ON "CatalogSync"("shopId", "startedAt");

-- CreateIndex
CREATE INDEX "ShopifyProduct_shopId_vendor_idx" ON "ShopifyProduct"("shopId", "vendor");

-- CreateIndex
CREATE INDEX "ShopifyProduct_shopId_productType_idx" ON "ShopifyProduct"("shopId", "productType");

-- CreateIndex
CREATE UNIQUE INDEX "ShopifyProduct_shopId_shopifyProductGid_key" ON "ShopifyProduct"("shopId", "shopifyProductGid");

-- CreateIndex
CREATE INDEX "ShopifyVariant_shopId_skuNormalized_idx" ON "ShopifyVariant"("shopId", "skuNormalized");

-- CreateIndex
CREATE INDEX "ShopifyVariant_shopId_barcode_idx" ON "ShopifyVariant"("shopId", "barcode");

-- CreateIndex
CREATE UNIQUE INDEX "ShopifyVariant_shopId_shopifyVariantGid_key" ON "ShopifyVariant"("shopId", "shopifyVariantGid");

-- CreateIndex
CREATE UNIQUE INDEX "VariantInventory_variantId_locationGid_key" ON "VariantInventory"("variantId", "locationGid");

-- CreateIndex
CREATE INDEX "Supplier_shopId_status_idx" ON "Supplier"("shopId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "Supplier_shopId_code_key" ON "Supplier"("shopId", "code");

-- CreateIndex
CREATE INDEX "FeedMappingProfile_supplierId_headerFingerprint_idx" ON "FeedMappingProfile"("supplierId", "headerFingerprint");

-- CreateIndex
CREATE INDEX "SupplierProductMapping_supplierId_status_idx" ON "SupplierProductMapping"("supplierId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "SupplierProductMapping_supplierId_supplierSkuNormalized_key" ON "SupplierProductMapping"("supplierId", "supplierSkuNormalized");

-- CreateIndex
CREATE INDEX "PricingRule_shopId_priority_idx" ON "PricingRule"("shopId", "priority");

-- CreateIndex
CREATE INDEX "PricingRule_supplierId_priority_idx" ON "PricingRule"("supplierId", "priority");

-- CreateIndex
CREATE UNIQUE INDEX "SafetyPolicy_shopId_key" ON "SafetyPolicy"("shopId");

-- CreateIndex
CREATE INDEX "FeedRun_shopId_status_idx" ON "FeedRun"("shopId", "status");

-- CreateIndex
CREATE INDEX "FeedRun_supplierId_createdAt_idx" ON "FeedRun"("supplierId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "FeedRun_supplierId_sourceChecksum_key" ON "FeedRun"("supplierId", "sourceChecksum");

-- CreateIndex
CREATE INDEX "FeedRow_feedRunId_supplierSkuNormalized_idx" ON "FeedRow"("feedRunId", "supplierSkuNormalized");

-- CreateIndex
CREATE UNIQUE INDEX "ProposedChange_feedRowId_key" ON "ProposedChange"("feedRowId");

-- CreateIndex
CREATE INDEX "ProposedChange_feedRunId_classification_idx" ON "ProposedChange"("feedRunId", "classification");

-- CreateIndex
CREATE UNIQUE INDEX "ChangeSet_idempotencyKey_key" ON "ChangeSet"("idempotencyKey");

-- CreateIndex
CREATE INDEX "ChangeSet_shopId_status_idx" ON "ChangeSet"("shopId", "status");

-- CreateIndex
CREATE INDEX "ChangeItem_changeSetId_status_idx" ON "ChangeItem"("changeSetId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "ChangeItem_changeSetId_proposedChangeId_key" ON "ChangeItem"("changeSetId", "proposedChangeId");

-- CreateIndex
CREATE INDEX "Alert_shopId_status_idx" ON "Alert"("shopId", "status");

-- CreateIndex
CREATE INDEX "Alert_shopId_severity_idx" ON "Alert"("shopId", "severity");

-- CreateIndex
CREATE INDEX "AuditEvent_shopId_createdAt_idx" ON "AuditEvent"("shopId", "createdAt");

-- CreateIndex
CREATE INDEX "AuditEvent_shopId_resourceType_resourceId_idx" ON "AuditEvent"("shopId", "resourceType", "resourceId");

-- CreateIndex
CREATE UNIQUE INDEX "BillingEntitlement_shopId_key" ON "BillingEntitlement"("shopId");

-- CreateIndex
CREATE UNIQUE INDEX "FeedUpload_feedRunId_key" ON "FeedUpload"("feedRunId");

-- CreateIndex
CREATE UNIQUE INDEX "WebhookEvent_webhookId_key" ON "WebhookEvent"("webhookId");

-- AddForeignKey
ALTER TABLE "CatalogSync" ADD CONSTRAINT "CatalogSync_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShopifyProduct" ADD CONSTRAINT "ShopifyProduct_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShopifyVariant" ADD CONSTRAINT "ShopifyVariant_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShopifyVariant" ADD CONSTRAINT "ShopifyVariant_productId_fkey" FOREIGN KEY ("productId") REFERENCES "ShopifyProduct"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VariantInventory" ADD CONSTRAINT "VariantInventory_variantId_fkey" FOREIGN KEY ("variantId") REFERENCES "ShopifyVariant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Supplier" ADD CONSTRAINT "Supplier_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FeedMappingProfile" ADD CONSTRAINT "FeedMappingProfile_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplierProductMapping" ADD CONSTRAINT "SupplierProductMapping_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplierProductMapping" ADD CONSTRAINT "SupplierProductMapping_variantId_fkey" FOREIGN KEY ("variantId") REFERENCES "ShopifyVariant"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PricingRule" ADD CONSTRAINT "PricingRule_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PricingRule" ADD CONSTRAINT "PricingRule_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SafetyPolicy" ADD CONSTRAINT "SafetyPolicy_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FeedRun" ADD CONSTRAINT "FeedRun_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FeedRun" ADD CONSTRAINT "FeedRun_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FeedRow" ADD CONSTRAINT "FeedRow_feedRunId_fkey" FOREIGN KEY ("feedRunId") REFERENCES "FeedRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProposedChange" ADD CONSTRAINT "ProposedChange_feedRunId_fkey" FOREIGN KEY ("feedRunId") REFERENCES "FeedRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProposedChange" ADD CONSTRAINT "ProposedChange_feedRowId_fkey" FOREIGN KEY ("feedRowId") REFERENCES "FeedRow"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProposedChange" ADD CONSTRAINT "ProposedChange_variantId_fkey" FOREIGN KEY ("variantId") REFERENCES "ShopifyVariant"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChangeSet" ADD CONSTRAINT "ChangeSet_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChangeSet" ADD CONSTRAINT "ChangeSet_feedRunId_fkey" FOREIGN KEY ("feedRunId") REFERENCES "FeedRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChangeItem" ADD CONSTRAINT "ChangeItem_changeSetId_fkey" FOREIGN KEY ("changeSetId") REFERENCES "ChangeSet"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChangeItem" ADD CONSTRAINT "ChangeItem_proposedChangeId_fkey" FOREIGN KEY ("proposedChangeId") REFERENCES "ProposedChange"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChangeItem" ADD CONSTRAINT "ChangeItem_variantId_fkey" FOREIGN KEY ("variantId") REFERENCES "ShopifyVariant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Alert" ADD CONSTRAINT "Alert_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Alert" ADD CONSTRAINT "Alert_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Alert" ADD CONSTRAINT "Alert_feedRunId_fkey" FOREIGN KEY ("feedRunId") REFERENCES "FeedRun"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditEvent" ADD CONSTRAINT "AuditEvent_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BillingEntitlement" ADD CONSTRAINT "BillingEntitlement_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE;

