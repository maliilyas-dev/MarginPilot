/**
 * MarginPilot worker process (spec 7 / 11). Consumes BullMQ queues:
 *   catalog-sync | feed-fetch | feed-process | changes-apply
 *   scheduled-runs | cleanup
 *
 * Run: `npm run worker`. Deploy as its own process type alongside the web app.
 */
import "dotenv/config";
import { Worker, type Job } from "bullmq";
import prisma from "../app/db.server";
import { logger } from "../app/services/logger.server";
import {
  QUEUE_NAMES,
  connectionOptions,
  getQueue,
  type CatalogSyncJob,
  type FeedFetchJob,
  type FeedProcessJob,
  type ChangesApplyJob,
} from "../app/services/queue.server";
import { requireOfflineToken } from "../app/services/offlineSession.server";
import { runCatalogSync } from "../app/domain/shopify-sync/catalogSync.server";
import { runFeedPipeline } from "../app/domain/feeds/pipeline.server";
import { applyChangeSet } from "../app/domain/changes/apply.server";
import { createAlert } from "../app/services/alerts.server";

const log = logger.child({ process: "worker" });

const CONCURRENCY: Record<string, number> = {
  [QUEUE_NAMES.catalogSync]: 2,
  [QUEUE_NAMES.feedFetch]: 4,
  [QUEUE_NAMES.feedProcess]: 2,
  [QUEUE_NAMES.changesApply]: 3,
  [QUEUE_NAMES.scheduledRuns]: 1,
  [QUEUE_NAMES.cleanup]: 1,
};

const workers: Worker[] = [];

function makeWorker(name: string, processor: (job: Job) => Promise<unknown>) {
  const w = new Worker(name, processor, {
    connection: connectionOptions(),
    concurrency: CONCURRENCY[name] ?? 1,
  });
  w.on("failed", (job, err) => log.error({ queue: name, jobId: job?.id, err: err.message }, "job failed"));
  w.on("completed", (job) => log.info({ queue: name, jobId: job.id }, "job completed"));
  workers.push(w);
  return w;
}

// ---- catalog-sync ----
makeWorker(QUEUE_NAMES.catalogSync, async (job: Job<CatalogSyncJob>) => {
  const { shopId, shopDomain, catalogSyncId } = job.data;
  const token = await requireOfflineToken(shopDomain);
  return runCatalogSync({ shopId, shopDomain, accessToken: token.accessToken, catalogSyncId });
});

// ---- feed-fetch: fetch/validate then hand to feed-process ----
makeWorker(QUEUE_NAMES.feedFetch, async (job: Job<FeedFetchJob>) => {
  const { shopId, supplierId, feedRunId } = job.data;
  await getQueue(QUEUE_NAMES.feedProcess).add(
    "process",
    { shopId, supplierId, feedRunId } satisfies FeedProcessJob,
    { jobId: `feed-process-${feedRunId}` },
  );
});

// ---- feed-process ----
makeWorker(QUEUE_NAMES.feedProcess, async (job: Job<FeedProcessJob>) => {
  return runFeedPipeline({
    feedRunId: job.data.feedRunId,
    rowCountDropConfirmed: job.data.rowCountDropConfirmed,
  });
});

// ---- changes-apply ----
makeWorker(QUEUE_NAMES.changesApply, async (job: Job<ChangesApplyJob>) => {
  const changeSet = await prisma.changeSet.findUnique({
    where: { id: job.data.changeSetId },
    include: { shop: true },
  });
  if (!changeSet) throw new Error(`ChangeSet ${job.data.changeSetId} not found`);
  const token = await requireOfflineToken(changeSet.shop.shopDomain);
  return applyChangeSet({
    changeSetId: changeSet.id,
    shopDomain: changeSet.shop.shopDomain,
    accessToken: token.accessToken,
  });
});

// ---- scheduled-runs: fires every 5 min, enqueues due suppliers ----
makeWorker(QUEUE_NAMES.scheduledRuns, async () => {
  const now = new Date();
  const suppliers = await prisma.supplier.findMany({
    where: { status: "active", feedType: "url_csv", schedule: { not: "manual" } },
    include: { shop: true },
  });
  const intervalMs: Record<string, number> = {
    hourly: 60 * 60 * 1000,
    every_6_hours: 6 * 60 * 60 * 1000,
    daily: 24 * 60 * 60 * 1000,
  };
  for (const s of suppliers) {
    if (s.shop.status !== "active") continue;
    const due = !s.lastRunAt || now.getTime() - s.lastRunAt.getTime() >= (intervalMs[s.schedule] ?? Infinity);
    if (!due) continue;

    // Lock: skip if an active run already exists for this supplier.
    const active = await prisma.feedRun.findFirst({
      where: { supplierId: s.id, status: { in: ["queued", "fetching", "parsing", "validating", "mapping", "calculating", "applying"] } },
    });
    if (active) continue;

    const run = await prisma.feedRun.create({
      data: { shopId: s.shopId, supplierId: s.id, trigger: "scheduled", status: "queued" },
    });
    await prisma.supplier.update({ where: { id: s.id }, data: { lastRunAt: now } });
    await getQueue(QUEUE_NAMES.feedFetch).add(
      "fetch",
      { shopId: s.shopId, supplierId: s.id, feedRunId: run.id } satisfies FeedFetchJob,
      { jobId: `feed-fetch-${run.id}` },
    );
    log.info({ supplierId: s.id, feedRunId: run.id }, "scheduled feed run enqueued");
  }
});

// ---- cleanup: retention for raw feed rows (default 90 days) ----
makeWorker(QUEUE_NAMES.cleanup, async () => {
  const days = Number(process.env.RAW_FEED_RETENTION_DAYS || 90);
  const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  const { count } = await prisma.feedRow.deleteMany({ where: { createdAt: { lt: cutoff } } });
  log.info({ deleted: count, cutoff }, "raw feed row retention cleanup");
  await prisma.webhookEvent.deleteMany({ where: { receivedAt: { lt: cutoff } } });
});

async function bootstrapRepeatables() {
  await getQueue(QUEUE_NAMES.scheduledRuns).upsertJobScheduler(
    "scheduled-runs-tick",
    { every: 5 * 60 * 1000 },
    { name: "tick", data: { tickAt: new Date().toISOString() } },
  );
  await getQueue(QUEUE_NAMES.cleanup).upsertJobScheduler(
    "cleanup-daily",
    { every: 24 * 60 * 60 * 1000 },
    { name: "daily", data: { kind: "raw-feed-rows" } },
  );
}

async function heartbeat() {
  try {
    await prisma.$queryRaw`SELECT 1`;
    log.debug("worker heartbeat ok");
  } catch (err) {
    log.error({ err: (err as Error).message }, "worker heartbeat db failure");
  }
}

async function main() {
  await bootstrapRepeatables();
  const hb = setInterval(heartbeat, 30_000);

  const shutdown = async (signal: string) => {
    log.info({ signal }, "worker shutting down");
    clearInterval(hb);
    await Promise.all(workers.map((w) => w.close()));
    await prisma.$disconnect();
    process.exit(0);
  };
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("unhandledRejection", (reason) => {
    log.error({ reason: String(reason) }, "unhandledRejection in worker");
  });

  log.info({ queues: Object.values(QUEUE_NAMES) }, "worker started");
  void createAlert;
}

void main();
