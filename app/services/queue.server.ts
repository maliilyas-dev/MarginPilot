/**
 * BullMQ queue definitions (spec 11). Jobs carry IDs only — never feed files or
 * secrets. The web process enqueues; the worker process consumes.
 */
import { Queue, QueueEvents, type ConnectionOptions } from "bullmq";
import IORedis from "ioredis";

export const QUEUE_NAMES = {
  catalogSync: "catalog-sync",
  feedFetch: "feed-fetch",
  feedProcess: "feed-process",
  changesApply: "changes-apply",
  scheduledRuns: "scheduled-runs",
  cleanup: "cleanup",
} as const;

export type QueueName = (typeof QUEUE_NAMES)[keyof typeof QUEUE_NAMES];

let connection: IORedis | null = null;

export function getRedisConnection(): IORedis {
  if (!connection) {
    const url = process.env.REDIS_URL;
    if (!url) throw new Error("REDIS_URL is not set");
    connection = new IORedis(url, {
      maxRetriesPerRequest: null,
      enableReadyCheck: false,
    });
  }
  return connection;
}

export function connectionOptions(): ConnectionOptions {
  return getRedisConnection();
}

const queues = new Map<QueueName, Queue>();

export function getQueue(name: QueueName): Queue {
  let q = queues.get(name);
  if (!q) {
    q = new Queue(name, {
      connection: connectionOptions(),
      defaultJobOptions: {
        attempts: 5,
        backoff: { type: "exponential", delay: 5_000 },
        removeOnComplete: { age: 60 * 60 * 24, count: 5_000 },
        removeOnFail: { age: 60 * 60 * 24 * 7 },
      },
    });
    queues.set(name, q);
  }
  return q;
}

// ---- Typed job payloads (IDs only) ----
export interface CatalogSyncJob {
  shopId: string;
  shopDomain: string;
  catalogSyncId: string;
}
export interface FeedFetchJob {
  shopId: string;
  supplierId: string;
  feedRunId: string;
}
export interface FeedProcessJob {
  shopId: string;
  supplierId: string;
  feedRunId: string;
  rowCountDropConfirmed?: boolean;
}
export interface ChangesApplyJob {
  shopId: string;
  changeSetId: string;
}
export interface ScheduledRunsTickJob {
  tickAt: string;
}
export interface CleanupJob {
  kind: "raw-feed-rows" | "orphan-jobs";
}

export async function enqueueCatalogSync(data: CatalogSyncJob) {
  return getQueue(QUEUE_NAMES.catalogSync).add("sync", data, {
    jobId: `catalog-sync-${data.catalogSyncId}`,
    // A catalog sync failure is usually a permanent GraphQL/scope issue, not a
    // transient one; don't hammer Shopify with 5 retries.
    attempts: 2,
  });
}
export async function enqueueFeedFetch(data: FeedFetchJob) {
  return getQueue(QUEUE_NAMES.feedFetch).add("fetch", data, {
    jobId: `feed-fetch-${data.feedRunId}`,
  });
}
export async function enqueueFeedProcess(data: FeedProcessJob) {
  return getQueue(QUEUE_NAMES.feedProcess).add("process", data, {
    jobId: `feed-process-${data.feedRunId}`,
  });
}
export async function enqueueChangesApply(data: ChangesApplyJob) {
  return getQueue(QUEUE_NAMES.changesApply).add("apply", data, {
    jobId: `changes-apply-${data.changeSetId}`,
  });
}

export async function makeQueueEvents(name: QueueName) {
  const qe = new QueueEvents(name, { connection: connectionOptions() });
  await qe.waitUntilReady();
  return qe;
}
