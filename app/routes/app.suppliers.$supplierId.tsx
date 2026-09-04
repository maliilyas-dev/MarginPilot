import { useEffect, useRef, useState } from "react";
import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { useFetcher, useLoaderData, useNavigate } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import { requireShop, requireSupplier } from "../services/shopContext.server";
import { ALL_FIELDS, FIELD_LABELS, REQUIRED_FIELDS, type CanonicalField, type ColumnMappings } from "../domain/feeds/canonicalFields";
import { Callout, StatCard, StatGrid, runStatusBadge, supplierStatusBadge } from "../components/ui";
import { readFields } from "../components/domForm";
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
  const [, setHeaders] = useState<string[]>(upload.data?.headers ?? []);
  const navigate = useNavigate();
  const uploadRef = useRef<HTMLDivElement>(null);

  const submitUpload = () => {
    const root = uploadRef.current;
    if (!root) return;
    const fileInput = root.querySelector('input[name="file"]') as HTMLInputElement | null;
    const file = fileInput?.files?.[0];
    if (!file) return;
    const fd = new FormData();
    fd.append("file", file);
    const mappingFields: Record<string, "text"> = Object.fromEntries(
      ALL_FIELDS.map((f) => [`mapping[${f}]`, "text" as const]),
    );
    const values = readFields(root, mappingFields);
    for (const [k, v] of Object.entries(values)) {
      if (v) fd.append(k, v);
    }
    const runAfterEl = root.querySelector('[name="runAfter"]') as (HTMLElement & { checked?: boolean }) | null;
    if (runAfterEl?.checked) fd.append("runAfter", "on");
    upload.submit(fd, {
      method: "post",
      action: `/app/actions/suppliers/${supplier.id}/upload`,
      encType: "multipart/form-data",
    });
  };

  useEffect(() => {
    const to = upload.data?.redirectTo ?? run.data?.redirectTo;
    if (to) navigate(to);
  }, [upload.data?.redirectTo, run.data?.redirectTo, navigate]);

  return (
    <s-page heading={supplier.name}>
      <s-button slot="primary-action" href={`/app/suppliers/${supplier.id}/edit`}>
        Edit supplier
      </s-button>

      <s-section heading="Overview">
        <s-stack direction="block" gap="base">
          <s-stack direction="inline" gap="small-200" alignItems="center">
            {supplierStatusBadge(supplier.status)}
            <s-badge icon={supplier.feedType === "url_csv" ? "link" : "upload"}>
              {supplier.feedType === "url_csv" ? "Scheduled URL CSV" : "Manual CSV upload"}
            </s-badge>
            <s-badge icon="clock">{supplier.schedule.replace(/_/g, " ")}</s-badge>
            <s-text color="subdued">Code {supplier.code}</s-text>
          </s-stack>
          <StatGrid>
            <StatCard label="Matched" value={counts.matched} icon="check-circle" tone="success" href={`/app/mappings?supplierId=${supplier.id}&status=matched`} />
            <StatCard label="Unmatched" value={counts.unmatched} icon="question-circle" tone={counts.unmatched > 0 ? "caution" : "neutral"} href={`/app/mappings?supplierId=${supplier.id}&status=unmatched`} />
            <StatCard label="Ambiguous" value={counts.ambiguous} icon="alert-triangle" tone={counts.ambiguous > 0 ? "warning" : "neutral"} href={`/app/mappings?supplierId=${supplier.id}&status=ambiguous`} />
            <StatCard label="Ignored" value={counts.ignored} icon="minus-circle" tone="neutral" href={`/app/mappings?supplierId=${supplier.id}&status=ignored`} />
          </StatGrid>
          <div>
            <s-link href={`/app/mappings?supplierId=${supplier.id}`}>Open mapping workspace</s-link>
          </div>
        </s-stack>
      </s-section>

      {supplier.feedType === "url_csv" && (
        <s-section heading="Connection">
          <s-stack direction="block" gap="small-300">
            <s-text>Feed URL: {supplier.feedUrl}</s-text>
            <s-text>Credentials: {supplier.credentialsConfigured ? "configured" : "not configured"}</s-text>
            <s-button
              type="button"
              onClick={() => test.submit({}, { method: "post", action: `/app/actions/suppliers/${supplier.id}/test` })}
              {...(test.state !== "idle" ? { loading: true } : {})}
            >
              Test connection
            </s-button>
            {test.data && (
              <s-banner tone={test.data.ok ? "success" : "critical"}>
                {test.data.ok
                  ? `OK (HTTP ${test.data.status}). First line: ${test.data.firstHeaderLine}`
                  : test.data.message}
              </s-banner>
            )}
            <s-button
              type="button"
              variant="primary"
              onClick={() => run.submit({}, { method: "post", action: `/app/actions/suppliers/${supplier.id}/run` })}
              {...(run.state !== "idle" ? { loading: true } : {})}
            >
              Run now
            </s-button>
            {run.data && !run.data.ok && <s-banner tone="critical">{run.data.message}</s-banner>}
          </s-stack>
        </s-section>
      )}

      <s-section heading="Upload feed &amp; map columns">
        <Callout tone="info" icon="lightbulb" title="Leave mapping blank to reuse the saved profile">
          Map each canonical field to a CSV column header. Required: {REQUIRED_FIELDS.map((f) => FIELD_LABELS[f]).join(", ")}.
          The mapping is saved per supplier after the first successful upload.
        </Callout>
        <div ref={uploadRef}>
          <s-stack direction="block" gap="base">
            <div>
              <label
                htmlFor="feed-file"
                style={{ display: "block", fontWeight: 600, marginBottom: 4, fontSize: 13 }}
              >
                CSV file
              </label>
              <input
                id="feed-file"
                type="file"
                name="file"
                accept=".csv,text/csv"
                required
                onChange={() => setHeaders([])}
              />
            </div>
            <s-text color="subdued">
              Map each field to a column header from your CSV. Required:{" "}
              {REQUIRED_FIELDS.map((f) => FIELD_LABELS[f]).join(", ")}. Leave every box blank to reuse this
              supplier&rsquo;s saved mapping.
            </s-text>
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
            <s-button
              type="button"
              variant="primary"
              onClick={submitUpload}
              {...(upload.state !== "idle" ? { loading: true } : {})}
            >
              Upload
            </s-button>
          </s-stack>
        </div>
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
          <s-stack direction="block" gap="base">
            <s-banner tone={upload.data.validation?.ok ? "success" : "warning"}>
              Parsed {upload.data.preview.length} preview row(s).{" "}
              {upload.data.validation?.ok
                ? "Mapping looks valid — tick “Process this feed now” and upload again to run it."
                : "Fix the mapping issues above, then upload again."}
            </s-banner>
            {upload.data.preview.length > 0 && (
              <div style={{ overflowX: "auto" }}>
                <s-table>
                  <s-table-header-row>
                    <s-table-header>#</s-table-header>
                    <s-table-header>Supplier SKU</s-table-header>
                    <s-table-header>Qty</s-table-header>
                    <s-table-header>Unit cost</s-table-header>
                    <s-table-header>Name</s-table-header>
                    <s-table-header>Valid?</s-table-header>
                  </s-table-header-row>
                  <s-table-body>
                    {(upload.data.preview as Array<Record<string, unknown>>).slice(0, 20).map((row, i) => (
                      <s-table-row key={i}>
                        <s-table-cell>{i + 1}</s-table-cell>
                        <s-table-cell>{String(row.supplierSkuOriginal ?? "—")}</s-table-cell>
                        <s-table-cell>{row.quantity == null ? "—" : String(row.quantity)}</s-table-cell>
                        <s-table-cell>{row.unitCost == null ? "—" : String(row.unitCost)}</s-table-cell>
                        <s-table-cell>{String(row.supplierName ?? "—")}</s-table-cell>
                        <s-table-cell>
                          <s-badge tone={row.validationStatus === "valid" ? "success" : "critical"}>
                            {String(row.validationStatus ?? "?")}
                          </s-badge>
                        </s-table-cell>
                      </s-table-row>
                    ))}
                  </s-table-body>
                </s-table>
              </div>
            )}
          </s-stack>
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
          <s-paragraph>
            <s-text color="subdued">No runs yet. Upload a feed above to create one.</s-text>
          </s-paragraph>
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
                  <s-table-cell>
                    <s-text color="subdued">{new Date(r.at).toLocaleString()}</s-text>
                  </s-table-cell>
                  <s-table-cell>{r.trigger.replace(/_/g, " ")}</s-table-cell>
                  <s-table-cell>{runStatusBadge(r.status)}</s-table-cell>
                  <s-table-cell>{r.rows}</s-table-cell>
                  <s-table-cell>
                    <s-text tone={r.safe > 0 ? "success" : "auto"}>{r.safe}</s-text>
                  </s-table-cell>
                  <s-table-cell>
                    <s-text tone={r.blocked > 0 ? "critical" : "auto"}>{r.blocked}</s-text>
                  </s-table-cell>
                  <s-table-cell>
                    <s-link href={r.status === "ready_for_review" ? `/app/runs/${r.id}/review` : `/app/runs/${r.id}`}>
                      {r.status === "ready_for_review" ? "Review" : "Open"}
                    </s-link>
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
