import { PublicPage } from "../components/PublicPage";

export const meta = () => [{ title: "MarginPilot — Terms of Service" }];

export default function Terms() {
  return (
    <PublicPage title="Terms of Service">
      <p className="mp-muted">
        Last updated: [DATE]. This template should be reviewed by legal counsel and the bracketed values replaced before
        public launch.
      </p>

      <h2>1. Agreement</h2>
      <p>
        These Terms govern use of the MarginPilot Shopify app, operated by [LEGAL ENTITY NAME] (“we”, “us”). By
        installing the app you (“Merchant”) agree to these Terms and to our <a href="/privacy">Privacy Policy</a>.
      </p>

      <h2>2. The service</h2>
      <p>
        The app imports supplier inventory and cost data, matches supplier SKUs to Shopify variants, calculates
        margin-safe prices, detects anomalies, and applies Merchant-approved inventory and price updates to Shopify via
        the Admin API.
      </p>

      <h2>3. Merchant responsibilities</h2>
      <ul>
        <li>You are responsible for the accuracy of supplier feeds and of the rules, thresholds, mappings and approvals you configure.</li>
        <li>You must review each change preview before approving. The app does not change Shopify prices or inventory without your explicit approval.</li>
        <li>You are responsible for compliance with your supplier agreements, tax rules and consumer pricing law in your markets.</li>
      </ul>

      <h2>4. Plans and billing</h2>
      <p>
        Plan tiers and prices are shown in the Shopify App Store listing and in-app. Paid subscriptions are billed
        through Shopify Billing. Beta access, where offered, may be free and may change or end on notice.
      </p>

      <h2>5. Acceptable use</h2>
      <p>Do not submit feeds you are not authorized to use, overload the service, or circumvent plan limits.</p>

      <h2>6. Availability and changes</h2>
      <p>We aim for high availability but do not guarantee uninterrupted service, and may modify or discontinue features with reasonable notice.</p>

      <h2>7. Disclaimers</h2>
      <p>
        THE APP IS PROVIDED “AS IS”. TO THE MAXIMUM EXTENT PERMITTED BY LAW WE DISCLAIM ALL WARRANTIES, EXPRESS OR
        IMPLIED, INCLUDING MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE, AND NON-INFRINGEMENT. Price and inventory
        calculations assist your decisions; you remain responsible for what you approve.
      </p>

      <h2>8. Limitation of liability</h2>
      <p>
        TO THE MAXIMUM EXTENT PERMITTED BY LAW, OUR AGGREGATE LIABILITY ARISING FROM THE APP IS LIMITED TO THE AMOUNTS
        YOU PAID FOR THE APP IN THE 3 MONTHS BEFORE THE CLAIM. WE ARE NOT LIABLE FOR INDIRECT, INCIDENTAL OR
        CONSEQUENTIAL DAMAGES, OR FOR LOST PROFITS OR REVENUE.
      </p>

      <h2>9. Termination</h2>
      <p>
        You may uninstall at any time. On uninstall we cancel schedules and revoke operational access; data is deleted or
        anonymized per the Privacy Policy.
      </p>

      <h2>10. Governing law &amp; contact</h2>
      <p>
        These Terms are governed by the laws of [JURISDICTION]. Contact: [LEGAL ENTITY NAME] ·{" "}
        <a href="mailto:support@marginpilot.app">support@marginpilot.app</a>.
      </p>
    </PublicPage>
  );
}
