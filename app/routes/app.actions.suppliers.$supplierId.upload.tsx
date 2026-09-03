import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import { requireShop, requireSupplier, markOnboarding } from "../services/shopContext.server";
import { recordAudit } from "../services/audit.server";
import { enqueueFeedProcess } from "../services/queue.server";
import { parseCsvString } from "../domain/feeds/parseCsv";
import { normalizeRecord } from "../domain/feeds/normalizeFeed";
import { headerFingerprint } from "../domain/mapping/normalize";
import {
  validateColumnMappings,
  ALL_FIELDS,
  type ColumnMappings,
  type CanonicalField,
} from "../domain/feeds/canonicalFields";
import prisma from "../db.server";

function sanitizeFilename(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 200) || "upload.csv";
}

export const action = async ({ request, params }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = await requireShop(session);
  const supplier = await requireSupplier(shop.id, params.supplierId!);

  const form = await request.formData();
  const file = form.get("file");
  if (!(file instanceof File)) {
    return Response.json({ ok: false, message: "Attach a CSV file." }, { status: 400 });
  }
  const maxBytes = Number(process.env.MAX_UPLOAD_BYTES || 10_485_760);
  if (file.size > maxBytes) {
    return Response.json(
      { ok: false, message: `File is larger than the ${Math.round(maxBytes / 1_048_576)} MB limit.` },
      { status: 400 },
    );
  }
  const bytes = Buffer.from(await file.arrayBuffer());

  // Build column mappings from posted fields: mapping[<field>] = <header>
  const mappings: ColumnMappings = {};
  for (const field of ALL_FIELDS) {
    const v = form.get(`mapping[${field}]`);
    if (typeof v === "string" && v.trim() !== "") mappings[field as CanonicalField] = v.trim();
  }

  // Parse headers + a 20-row preview only (never the whole file here).
  const previewText = bytes.toString("utf8");
  const { headers, records } = await parseCsvString(previewText.slice(0, 200_000), {
    delimiter: (supplier.delimiter as "auto") ?? "auto",
    maxRows: 20,
    maxBytes: 250_000,
  }).catch(() => ({ headers: [] as string[], records: [] as Record<string, string>[] }));

  const fingerprint = headerFingerprint(headers);

  // If no mapping supplied, fall back to the saved default profile.
  let effectiveMappings = mappings;
  if (Object.keys(mappings).length === 0) {
    const profile = await prisma.feedMappingProfile.findFirst({
      where: { supplierId: supplier.id, isDefault: true },
    });
    if (profile) effectiveMappings = profile.columnMappings as ColumnMappings;
  }

  const validation = validateColumnMappings(effectiveMappings, headers);
  const preview = records.map((r, i) =>
    normalizeRecord(r, i + 1, effectiveMappings, {
      decimalSeparator: supplier.decimalSeparator === "comma" ? "comma" : "dot",
      thousandsSeparator: supplier.thousandsSeparator,
    }),
  );

  // Persist / update the mapping profile when a valid mapping was provided.
  if (Object.keys(mappings).length > 0 && validation.ok) {
    await prisma.feedMappingProfile.upsert({
      where: { id: (await profileId(supplier.id, fingerprint)) ?? "___none___" },
      create: {
        supplierId: supplier.id,
        name: `Profile ${new Date().toISOString().slice(0, 10)}`,
        headerFingerprint: fingerprint,
        columnMappings: mappings as object,
        isDefault: true,
      },
      update: { columnMappings: mappings as object, isDefault: true },
    });
    await prisma.feedMappingProfile.updateMany({
      where: { supplierId: supplier.id, headerFingerprint: { not: fingerprint } },
      data: { isDefault: false },
    });
    await markOnboarding(shop.id, { columnsMapped: true });
  }

  const runAfter = form.get("runAfter") === "on";
  if (!runAfter) {
    return Response.json({ ok: true, headers, preview, validation, fingerprint });
  }
  if (!validation.ok) {
    return Response.json({ ok: false, message: "Fix the column mapping before running.", validation }, { status: 400 });
  }

  const run = await prisma.feedRun.create({
    data: {
      shopId: shop.id,
      supplierId: supplier.id,
      trigger: "manual_upload",
      status: "queued",
      sourceFilename: sanitizeFilename(file.name),
      headerFingerprint: fingerprint,
    },
  });
  await prisma.feedUpload.create({
    data: { feedRunId: run.id, filename: sanitizeFilename(file.name), bytes },
  });
  await enqueueFeedProcess({ shopId: shop.id, supplierId: supplier.id, feedRunId: run.id });
  await prisma.supplier.update({ where: { id: supplier.id }, data: { lastRunAt: new Date() } });
  await markOnboarding(shop.id, { feedUploaded: true });
  await recordAudit({
    shopId: shop.id,
    actorType: "merchant",
    actorIdentifier: session.shop,
    action: "feed_uploaded",
    resourceType: "feed_run",
    resourceId: run.id,
    summary: `Uploaded ${file.name} for ${supplier.name}. Processing queued.`,
  });

  return Response.json({ ok: true, feedRunId: run.id, redirectTo: `/app/runs/${run.id}` });
};

async function profileId(supplierId: string, fingerprint: string): Promise<string | null> {
  const p = await prisma.feedMappingProfile.findFirst({ where: { supplierId, headerFingerprint: fingerprint } });
  return p?.id ?? null;
}
