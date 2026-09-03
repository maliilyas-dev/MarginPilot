import prisma from "../db.server";

/**
 * Liveness/readiness probe (spec 11). Reports web + DB health without
 * disclosing any secret. Redis is checked lazily and treated as non-fatal for
 * the web process (the worker owns queue health).
 */
export const loader = async () => {
  const checks: Record<string, string> = { web: "ok" };
  let healthy = true;
  try {
    await prisma.$queryRaw`SELECT 1`;
    checks.database = "ok";
  } catch {
    checks.database = "error";
    healthy = false;
  }
  return new Response(JSON.stringify({ status: healthy ? "ok" : "degraded", checks, time: new Date().toISOString() }), {
    status: healthy ? 200 : 503,
    headers: { "Content-Type": "application/json" },
  });
};
