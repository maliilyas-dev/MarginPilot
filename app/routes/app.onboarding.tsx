import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import { requireShop, DEFAULT_ONBOARDING } from "../services/shopContext.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = await requireShop(session);
  const state = { ...DEFAULT_ONBOARDING, ...(shop.onboardingState as object) } as Record<string, boolean>;
  return { state };
};

const STEPS = [
  { key: "selectedLocation", label: "Select default inventory location", href: "/app/settings" },
  { key: "catalogImported", label: "Import your Shopify catalog", href: "/app/settings" },
  { key: "supplierAdded", label: "Add your first supplier", href: "/app/suppliers/new" },
  { key: "feedUploaded", label: "Upload your first feed", href: "/app/suppliers" },
  { key: "columnsMapped", label: "Map the feed columns", href: "/app/suppliers" },
  { key: "changeSetReviewed", label: "Review your first change set", href: "/app/runs" },
];

export default function Onboarding() {
  const { state } = useLoaderData<typeof loader>();
  return (
    <s-page heading="Get started with MarginPilot">
      <s-section heading="Setup checklist">
        <s-stack direction="block" gap="base">
          {STEPS.map((s) => (
            <s-stack key={s.key} direction="inline" gap="base">
              <s-badge tone={state[s.key] ? "success" : "neutral"}>{state[s.key] ? "Done" : "To do"}</s-badge>
              <s-link href={s.href}>{s.label}</s-link>
            </s-stack>
          ))}
        </s-stack>
      </s-section>
      <s-section slot="aside" heading="How MarginPilot keeps you safe">
        <s-unordered-list>
          <s-list-item>No Shopify price or inventory changes happen without your explicit approval.</s-list-item>
          <s-list-item>Malformed costs, quantities and large price swings are blocked, not applied.</s-list-item>
          <s-list-item>Every applied change is recorded in an audit trail.</s-list-item>
        </s-unordered-list>
      </s-section>
    </s-page>
  );
}

export const headers: HeadersFunction = (h) => boundary.headers(h);
