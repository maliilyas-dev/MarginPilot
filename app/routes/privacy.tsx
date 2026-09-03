import { PublicPage } from "../components/PublicPage";

export const meta = () => [{ title: "MarginPilot — Privacy Policy" }];

export default function Privacy() {
  return (
    <PublicPage title="Privacy Policy">
      <p className="mp-muted">
        Last updated: [DATE] · Operated by [LEGAL ENTITY NAME], [ADDRESS]. This template should be reviewed by legal
        counsel and the bracketed values replaced before public launch.
      </p>

      <h2>1. Data we process</h2>
      <h3>From Shopify (Admin API), with your authorization</h3>
      <ul>
        <li>Shop profile: domain, plan metadata, primary location, currency, time zone.</li>
        <li>Locations.</li>
        <li>Products and variants: title, vendor, product type, status, SKU, barcode, price, compare-at price.</li>
        <li>Inventory item ID, tracked state, unit cost (when authorized), and quantities at selected locations.</li>
      </ul>
      <p>
        We request only these scopes: <code>read_products</code>, <code>write_products</code>,{" "}
        <code>read_inventory</code>, <code>write_inventory</code>, <code>read_locations</code>.
      </p>
      <h3>From you</h3>
      <ul>
        <li>Supplier configuration (name, code, feed URL, schedule, locale settings).</li>
        <li>Supplier feed files you upload or that we retrieve from a URL you provide, and the parsed rows.</li>
        <li>Optional HTTP Basic credentials for a feed URL, stored encrypted (AES-256-GCM).</li>
        <li>Pricing rules, safety settings and approval decisions.</li>
      </ul>
      <h3>We do not process</h3>
      <p>Customer personal data, order data, payment data, or storefront visitor data. The app adds no storefront code.</p>

      <h2>2. How we use data</h2>
      <p>
        To mirror your catalog so supplier rows can be matched; to calculate landed cost, recommended price and margin;
        to detect anomalies and present a preview; to apply the changes you approve; to keep an audit trail; and to
        operate, secure and improve the app. We do not sell data or use it for advertising.
      </p>

      <h2>3. Sub-processors</h2>
      <ul>
        <li>Railway — application hosting, PostgreSQL database, Redis queue.</li>
        <li>[Error monitoring, e.g. Sentry] — diagnostics with no feed contents or secrets (optional).</li>
        <li>[Email provider] — transactional alert email (Release 1.1+).</li>
      </ul>

      <h2>4. Retention</h2>
      <ul>
        <li>Raw normalized feed rows: 90 days by default, then deleted.</li>
        <li>Uploaded source files: deleted once a run is ready for review.</li>
        <li>Audit summaries and run metadata: retained for accountability.</li>
        <li>On uninstall: schedules cancelled, operational access revoked.</li>
        <li>
          On Shopify <code>shop/redact</code> (~48h after uninstall): suppliers, feeds, mappings, change sets, catalog
          mirror and alerts are deleted and the shop record anonymized.
        </li>
      </ul>

      <h2>5. Security</h2>
      <p>
        TLS in transit; encryption at rest for supplier credentials; strict per-shop isolation on every query; webhook
        HMAC verification (invalid signatures rejected with 401); SSRF protections on URL feeds (private ranges blocked,
        redirect/size limits, timeouts); tokens, credentials and full feed contents are never logged.
      </p>

      <h2>6. GDPR / CCPA</h2>
      <p>
        We act as a data processor for merchant data. Shopify’s mandatory compliance webhooks are implemented:{" "}
        <code>customers/data_request</code> and <code>customers/redact</code> are acknowledged (no customer data is
        stored); <code>shop/redact</code> deletes/anonymizes shop data. To exercise data rights, contact{" "}
        <a href="/support">support</a>.
      </p>

      <h2>7. Changes &amp; contact</h2>
      <p>
        Material changes are posted here with a new date. Contact: [LEGAL ENTITY NAME] ·{" "}
        <a href="mailto:support@marginpilot.app">support@marginpilot.app</a> · [ADDRESS].
      </p>
    </PublicPage>
  );
}
