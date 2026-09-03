import { useEffect } from "react";
import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { Outlet, useLoaderData, useRouteError } from "react-router";
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
 * Polaris web-component `<s-button type="submit">` does not reliably submit its
 * enclosing native <form> inside the embedded App Bridge iframe. Delegate:
 * on any click that lands on an s-* submit control inside a <form>, call
 * form.requestSubmit() so React Router's <Form>/<fetcher.Form> handling runs.
 */
function useSubmitButtonBridge() {
  useEffect(() => {
    const onClick = (event: MouseEvent) => {
      const path = event.composedPath();
      for (const node of path) {
        if (!(node instanceof HTMLElement)) continue;
        const tag = node.tagName.toLowerCase();
        if (tag === "form") return; // reached the form without a submit control
        const isSubmit =
          (tag === "s-button" || tag === "button") &&
          (node.getAttribute("type") === "submit" || node.getAttribute("submit") !== null);
        if (isSubmit) {
          if (node.hasAttribute("disabled")) return;
          const form = node.closest("form");
          if (form && typeof form.requestSubmit === "function") {
            event.preventDefault();
            event.stopPropagation();
            // Let any App Bridge internals settle, then submit once.
            form.requestSubmit();
          }
          return;
        }
      }
    };
    document.addEventListener("click", onClick, true);
    return () => document.removeEventListener("click", onClick, true);
  }, []);
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
