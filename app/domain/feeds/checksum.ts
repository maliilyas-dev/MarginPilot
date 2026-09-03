/** SHA-256 feed checksum for idempotent ingestion (spec 10 / 11). */
import { createHash } from "node:crypto";

export function sha256(buf: Buffer | string): string {
  return createHash("sha256").update(buf).digest("hex");
}

/**
 * Idempotency key for a Shopify write (spec 5.9): shop + change set + change
 * item + operation type + target version.
 */
export function operationKey(parts: {
  shopId: string;
  changeSetId: string;
  changeItemId: string;
  operation: string;
  targetVersion: string | number;
}): string {
  return sha256(
    [parts.shopId, parts.changeSetId, parts.changeItemId, parts.operation, String(parts.targetVersion)].join(
      ":",
    ),
  );
}
