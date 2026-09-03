import { PublicPage } from "../components/PublicPage";

export const meta = () => [{ title: "MarginPilot — Support" }];

export default function Support() {
  return (
    <PublicPage title="Support">
      <p className="lede">Real help from the people who build MarginPilot.</p>

      <div className="mp-card">
        <h3 style={{ marginTop: 0 }}>Contact</h3>
        <p style={{ margin: "4px 0" }}>
          Email <a href="mailto:support@marginpilot.app">support@marginpilot.app</a> — we aim to reply within one
          business day.
        </p>
        <p className="mp-muted" style={{ margin: "4px 0", fontSize: 14 }}>
          Please include your <code>.myshopify.com</code> domain, the supplier name and the feed run ID (shown on the Runs
          page), and what you expected versus what happened. Never send access tokens or passwords.
        </p>
      </div>

      <h2>Common questions</h2>

      <h3>Does MarginPilot change my prices automatically?</h3>
      <p>
        No. Every change requires you to open a preview and approve it. Importing a feed never writes to Shopify on its
        own.
      </p>

      <h3>Why is a row “blocked”?</h3>
      <p>
        A safety policy caught something: zero or negative cost, a price move larger than your limit, margin below your
        floor, an abnormal inventory jump, or an unmatched SKU. Fix the supplier data, adjust the policy in Settings, or
        override that specific row — overrides are recorded in the audit trail.
      </p>

      <h3>Why didn’t a row match?</h3>
      <p>
        SKUs are matched exactly, case-insensitive and trimmed. When several Shopify variants share one SKU the row is
        “ambiguous” and needs a manual pick on the Mappings page. MarginPilot never matches on product title.
      </p>

      <h3>How is the recommended price calculated?</h3>
      <p>
        Landed cost (supplier cost plus freight, handling, duty % and other %) drives two candidates — a minimum-margin
        price and a markup price — and the higher one wins, then rounding and min/max clamps apply. The exact rule set is
        snapshotted into every run.
      </p>

      <h3>What data does MarginPilot store?</h3>
      <p>
        Product, variant, price, cost and inventory data needed to compute changes; your supplier feed rows; and an audit
        log. No customer or order personal data. See the <a href="/privacy">Privacy Policy</a>.
      </p>

      <h3>What happens when I uninstall?</h3>
      <p>
        Schedules stop immediately and access is revoked. Retained data is deleted or irreversibly anonymised in line
        with the <a href="/privacy">Privacy Policy</a> and Shopify’s timing requirements.
      </p>
    </PublicPage>
  );
}
