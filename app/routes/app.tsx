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
const FIELD_TAGS =
  "s-text-field,s-select,s-number-field,s-password-field,s-text-area,s-email-field,s-url-field,s-money-field,s-search-field,s-date-field,s-checkbox,s-switch,s-choice-list,s-color-field";

/**
 * Polaris web-component form fields (`s-text-field`, `s-select`, …) don't
 * reliably contribute their value to the native FormData a React Router form
 * reads on submit. Mirror each named field into a hidden <input> right before
 * submitting, then clean them up.
 */
function mirrorPolarisFields(form: HTMLFormElement): HTMLInputElement[] {
  const mirrors: HTMLInputElement[] = [];
  form.querySelectorAll<HTMLElement>(FIELD_TAGS).forEach((el) => {
    const name = el.getAttribute("name");
    if (!name) return;
    const tag = el.tagName.toLowerCase();
    let value: string;
    if (tag === "s-checkbox" || tag === "s-switch") {
      const checked =
        (el as unknown as { checked?: boolean }).checked ?? el.hasAttribute("checked");
      if (!checked) return;
      value = el.getAttribute("value") || "on";
    } else {
      const v = (el as unknown as { value?: unknown }).value;
      value = v == null ? el.getAttribute("value") ?? "" : String(v);
    }
    const input = document.createElement("input");
    input.type = "hidden";
    input.name = name;
    input.value = value;
    input.dataset.polarisMirror = "1";
    form.appendChild(input);
    mirrors.push(input);
  });
  return mirrors;
}

function useSubmitButtonBridge() {
  useEffect(() => {
    let busy = false;
    const onClick = (event: MouseEvent) => {
      if (event.defaultPrevented || busy) return;
      // Find the s-button host in the event path (light DOM, so closest("form") works).
      const host = event
        .composedPath()
        .find(
          (n): n is HTMLElement =>
            n instanceof HTMLElement && n.tagName.toLowerCase() === "s-button",
        );
      if (!host) return;
      if (host.hasAttribute("href")) return; // link button
      const type = host.getAttribute("type");
      if (type && type !== "submit") return; // reset / plain button
      if (host.hasAttribute("disabled") || host.hasAttribute("loading")) return;
      const form = host.closest("form");
      if (!form || typeof form.requestSubmit !== "function") return;
      // s-button without type still defaults to "submit" inside a form, matching
      // native <button> semantics — so an untyped s-button in a form submits it.

      event.preventDefault();
      busy = true;
      const mirrors = mirrorPolarisFields(form);
      try {
        form.requestSubmit();
      } finally {
        // React Router reads FormData synchronously in its submit handler.
        setTimeout(() => {
          mirrors.forEach((m) => m.remove());
          busy = false;
        }, 0);
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
