/**
 * AES-256-GCM encryption for supplier credentials at rest (spec 12).
 *
 * Key comes only from DATA_ENCRYPTION_KEY (32 bytes, base64 or hex). Ciphertext
 * format: v1.<iv-b64>.<tag-b64>.<ciphertext-b64>
 */
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

const VERSION = "v1";

function loadKey(): Buffer {
  const raw = process.env.DATA_ENCRYPTION_KEY;
  if (!raw) throw new Error("DATA_ENCRYPTION_KEY is not set");
  let key: Buffer;
  if (/^[0-9a-fA-F]{64}$/.test(raw)) {
    key = Buffer.from(raw, "hex");
  } else {
    key = Buffer.from(raw, "base64");
  }
  if (key.length !== 32) {
    throw new Error("DATA_ENCRYPTION_KEY must decode to 32 bytes (256 bits)");
  }
  return key;
}

export function encryptSecret(plaintext: string): string {
  const key = loadKey();
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const enc = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [VERSION, iv.toString("base64"), tag.toString("base64"), enc.toString("base64")].join(".");
}

export function decryptSecret(payload: string): string {
  const key = loadKey();
  const parts = payload.split(".");
  if (parts.length !== 4 || parts[0] !== VERSION) {
    throw new Error("Malformed encrypted payload");
  }
  const [, ivB64, tagB64, dataB64] = parts;
  const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(ivB64, "base64"));
  decipher.setAuthTag(Buffer.from(tagB64, "base64"));
  const dec = Buffer.concat([
    decipher.update(Buffer.from(dataB64, "base64")),
    decipher.final(),
  ]);
  return dec.toString("utf8");
}

export interface SupplierCredentials {
  username?: string;
  password?: string;
}

export function encryptCredentials(creds: SupplierCredentials): string | null {
  if (!creds.username && !creds.password) return null;
  return encryptSecret(JSON.stringify(creds));
}

export function decryptCredentials(payload: string | null): SupplierCredentials {
  if (!payload) return {};
  try {
    return JSON.parse(decryptSecret(payload)) as SupplierCredentials;
  } catch {
    return {};
  }
}
