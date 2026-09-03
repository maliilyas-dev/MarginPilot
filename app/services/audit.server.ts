/** Immutable audit trail (spec 5.10 / 12). Never write secrets into payloads. */
import { createHash } from "node:crypto";
import prisma from "../db.server";

export interface AuditInput {
  shopId: string;
  actorType: "merchant" | "system" | "webhook";
  actorIdentifier?: string | null;
  action: string;
  resourceType: string;
  resourceId?: string | null;
  summary: string;
  beforeData?: unknown;
  afterData?: unknown;
  ip?: string | null;
}

const SECRET_KEYS = /token|secret|password|credential|authorization|cookie/i;

function scrub(value: unknown): unknown {
  if (value === null || value === undefined) return value;
  if (Array.isArray(value)) return value.map(scrub);
  if (typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = SECRET_KEYS.test(k) ? "[redacted]" : scrub(v);
    }
    return out;
  }
  return value;
}

export function hashIp(ip: string | null | undefined): string | null {
  if (!ip) return null;
  const salt = process.env.SESSION_SECRET || "marginpilot";
  return createHash("sha256").update(`${salt}:${ip}`).digest("hex").slice(0, 32);
}

export async function recordAudit(input: AuditInput) {
  return prisma.auditEvent.create({
    data: {
      shopId: input.shopId,
      actorType: input.actorType,
      actorIdentifier: input.actorIdentifier ?? null,
      action: input.action,
      resourceType: input.resourceType,
      resourceId: input.resourceId ?? null,
      summary: input.summary,
      beforeData: input.beforeData === undefined ? undefined : (scrub(input.beforeData) as object),
      afterData: input.afterData === undefined ? undefined : (scrub(input.afterData) as object),
      ipHash: hashIp(input.ip),
    },
  });
}
