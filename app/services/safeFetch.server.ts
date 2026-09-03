/**
 * SSRF-resistant remote feed fetching (spec 5.3 / 12).
 *
 * - Blocks non-http(s) schemes.
 * - Resolves the hostname and rejects private / loopback / link-local /
 *   unique-local / CGNAT ranges (IPv4 + IPv6), re-checking on every redirect
 *   hop to defeat DNS rebinding.
 * - Caps redirects, response bytes, and total time.
 */
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

export interface SafeFetchOptions {
  maxBytes: number;
  timeoutMs: number;
  maxRedirects: number;
  basicAuth?: { username: string; password: string } | null;
}

export interface SafeFetchResult {
  status: number;
  contentType: string | null;
  bytes: number;
  body: Buffer;
  finalUrl: string;
}

export class SsrfBlockedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SsrfBlockedError";
  }
}

function ipIsBlocked(ip: string): boolean {
  const v = isIP(ip);
  if (v === 4) {
    const parts = ip.split(".").map(Number);
    const [a, b] = parts;
    if (a === 10) return true;
    if (a === 127) return true;
    if (a === 0) return true;
    if (a === 169 && b === 254) return true; // link-local
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT
    if (a >= 224) return true; // multicast + reserved
    return false;
  }
  if (v === 6) {
    const lower = ip.toLowerCase();
    if (lower === "::1" || lower === "::") return true;
    if (lower.startsWith("fe80")) return true; // link-local
    if (lower.startsWith("fc") || lower.startsWith("fd")) return true; // unique-local
    if (lower.startsWith("ff")) return true; // multicast
    // IPv4-mapped ::ffff:a.b.c.d
    const m = lower.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    if (m) return ipIsBlocked(m[1]);
    return false;
  }
  return true; // not a parseable IP
}

export async function assertUrlAllowed(rawUrl: string): Promise<URL> {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new SsrfBlockedError("The feed URL is not valid.");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new SsrfBlockedError("Only http and https feed URLs are allowed.");
  }
  const host = url.hostname.replace(/^\[|\]$/g, "");

  if (isIP(host)) {
    if (ipIsBlocked(host)) throw new SsrfBlockedError("That address range is not allowed.");
    return url;
  }
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".internal")) {
    throw new SsrfBlockedError("That host is not allowed.");
  }
  const results = await lookup(host, { all: true });
  if (results.length === 0) throw new SsrfBlockedError("The feed host could not be resolved.");
  for (const r of results) {
    if (ipIsBlocked(r.address)) {
      throw new SsrfBlockedError("The feed host resolves to a blocked address.");
    }
  }
  return url;
}

export async function safeFetchFeed(rawUrl: string, opts: SafeFetchOptions): Promise<SafeFetchResult> {
  let currentUrl = rawUrl;
  let redirects = 0;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs);

  try {
    // eslint-disable-next-line no-constant-condition
    while (true) {
      const validated = await assertUrlAllowed(currentUrl);

      const headers: Record<string, string> = { Accept: "text/csv,text/plain,*/*" };
      if (opts.basicAuth) {
        const token = Buffer.from(
          `${opts.basicAuth.username}:${opts.basicAuth.password}`,
        ).toString("base64");
        headers.Authorization = `Basic ${token}`;
      }

      const res = await fetch(validated.toString(), {
        method: "GET",
        redirect: "manual",
        signal: controller.signal,
        headers,
      });

      if (res.status >= 300 && res.status < 400) {
        const location = res.headers.get("location");
        if (!location) throw new SsrfBlockedError("Redirect without a location header.");
        redirects += 1;
        if (redirects > opts.maxRedirects) {
          throw new SsrfBlockedError("Too many redirects while fetching the feed.");
        }
        currentUrl = new URL(location, validated).toString();
        continue;
      }

      if (!res.ok) {
        throw new Error(`FEED_HTTP_${res.status}`);
      }

      const reader = res.body?.getReader();
      const chunks: Buffer[] = [];
      let total = 0;
      if (reader) {
        // eslint-disable-next-line no-constant-condition
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          total += value.byteLength;
          if (total > opts.maxBytes) {
            await reader.cancel();
            throw new Error("FEED_TOO_LARGE");
          }
          chunks.push(Buffer.from(value));
        }
      }

      return {
        status: res.status,
        contentType: res.headers.get("content-type"),
        bytes: total,
        body: Buffer.concat(chunks),
        finalUrl: validated.toString(),
      };
    }
  } finally {
    clearTimeout(timer);
  }
}
