/**
 * Catalog synchronization (spec 5.2). Cursor-paginated read of products +
 * variants + inventory into the local mirror. Safe to re-run: upserts by GID,
 * and products/variants no longer seen are marked inactive (not hard-deleted).
 */
import prisma from "../../db.server";
import { createAdminGraphqlClient, type GraphqlResult } from "../../services/shopifyGraphql.server";
import { logger } from "../../services/logger.server";
import { normalizeSku, normalizeBarcode } from "../mapping/normalize";
import {
  PRODUCTS_PAGE_QUERY,
  PRODUCT_VARIANTS_PAGE_QUERY,
  SHOP_LOCATIONS_QUERY,
} from "./graphql";

interface VariantNode {
  id: string;
  title: string | null;
  sku: string | null;
  barcode: string | null;
  price: string | null;
  compareAtPrice: string | null;
  updatedAt: string | null;
  inventoryItem: {
    id: string;
    tracked: boolean;
    unitCost: { amount: string } | null;
    inventoryLevels: {
      edges: Array<{
        node: {
          location: { id: string };
          quantities: Array<{ name: string; quantity: number }>;
        };
      }>;
    };
  } | null;
}

interface ProductNode {
  id: string;
  title: string;
  vendor: string | null;
  productType: string | null;
  status: string | null;
  updatedAt: string | null;
  variants: {
    pageInfo: { hasNextPage: boolean; endCursor: string | null };
    edges: Array<{ node: VariantNode }>;
  };
}

interface ProductsPageData {
  products: {
    pageInfo: { hasNextPage: boolean; endCursor: string | null };
    edges: Array<{ node: ProductNode }>;
  };
}

interface VariantsPageData {
  product: {
    variants: {
      pageInfo: { hasNextPage: boolean; endCursor: string | null };
      edges: Array<{ node: VariantNode }>;
    };
  } | null;
}

interface ShopLocationsData {
  shop: { id: string; currencyCode: string; ianaTimezone: string } | null;
  locations: { edges: Array<{ node: { id: string; name: string; isActive: boolean } }> };
}

export interface CatalogSyncDeps {
  shopId: string;
  shopDomain: string;
  accessToken: string;
  catalogSyncId: string;
}

