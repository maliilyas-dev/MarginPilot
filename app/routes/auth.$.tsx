
import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { useRouteError } from "react-router";
import { authenticate } from "../shopify.server";
import { boundary } from "@shopify/shopify-app-react-router/server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  await authenticate.admin(request);

  return null;
};

/**
 * authenticate.admin() on this route normally throws (never returns) — a
 * redirect for OAuth, or a 200 response whose body is just a
 * `<script src="app-bridge.js">` for Shopify's session-token "bounce" page
 * (it needs to run in the browser to fetch a fresh token, so it can't be a
 * plain HTTP redirect). This route sits above app.tsx in the route tree, so
 * without its own ErrorBoundary that thrown response has nowhere to go but
 * React Router's generic fallback — which prints the bare status code
 * instead of rendering the script, so the bounce never runs and re-auth
 * never completes.
 */
export function ErrorBoundary() {
  return boundary.error(useRouteError());
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
