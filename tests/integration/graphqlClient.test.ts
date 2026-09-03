import { describe, it, expect, vi, afterEach } from "vitest";
import { createAdminGraphqlClient, collectUserErrors } from "../../app/services/shopifyGraphql.server";

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
  vi.restoreAllMocks();
});

function mockFetchSequence(responses: Array<{ status?: number; body: unknown; headers?: Record<string, string> }>) {
  let i = 0;
  globalThis.fetch = vi.fn(async () => {
    const r = responses[Math.min(i, responses.length - 1)];
    i += 1;
    return new Response(JSON.stringify(r.body), {
      status: r.status ?? 200,
      headers: { "content-type": "application/json", ...(r.headers ?? {}) },
    });
  }) as typeof fetch;
}

const client = () => createAdminGraphqlClient({ shopDomain: "demo.myshopify.com", accessToken: "shpat_x", maxRetries: 3 });

describe("Admin GraphQL client", () => {
  it("returns data on success and exposes cost", async () => {
    mockFetchSequence([
      {
        body: {
          data: { shop: { name: "Demo" } },
          extensions: { cost: { requestedQueryCost: 10, actualQueryCost: 8, throttleStatus: { maximumAvailable: 1000, currentlyAvailable: 990, restoreRate: 50 } } },
        },
      },
    ]);
    const res = await client().request<{ shop: { name: string } }>("{ shop { name } }");
    expect(res.data?.shop.name).toBe("Demo");
    expect(res.cost?.throttleStatus?.currentlyAvailable).toBe(990);
  });

  it("retries a THROTTLED error then succeeds", async () => {
    mockFetchSequence([
      { body: { errors: [{ message: "Throttled", extensions: { code: "THROTTLED" } }], extensions: { cost: { requestedQueryCost: 100, throttleStatus: { maximumAvailable: 1000, currentlyAvailable: 5, restoreRate: 100 } } } } },
      { body: { data: { ok: true } } },
    ]);
    const res = await client().request<{ ok: boolean }>("{ ok }");
    expect(res.data).toEqual({ ok: true });
    expect((globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls.length).toBe(2);
  });

  it("retries a single 5xx then succeeds", async () => {
    mockFetchSequence([
      { status: 500, body: {} },
      { body: { data: { ok: true } } },
    ]);
    const res = await client().request<{ ok: boolean }>("{ ok }");
    expect(res.data).toEqual({ ok: true });
    expect((globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls.length).toBe(2);
  }, 10_000);

  it("classifies a persistent 5xx as a retryable ShopifyGraphqlError", async () => {
    // maxRetries:1 keeps the backoff short enough for the default timeout.
    const c = createAdminGraphqlClient({ shopDomain: "demo.myshopify.com", accessToken: "x", maxRetries: 1 });
    mockFetchSequence([{ status: 503, body: {} }]);
    await expect(c.request("{ ok }")).rejects.toMatchObject({ name: "ShopifyGraphqlError", retryable: true });
  }, 10_000);

  it("does NOT retry a top-level GraphQL error with no data", async () => {
    mockFetchSequence([{ body: { errors: [{ message: "Field 'bogus' doesn't exist" }] } }]);
    await expect(client().request("{ bogus }")).rejects.toThrow(/bogus/);
    expect((globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls.length).toBe(1);
  });

  it("surfaces mutation userErrors without retrying", async () => {
    mockFetchSequence([
      {
        body: {
          data: {
            productVariantsBulkUpdate: {
              productVariants: [],
              userErrors: [{ field: ["variants", "0", "price"], message: "Price must be positive" }],
            },
          },
        },
      },
    ]);
    const res = await client().request("mutation { x }");
    const ue = collectUserErrors(res.data);
    expect(ue).toHaveLength(1);
    expect(ue[0].message).toMatch(/positive/);
    expect((globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls.length).toBe(1);
  });
});

describe("collectUserErrors", () => {
  it("finds userErrors at any depth", () => {
    expect(
      collectUserErrors({ a: { b: { userErrors: [{ message: "nope" }] } } }),
    ).toEqual([{ path: "a.b", field: null, message: "nope" }]);
  });
  it("returns [] when there are none", () => {
    expect(collectUserErrors({ a: { b: 1 } })).toEqual([]);
  });
});