export async function runCatalogSync(deps: CatalogSyncDeps) {
  const log = logger.child({ scope: "catalog-sync", shopId: deps.shopId });
  const client = createAdminGraphqlClient({
    shopDomain: deps.shopDomain,
    accessToken: deps.accessToken,
  });

  await prisma.catalogSync.update({
    where: { id: deps.catalogSyncId },
    data: { status: "running", startedAt: new Date() },
  });

  // 1. Shop + locations
  const shopRes: GraphqlResult<ShopLocationsData> = await client.request<ShopLocationsData>(
    SHOP_LOCATIONS_QUERY,
  );

  if (shopRes.data?.shop) {
    await prisma.shop.update({
      where: { id: deps.shopId },
      data: {
        shopifyShopGid: shopRes.data.shop.id,
        currencyCode: shopRes.data.shop.currencyCode,
        timezone: shopRes.data.shop.ianaTimezone || "UTC",
      },
    });
  }

  const seenProductGids = new Set<string>();
  const seenVariantGids = new Set<string>();
  let productCount = 0;
  let variantCount = 0;
  let cursor: string | null = null;

  // 2. Products page loop
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const res: GraphqlResult<ProductsPageData> = await client.request<ProductsPageData>(
      PRODUCTS_PAGE_QUERY,
      { cursor },
    );
    const page: ProductsPageData["products"] | undefined = res.data?.products;
    if (!page) break;

    for (const { node: p } of page.edges) {
      seenProductGids.add(p.id);
      productCount += 1;

      const product = await prisma.shopifyProduct.upsert({
        where: { shopId_shopifyProductGid: { shopId: deps.shopId, shopifyProductGid: p.id } },
        create: {
          shopId: deps.shopId,
          shopifyProductGid: p.id,
          title: p.title,
          vendor: p.vendor,
          productType: p.productType,
          status: p.status,
          activeLocally: true,
          shopifyUpdatedAt: p.updatedAt ? new Date(p.updatedAt) : null,
        },
        update: {
          title: p.title,
          vendor: p.vendor,
          productType: p.productType,
          status: p.status,
          activeLocally: true,
          shopifyUpdatedAt: p.updatedAt ? new Date(p.updatedAt) : null,
        },
      });

      const variantNodes: VariantNode[] = p.variants.edges.map((e) => e.node);
      let vCursor = p.variants.pageInfo.hasNextPage ? p.variants.pageInfo.endCursor : null;
      while (vCursor) {
        const vres: GraphqlResult<VariantsPageData> = await client.request<VariantsPageData>(
          PRODUCT_VARIANTS_PAGE_QUERY,
          { productId: p.id, cursor: vCursor },
        );
        const vp = vres.data?.product?.variants;
        if (!vp) break;
        variantNodes.push(...vp.edges.map((e) => e.node));
        vCursor = vp.pageInfo.hasNextPage ? vp.pageInfo.endCursor : null;
      }

      for (const v of variantNodes) {
        seenVariantGids.add(v.id);
        variantCount += 1;
        const variant = await prisma.shopifyVariant.upsert({
          where: { shopId_shopifyVariantGid: { shopId: deps.shopId, shopifyVariantGid: v.id } },
          create: {
            shopId: deps.shopId,
            productId: product.id,
            shopifyVariantGid: v.id,
            shopifyInventoryItemGid: v.inventoryItem?.id ?? null,
            skuOriginal: v.sku,
            skuNormalized: normalizeSku(v.sku),
            barcode: v.barcode,
            title: v.title,
            price: v.price ?? undefined,
            compareAtPrice: v.compareAtPrice ?? undefined,
            unitCost: v.inventoryItem?.unitCost?.amount ?? undefined,
            inventoryTracked: v.inventoryItem?.tracked ?? false,
            activeLocally: true,
            shopifyUpdatedAt: v.updatedAt ? new Date(v.updatedAt) : null,
          },
          update: {
            productId: product.id,
            shopifyInventoryItemGid: v.inventoryItem?.id ?? null,
            skuOriginal: v.sku,
            skuNormalized: normalizeSku(v.sku),
            barcode: v.barcode,
            title: v.title,
            price: v.price ?? undefined,
            compareAtPrice: v.compareAtPrice ?? undefined,
            unitCost: v.inventoryItem?.unitCost?.amount ?? undefined,
            inventoryTracked: v.inventoryItem?.tracked ?? false,
            activeLocally: true,
            shopifyUpdatedAt: v.updatedAt ? new Date(v.updatedAt) : null,
          },
        });

        for (const lvl of v.inventoryItem?.inventoryLevels.edges ?? []) {
          const available =
            lvl.node.quantities.find((q) => q.name === "available")?.quantity ?? 0;
          await prisma.variantInventory.upsert({
            where: {
              variantId_locationGid: { variantId: variant.id, locationGid: lvl.node.location.id },
            },
            create: {
              variantId: variant.id,
              locationGid: lvl.node.location.id,
              availableQuantity: available,
            },
            update: { availableQuantity: available, lastSyncedAt: new Date() },
          });
        }
      }
      void normalizeBarcode; // barcode normalization is applied at match time (see matcher)
    }

    if (!page.pageInfo.hasNextPage) break;
    cursor = page.pageInfo.endCursor;
  }

  // 3. Mark vanished records inactive (never hard-delete here)
  await prisma.shopifyProduct.updateMany({
    where: { shopId: deps.shopId, shopifyProductGid: { notIn: [...seenProductGids] } },
    data: { activeLocally: false },
  });
  await prisma.shopifyVariant.updateMany({
    where: { shopId: deps.shopId, shopifyVariantGid: { notIn: [...seenVariantGids] } },
    data: { activeLocally: false },
  });

  await prisma.catalogSync.update({
    where: { id: deps.catalogSyncId },
    data: { status: "completed", completedAt: new Date(), productCount, variantCount },
  });

  log.info({ productCount, variantCount }, "catalog sync complete");
  return { productCount, variantCount };
}
