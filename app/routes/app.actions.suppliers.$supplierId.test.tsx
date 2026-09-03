import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import { requireShop, requireSupplier } from "../services/shopContext.server";
import { decryptCredentials } from "../services/encryption.server";
import { safeFetchFeed, SsrfBlockedError } from "../services/safeFetch.server";

/** Test a supplier's URL connection without creating a feed run (spec 5.3). */
export const action = async ({ request, params }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = await requireShop(session);
  const supplier = await requireSupplier(shop.id, params.supplierId!);

  if (supplier.feedType !== "url_csv" || !supplier.feedUrl) {
    return Response.json({ ok: false, message: "This supplier is not configured for URL feeds." }, { status: 400 });
  }

  const creds = decryptCredentials(supplier.encryptedCredentials);
  try {
    const res = await safeFetchFeed(supplier.feedUrl, {
      maxBytes: 262_144, // 256 KiB probe
      timeoutMs: 15_000,
      maxRedirects: Number(process.env.REMOTE_FETCH_MAX_REDIRECTS || 3),
      basicAuth:
        creds.username || creds.password
          ? { username: creds.username ?? "", password: creds.password ?? "" }
          : null,
    });
    const firstLine = res.body.toString("utf8").split(/\r?\n/)[0]?.slice(0, 500) ?? "";
    return Response.json({
      ok: true,
      status: res.status,
      contentType: res.contentType,
      bytesSampled: res.bytes,
      firstHeaderLine: firstLine,
    });
  } catch (err) {
    const message =
      err instanceof SsrfBlockedError
        ? err.message
        : `Could not reach the feed: ${(err as Error).message}`;
    return Response.json({ ok: false, message }, { status: 400 });
  }
};

// Resource route: POST only. A loader is required so React Router single-fetch
// routes fetcher submissions here instead of returning 400 Bad Request.
export const loader = () => {
  throw new Response("Method Not Allowed", { status: 405 });
};
