import { useEffect } from "react";
import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { Outlet, useLoaderData, useRouteError, useSubmit } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { AppProvider } from "@shopify/shopify-app-react-router/react";
import { NavMenu } from "@shopify/app-bridge-react";

import { authenticate } from "../shopify.server";
import { upsertShopFromSession } from "../services/shopContext.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  // First load creates/updates the Shop record + session (spec 5.1).
  await upsertShopFromSession(session);
  // eslint-disable-next-line no-undef
  return { apiKey: process.env.SHOPIFY_API_KEY || "" };
};

/**
 * Two problems this solves for the embedded app:
 *  1. Polaris `<s-button type="submit">` doesn't reliably submit its native
 *     <form> inside the App Bridge iframe.
 *  2. A *native* form POST carries no App Bridge session token, so Shopify
 *     can't authenticate it, bounces it through a token exchange, and the
 *     form body is lost.
 * Fix: intercept clicks on s-* submit controls and submit the form through
 * React Router's `submit()`, which goes over `fetch` — App Bridge patches
 * `fetch` to attach `Authorization: Bearer <sessionToken>`.
 */
function useSubmitButtonBridge() {
  const submit = useSubmit();
  useEffect(() => {
    const onClick = (event: MouseEvent) => {
      if (event.defaultPrevented) return;
      const path = event.composedPath();
      for (const node of path) {
        if (!(node instanceof HTMLElement)) continue;
        const tag = node.tagName.toLowerCase();
        if (tag === "form") return;
        const isSubmit =
          (tag === "s-button" || tag === "button") &&
          (node.getAttribute("type") === "submit" || node.getAttribute("submit") !== null);
        if (isSubmit) {
          if (node.hasAttribute("disabled")) return;
          const form = node.closest("form");
          if (form) {
            event.preventDefault();
            // navigate:false runs the submission through an internal fetcher,
            // the code path App Bridge intercepts to attach the session token.
            // Redirects returned by actions are still followed.
            submit(form, { navigate: false });
          }
          return;
        }
      }
    };
    document.addEventListener("click", onClick, true);
    return () => document.removeEventListener("click", onClick, true);
  }, [submit]);
}

export default function App() {
  const { apiKey } = useLoaderData<typeof loader>();
  useSubmitButtonBridge();

  return (
    <AppProvider embedded apiKey={apiKey}>
      <NavMenu>
        <a href="/app" rel="home">
          Home
        </a>
        <a href="/app/suppliers">Suppliers</a>
        <a href="/app/mappings">Mappings</a>
        <a href="/app/runs">Runs</a>
        <a href="/app/rules">Rules</a>
        <a href="/app/alerts">Alerts</a>
        <a href="/app/settings">Settings</a>
        <a href="/app/guide">Guide me</a>
        <a href="/app/help">Help &amp; docs</a>
      </NavMenu>
      <Outlet />
    </AppProvider>
  );
}

export function ErrorBoundary() {
  return boundary.error(useRouteError());
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
