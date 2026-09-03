import { useState } from "react";
import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { useFetcher, useLoaderData } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import { requireShop, requireSupplier } from "../services/shopContext.server";
import { ALL_FIELDS, FIELD_LABELS, REQUIRED_FIELDS, type CanonicalField, type ColumnMappings } from "../domain/feeds/canonicalFields";
import prisma from "../db.server";

export const loader = async ({ request, params }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = await requireShop(session);
  const supplier = await requireSupplier(shop.id, params.supplierId!);

  const [profile, runs, mappingCounts, rules] = await Promise.all([
    prisma.feedMappingProfile.findFirst({ where: { supplierId: supplier.id, isDefault: true } }),
    prisma.feedRun.findMany({ where: { supplierId: supplier.id }, orderBy: { createdAt: "desc" }, take: 10 }),
    prisma.supplierProductMapping.groupBy({
      by: ["status"],
      where: { supplierId: supplier.id },
      _count: { _all: true },
    }),
    prisma.pricingRule.findMany({ where: { OR: [{ supplierId: supplier.id }, { supplierId: null, shopId: shop.id }] }, orderBy: { priority: "asc" } }),
  ]);

  const counts: Record<string, number> = { matched: 0, unmatched: 0, ambiguous: 0, ignored: 0 };
  for (const c of mappingCounts) counts[c.status] = c._count._all;

  return {
    supplier: {
      id: supplier.id,
      name: supplier.name,
      code: supplier.code,
      status: supplier.status,
      feedType: supplier.feedType,
      feedUrl: supplier.feedUrl,
      credentialsConfigured: Boolean(supplier.encryptedCredentials),
      schedule: supplier.schedule,
      delimiter: supplier.delimiter,
      decimalSeparator: supplier.decimalSeparator,
      barcodeMatching: supplier.barcodeMatching,
    },
    mapping: (profile?.columnMappings ?? {}) as ColumnMappings,
    runs: runs.map((r) => ({ id: r.id, status: r.status, trigger: r.trigger, at: r.createdAt.toISOString(), rows: r.rowCount, safe: r.safeChangeCount, blocked: r.blockedCount })),
    counts,
    rules: rules.map((r) => ({ id: r.id, name: r.name, priority: r.priority, scope: r.supplierId ? "supplier" : "shop-wide" })),
  };
};

