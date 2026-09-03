/**
 * Throttle-aware Shopify Admin GraphQL client for the worker process, which
 * runs outside a request and authenticates with the stored offline access
 * token (spec 8).
 *
 * - Reads `extensions.cost.throttleStatus` and paces requests.
 * - Retries transient failures (network, THROTTLED, 5xx) with exponential
 *   backoff + jitter. Never retries GraphQL `userErrors` — those are permanent
 *   validation problems the merchant must resolve.
 */
import { SHOPIFY_API_VERSION } from "../config/apiVersion";
import { logger } from "./logger.server";

export interface GraphqlResult<T> {
  data: T | null;
  errors: unknown[] | null;
  userErrorsDetectedIn: string[];
  requestId: string | null;
  cost: {
    requestedQueryCost: number;
    actualQueryCost: number | null;
    throttleStatus: {
      maximumAvailable: number;
      currentlyAvailable: number;
      restoreRate: number;
    } | null;
  } | null;
}

export class ShopifyGraphqlError extends Error {
  constructor(
    message: string,
    public readonly retryable: boolean,
    public readonly requestId: string | null = null,
  ) {
    super(message);
    this.name = "ShopifyGraphqlError";
  }
}

export interface AdminClientOptions {
  shopDomain: string;
  accessToken: string;
  apiVersion?: string;
  maxRetries?: number;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const jitter = (ms: number) => ms * (0.5 + Math.random());

export interface AdminGraphqlClient {
  request: <T>(query: string, variables?: Record<string, unknown>) => Promise<GraphqlResult<T>>;
  endpoint: string;
}

export function createAdminGraphqlClient(opts: AdminClientOptions): AdminGraphqlClient {
  const version = opts.apiVersion ?? SHOPIFY_API_VERSION;
  const endpoint = `https://${opts.shopDomain}/admin/api/${version}/graphql.json`;
  const maxRetries = opts.maxRetries ?? 5;

  async function request<T>(
    query: string,
    variables?: Record<string, unknown>,
  ): Promise<GraphqlResult<T>> {
    let attempt = 0;
    // eslint-disable-next-line no-constant-condition
    while (true) {
      attempt += 1;
      let res: Response;
      try {
        res = await fetch(endpoint, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-Shopify-Access-Token": opts.accessToken,
          },
          body: JSON.stringify({ query, variables: variables ?? {} }),
        });
      } catch (err) {
        if (attempt > maxRetries) {
          throw new ShopifyGraphqlError(`Network error: ${(err as Error).message}`, true);
        }
        await sleep(jitter(2 ** attempt * 500));
        continue;
      }

      const requestId = res.headers.get("x-request-id");

      if (res.status === 429 || res.status >= 500) {
        if (attempt > maxRetries) {
          throw new ShopifyGraphqlError(`HTTP ${res.status} from Shopify`, true, requestId);
        }
        const retryAfter = Number(res.headers.get("retry-after")) || 2 ** attempt;
        await sleep(jitter(retryAfter * 1000));
        continue;
      }

      const json = (await res.json()) as {
        data?: T;
        errors?: Array<{ message: string; extensions?: { code?: string } }>;
        extensions?: {
          cost?: GraphqlResult<T>["cost"];
        };
      };

      const throttled = json.errors?.some((e) => e.extensions?.code === "THROTTLED");
      if (throttled) {
        if (attempt > maxRetries) {
          throw new ShopifyGraphqlError("Throttled by Shopify", true, requestId);
        }
        const restore = json.extensions?.cost?.throttleStatus?.restoreRate ?? 50;
        const needed = json.extensions?.cost?.requestedQueryCost ?? 100;
        await sleep(jitter(Math.max(1000, (needed / restore) * 1000)));
        continue;
      }

      const cost = json.extensions?.cost ?? null;
      // Gentle proactive pacing when the bucket is low.
      if (cost?.throttleStatus && cost.throttleStatus.currentlyAvailable < cost.throttleStatus.maximumAvailable * 0.15) {
        await sleep(jitter(1000));
      }

      if (json.errors && json.errors.length > 0 && !json.data) {
        throw new ShopifyGraphqlError(
          json.errors.map((e) => e.message).join("; "),
          false,
          requestId,
        );
      }

      return {
        data: json.data ?? null,
        errors: json.errors ?? null,
        userErrorsDetectedIn: [],
        requestId,
        cost,
      };
    }
  }

  return { request, endpoint };
}

/** Extract Shopify mutation `userErrors` from an arbitrary response object. */
export function collectUserErrors(obj: unknown, path: string[] = []): Array<{ path: string; field: string[] | null; message: string }> {
  const out: Array<{ path: string; field: string[] | null; message: string }> = [];
  if (!obj || typeof obj !== "object") return out;
  for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
    if (key === "userErrors" && Array.isArray(value)) {
      for (const ue of value as Array<{ field?: string[]; message: string }>) {
        out.push({ path: path.join("."), field: ue.field ?? null, message: ue.message });
      }
    } else if (value && typeof value === "object") {
      out.push(...collectUserErrors(value, [...path, key]));
    }
  }
  return out;
}

export function logThrottle(scope: string, cost: GraphqlResult<unknown>["cost"]) {
  if (!cost?.throttleStatus) return;
  logger.debug(
    {
      scope,
      available: cost.throttleStatus.currentlyAvailable,
      max: cost.throttleStatus.maximumAvailable,
    },
    "graphql throttle status",
  );
}
