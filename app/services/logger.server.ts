/**
 * Structured logger with redaction (spec 12 / 20). Never logs access tokens,
 * cookies, supplier passwords, authorization headers, or full feed contents.
 */
import pino from "pino";

const redactPaths = [
  "accessToken",
  "access_token",
  "password",
  "credentials",
  "encryptedCredentials",
  "authorization",
  "Authorization",
  "cookie",
  "Cookie",
  "req.headers.authorization",
  "req.headers.cookie",
  "*.accessToken",
  "*.password",
  "*.feedUrl",
];

export const logger = pino({
  level: process.env.LOG_LEVEL || "info",
  redact: { paths: redactPaths, censor: "[redacted]" },
  base: { service: "marginpilot" },
  ...(process.env.NODE_ENV !== "production"
    ? { transport: { target: "pino-pretty", options: { colorize: true } } }
    : {}),
});

export function childLogger(bindings: Record<string, unknown>) {
  return logger.child(bindings);
}