export default function SupplierDetail() {
  const { supplier, mapping, runs, counts, rules } = useLoaderData<typeof loader>();
  const upload = useFetcher<{ ok: boolean; message?: string; preview?: unknown[]; headers?: string[]; redirectTo?: string; validation?: { ok: boolean; errors: string[] } }>();
  const test = useFetcher<{ ok: boolean; message?: string; firstHeaderLine?: string; status?: number }>();
  const run = useFetcher<{ ok: boolean; redirectTo?: string; message?: string }>();
  const [headers, setHeaders] = useState<string[]>(upload.data?.headers ?? []);

  if (upload.data?.redirectTo && typeof window !== "undefined") {
    window.location.assign(upload.data.redirectTo);
  }
  if (run.data?.redirectTo && typeof window !== "undefined") {
    window.location.assign(run.data.redirectTo);
  }

  return (
    <s-page heading={supplier.name}>
      <s-button slot="primary-action" href={`/app/suppliers/${supplier.id}/edit`}>
        Edit supplier
      </s-button>

      <s-section heading="Overview">
        <s-stack direction="block" gap="small-300">
          <s-text>Code: {supplier.code}</s-text>
          <s-text>Source: {supplier.feedType === "url_csv" ? "Scheduled URL CSV" : "Manual CSV upload"}</s-text>
          <s-text>Schedule: {supplier.schedule.replace(/_/g, " ")}</s-text>
          <s-stack direction="inline" gap="base">
            <s-badge tone="info">Matched {counts.matched}</s-badge>
            <s-badge tone="warning">Unmatched {counts.unmatched}</s-badge>
            <s-badge tone="critical">Ambiguous {counts.ambiguous}</s-badge>
            <s-badge tone="neutral">Ignored {counts.ignored}</s-badge>
          </s-stack>
          <s-link href="/app/mappings">Open mapping workspace</s-link>
        </s-stack>
      </s-section>

      {supplier.feedType === "url_csv" && (
        <s-section heading="Connection">
          <s-stack direction="block" gap="small-300">
            <s-text>Feed URL: {supplier.feedUrl}</s-text>
            <s-text>Credentials: {supplier.credentialsConfigured ? "configured" : "not configured"}</s-text>
            <test.Form method="post" action={`/app/actions/suppliers/${supplier.id}/test`}>
              <s-button type="submit" {...(test.state !== "idle" ? { loading: true } : {})}>
                Test connection
              </s-button>
            </test.Form>
            {test.data && (
              <s-banner tone={test.data.ok ? "success" : "critical"}>
                {test.data.ok
                  ? `OK (HTTP ${test.data.status}). First line: ${test.data.firstHeaderLine}`
                  : test.data.message}
              </s-banner>
            )}
            <run.Form method="post" action={`/app/actions/suppliers/${supplier.id}/run`}>
              <s-button type="submit" variant="primary" {...(run.state !== "idle" ? { loading: true } : {})}>
                Run now
              </s-button>
            </run.Form>
            {run.data && !run.data.ok && <s-banner tone="critical">{run.data.message}</s-banner>}
          </s-stack>
        </s-section>
      )}

      <s-section heading="Upload feed & map columns">
        <upload.Form
          method="post"
          action={`/app/actions/suppliers/${supplier.id}/upload`}
          encType="multipart/form-data"
        >
          <s-stack direction="block" gap="base">
            <input type="file" name="file" accept=".csv,text/csv" required
              onChange={() => setHeaders([])} />
            <s-text>
              Map each canonical field to a column name from your CSV. Required:{" "}
              {REQUIRED_FIELDS.map((f) => FIELD_LABELS[f]).join(", ")}.
            </s-text>
            {(headers.length ? headers : Object.values(mapping)).length === 0 && (
              <s-text>Tip: leave mapping blank to reuse this supplier&rsquo;s saved profile.</s-text>
            )}
            <s-stack direction="block" gap="small-300">
              {ALL_FIELDS.map((field) => (
                <s-text-field
                  key={field}
                  label={`${FIELD_LABELS[field as CanonicalField]}${REQUIRED_FIELDS.includes(field as never) ? " *" : ""}`}
                  name={`mapping[${field}]`}
                  defaultValue={(mapping as Record<string, string>)[field] ?? ""}
                  placeholder="CSV column header"
                />
              ))}
            </s-stack>
            <s-checkbox name="runAfter" value="on" label="Process this feed now after upload" />
            <s-button type="submit" variant="primary" {...(upload.state !== "idle" ? { loading: true } : {})}>
              Upload
            </s-button>
          </s-stack>
        </upload.Form>
        {upload.data && !upload.data.ok && (
          <s-banner tone="critical">
            {upload.data.message}
            {upload.data.validation && !upload.data.validation.ok && (
              <s-unordered-list>
                {upload.data.validation.errors.map((e) => (
                  <s-list-item key={e}>{e}</s-list-item>
                ))}
              </s-unordered-list>
            )}
          </s-banner>
        )}
        {upload.data?.ok && upload.data.preview && (
          <s-banner tone="success">
            Parsed {upload.data.preview.length} preview rows. {upload.data.validation?.ok ? "Mapping looks valid." : "Fix mapping issues above."}
          </s-banner>
        )}
      </s-section>

      <s-section heading="Rules">
        <s-stack direction="block" gap="small-300">
          {rules.length === 0 ? (
            <s-text>No pricing rule applies yet. <s-link href="/app/rules">Create one</s-link>.</s-text>
          ) : (
            rules.map((r) => (
              <s-text key={r.id}>
                #{r.priority} {r.name} ({r.scope})
              </s-text>
            ))
          )}
        </s-stack>
      </s-section>

      <s-section heading="Run history">
        {runs.length === 0 ? (
          <s-paragraph>No runs yet.</s-paragraph>
        ) : (
          <s-table>
            <s-table-header-row>
              <s-table-header>When</s-table-header>
              <s-table-header>Trigger</s-table-header>
              <s-table-header>Status</s-table-header>
              <s-table-header>Rows</s-table-header>
              <s-table-header>Safe</s-table-header>
              <s-table-header>Blocked</s-table-header>
              <s-table-header></s-table-header>
            </s-table-header-row>
            <s-table-body>
              {runs.map((r) => (
                <s-table-row key={r.id}>
                  <s-table-cell>{new Date(r.at).toLocaleString()}</s-table-cell>
                  <s-table-cell>{r.trigger.replace(/_/g, " ")}</s-table-cell>
                  <s-table-cell>{r.status.replace(/_/g, " ")}</s-table-cell>
                  <s-table-cell>{r.rows}</s-table-cell>
                  <s-table-cell>{r.safe}</s-table-cell>
                  <s-table-cell>{r.blocked}</s-table-cell>
                  <s-table-cell>
                    <s-link href={`/app/runs/${r.id}`}>Open</s-link>
                  </s-table-cell>
                </s-table-row>
              ))}
            </s-table-body>
          </s-table>
        )}
      </s-section>
    </s-page>
  );
}

export const headers: HeadersFunction = (h) => boundary.headers(h);
