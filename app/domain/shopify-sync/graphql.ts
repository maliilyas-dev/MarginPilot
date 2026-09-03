/** Admin GraphQL documents used by MarginPilot (spec 8). GID strings only. */

export const SHOP_LOCATIONS_QUERY = /* GraphQL */ `
  query MarginPilotShopLocations {
    shop {
      id
      name
      currencyCode
      ianaTimezone
    }
    locations(first: 50, includeInactive: false) {
      edges {
        node {
          id
          name
          isActive
          shipsInventory
        }
      }
    }
  }
`;

/** Cursor-paginated catalog read. 50 products / 100 variants per page. */
export const PRODUCTS_PAGE_QUERY = /* GraphQL */ `
  query MarginPilotProductsPage($cursor: String) {
    products(first: 10, after: $cursor, sortKey: UPDATED_AT) {
      pageInfo {
        hasNextPage
        endCursor
      }
      edges {
        node {
          id
          title
          vendor
          productType
          status
          updatedAt
          variants(first: 25) {
            pageInfo {
              hasNextPage
              endCursor
            }
            edges {
              node {
                id
                title
                sku
                barcode
                price
                compareAtPrice
                updatedAt
                inventoryItem {
                  id
                  tracked
                  unitCost {
                    amount
                  }
                  inventoryLevels(first: 5) {
                    edges {
                      node {
                        location {
                          id
                        }
                        quantities(names: ["available"]) {
                          name
                          quantity
                        }
                      }
                    }
                  }
                }
              }
            }
          }
        }
      }
    }
  }
`;

/** Fetch the remaining variants of a product whose first page overflowed 100. */
export const PRODUCT_VARIANTS_PAGE_QUERY = /* GraphQL */ `
  query MarginPilotProductVariantsPage($productId: ID!, $cursor: String) {
    product(id: $productId) {
      id
      variants(first: 40, after: $cursor) {
        pageInfo {
          hasNextPage
          endCursor
        }
        edges {
          node {
            id
            title
            sku
            barcode
            price
            compareAtPrice
            updatedAt
            inventoryItem {
              id
              tracked
              unitCost {
                amount
              }
              inventoryLevels(first: 5) {
                edges {
                  node {
                    location {
                      id
                    }
                    quantities(names: ["available"]) {
                      name
                      quantity
                    }
                  }
                }
              }
            }
          }
        }
      }
    }
  }
`;

export const VARIANT_PRICE_UPDATE_MUTATION = /* GraphQL */ `
  mutation MarginPilotVariantPriceUpdate($productId: ID!, $variants: [ProductVariantsBulkInput!]!) {
    productVariantsBulkUpdate(productId: $productId, variants: $variants) {
      productVariants {
        id
        price
        compareAtPrice
      }
      userErrors {
        field
        message
      }
    }
  }
`;

/** Absolute set of an inventory quantity with compare-and-set semantics. */
export const INVENTORY_SET_QUANTITIES_MUTATION = /* GraphQL */ `
  mutation MarginPilotInventorySet($input: InventorySetQuantitiesInput!) {
    inventorySetQuantities(input: $input) {
      inventoryAdjustmentGroup {
        createdAt
        reason
        changes {
          name
          delta
          quantityAfterChange
        }
      }
      userErrors {
        field
        message
        code
      }
    }
  }
`;

export const INVENTORY_ITEM_UPDATE_COST_MUTATION = /* GraphQL */ `
  mutation MarginPilotInventoryItemCost($id: ID!, $input: InventoryItemInput!) {
    inventoryItemUpdate(id: $id, input: $input) {
      inventoryItem {
        id
        unitCost {
          amount
        }
      }
      userErrors {
        field
        message
      }
    }
  }
`;
