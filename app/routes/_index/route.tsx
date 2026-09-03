import type { LoaderFunctionArgs } from "react-router";
import { redirect, Form, useLoaderData } from "react-router";

import { login } from "../../shopify.server";
import { PublicPage } from "../../components/PublicPage";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const url = new URL(request.url);
  if (url.searchParams.get("shop")) {
    throw redirect(`/app?${url.searchParams.toString()}`);
  }
  return { showForm: Boolean(login) };
};

const FEATURES: Array<{ t: string; d: string }> = [
  { t: "Import any supplier CSV", d: "Manual upload or a scheduled URL feed. Save the column mapping once per supplier." },
  { t: "Match SKUs safely", d: "Exact SKU and optional barcode matching. Ambiguous rows wait for you — never a title guess." },
  { t: "True landed cost", d: "Freight, duty, handling and other percentages folded in with decimal-precise maths." },
  { t: "Margin-safe pricing", d: "Minimum-margin floor, markup, rounding rules and price clamps — versioned per run." },
  { t: "Preview before write", d: "Every run is a change set grouped into safe / warning / blocked. Nothing touches Shopify until you approve." },
  { t: "Full audit trail", d: "Before value, requested value and Shopify's response stored for every applied change." },
];

export default function Index() {
  const { showForm } = useLoaderData<typeof loader>();
  return (
    <PublicPage>
      <h1>Sync supplier stock and costs without risking your margins.</h1>
      <p className="lede">
        MarginPilot imports supplier inventory and costs, matches them to your Shopify variants, calculates safe selling
        prices, blocks dangerous feed values, and lets you approve every change before it reaches your store.
      </p>

      {showForm && (
        <div className="mp-card">
          <Form method="post" action="/auth/login">
            <label htmlFor="shop" style={{ display: "block", fontWeight: 600, marginBottom: 6 }}>
              Install on your store
            </label>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <input
                id="shop"
                type="text"
                name="shop"
                placeholder="my-store.myshopify.com"
                style={{
                  flex: "1 1 260px",
                  padding: "10px 12px",
                  border: "1px solid #c9cccf",
                  borderRadius: 10,
                  fontSize: 15,
                }}
              />
              <button className="mp-cta" style={{ marginTop: 0 }} type="submit">
                Log in
              </button>
            </div>
          </Form>
        </div>
      )}

      <h2 id="features">What it does</h2>
      <div className="mp-grid">
        {FEATURES.map((f) => (
          <div className="mp-card" key={f.t} style={{ margin: 0 }}>
            <h3 style={{ margin: "0 0 6px" }}>{f.t}</h3>
            <p className="mp-muted" style={{ margin: 0, fontSize: 14.5 }}>
              {f.d}
            </p>
          </div>
        ))}
      </div>

      <h2>The dangerous action, made the safe one</h2>
      <p>
        Bulk-editing prices and inventory from a supplier feed is where stores lose money — a stray <code>0</code>, a{" "}
        <code>9999</code>, a SKU that doesn&apos;t line up. MarginPilot makes that step the most reviewable, auditable and
        recoverable part of your workflow instead of the riskiest.
      </p>

      <h2>Pricing</h2>
      <p className="mp-muted">
        Free tier for evaluation. Paid plans (Starter, Growth, Pro) are billed through Shopify. See the listing for
        current pricing.
      </p>
    </PublicPage>
  );
}
