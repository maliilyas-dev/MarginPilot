/**
 * Shared presentational building blocks for the embedded admin UI.
 *
 * Everything here is built from Polaris web components (`s-*`) so the app stays
 * visually native to Shopify admin, works in the App Bridge iframe, and meets
 * Built for Shopify UI expectations. No custom CSS framework.
 */
import { useEffect } from "react";
import type { ComponentProps, ReactNode } from "react";
import { useRevalidator } from "react-router";
import { computeProgress } from "../domain/progress";

type Tone = "auto" | "neutral" | "info" | "success" | "caution" | "warning" | "critical";
type IconName = NonNullable<ComponentProps<"s-icon">["type"]>;

/* -------------------------------------------------------------------------- */
/*  Stat cards                                                                 */
/* -------------------------------------------------------------------------- */

export function StatGrid({ children }: { children: ReactNode }) {
  return (
    <s-grid gap="base" gridTemplateColumns="repeat(auto-fill, minmax(200px, 1fr))">
      {children}
    </s-grid>
  );
}

export function StatCard({
  label,
  value,
  icon,
  tone = "neutral",
  caption,
  href,
}: {
  label: string;
  value: ReactNode;
  icon?: IconName;
  tone?: Tone;
  caption?: ReactNode;
  href?: string;
}) {
  const body = (
    <s-box padding="large-100" borderWidth="base" borderRadius="base" background="base" blockSize="100%">
      <s-stack direction="block" gap="small-200">
        <s-stack direction="inline" gap="small-200" alignItems="center">
          {icon ? <s-icon type={icon} tone={tone === "neutral" ? "auto" : tone} size="small" /> : null}
          <s-text color="subdued">{label}</s-text>
        </s-stack>
        <span style={{ fontSize: "1.65rem", fontWeight: 650, letterSpacing: "-0.01em", lineHeight: 1.15 }}>
          {value}
        </span>
        {caption ? <s-text color="subdued">{caption}</s-text> : null}
      </s-stack>
    </s-box>
  );
  return href ? <s-link href={href}>{body}</s-link> : body;
}

/* -------------------------------------------------------------------------- */
/*  Empty state                                                               */
/* -------------------------------------------------------------------------- */

export function EmptyState({
  icon = "inventory",
  heading,
  children,
  action,
}: {
  icon?: IconName;
  heading: string;
  children?: ReactNode;
  action?: { label: string; href: string };
}) {
  return (
    <s-box padding="large-500" borderRadius="base">
      <s-stack direction="block" gap="base" alignItems="center">
        <s-box padding="base" borderRadius="large" background="subdued">
          <s-icon type={icon} size="base" tone="auto" />
        </s-box>
        <s-heading>{heading}</s-heading>
        {children ? (
          <div style={{ maxWidth: "44ch", textAlign: "center" }}>
            <s-text color="subdued">{children}</s-text>
          </div>
        ) : null}
        {action ? (
          <s-button href={action.href} variant="primary">
            {action.label}
          </s-button>
        ) : null}
      </s-stack>
    </s-box>
  );
}

/* -------------------------------------------------------------------------- */
/*  Status → badge mappings                                                    */
/* -------------------------------------------------------------------------- */

export interface BadgeSpec {
  tone: Tone;
  icon: IconName;
  label: string;
}

const RUN_STATUS: Record<string, BadgeSpec> = {
  queued: { tone: "neutral", icon: "clock", label: "Queued" },
  fetching: { tone: "info", icon: "download", label: "Fetching" },
  parsing: { tone: "info", icon: "file", label: "Parsing" },
  validating: { tone: "info", icon: "shield-pending", label: "Validating" },
  mapping: { tone: "info", icon: "connect", label: "Mapping" },
  calculating: { tone: "info", icon: "calculator", label: "Calculating" },
  ready_for_review: { tone: "caution", icon: "view", label: "Ready for review" },
  applying: { tone: "info", icon: "refresh", label: "Applying" },
  completed: { tone: "success", icon: "check-circle", label: "Completed" },
  partially_completed: { tone: "warning", icon: "alert-triangle", label: "Partially completed" },
  failed: { tone: "critical", icon: "x-circle", label: "Failed" },
  cancelled: { tone: "neutral", icon: "disabled", label: "Cancelled" },
};

const CLASSIFICATION: Record<string, BadgeSpec> = {
  safe: { tone: "success", icon: "check-circle", label: "Safe" },
  warning: { tone: "warning", icon: "alert-triangle", label: "Warning" },
  blocked: { tone: "critical", icon: "lock", label: "Blocked" },
  invalid: { tone: "critical", icon: "x-circle", label: "Invalid" },
  unmatched: { tone: "neutral", icon: "question-circle", label: "Unmatched" },
  unchanged: { tone: "neutral", icon: "minus-circle", label: "Unchanged" },
};

const SEVERITY: Record<string, BadgeSpec> = {
  info: { tone: "info", icon: "info", label: "Info" },
  warning: { tone: "warning", icon: "alert-triangle", label: "Warning" },
  critical: { tone: "critical", icon: "alert-octagon", label: "Critical" },
};

function badge(map: Record<string, BadgeSpec>, key: string, fallbackLabel?: string) {
  const spec = map[key] ?? { tone: "neutral" as Tone, icon: "circle" as IconName, label: fallbackLabel ?? key };
  return (
    <s-badge tone={spec.tone} icon={spec.icon}>
      {spec.label}
    </s-badge>
  );
}

export const runStatusBadge = (s: string) => badge(RUN_STATUS, s, s.replace(/_/g, " "));
export const classificationBadge = (s: string) => badge(CLASSIFICATION, s);
export const severityBadge = (s: string) => badge(SEVERITY, s);

export function supplierStatusBadge(status: string) {
  return status === "active" ? (
    <s-badge tone="success" icon="check-circle">
      Active
    </s-badge>
  ) : (
    <s-badge tone="neutral" icon="disabled">
      Inactive
    </s-badge>
  );
}

/* -------------------------------------------------------------------------- */
/*  Misc                                                                       */
/* -------------------------------------------------------------------------- */

export function TimeAgo({ iso }: { iso: string | null }) {
  if (!iso) return <s-text color="subdued">—</s-text>;
  return <s-text color="subdued">{new Date(iso).toLocaleString()}</s-text>;
}

/** A tinted callout box for tips, safety notes and context. */
export function Callout({
  tone = "info",
  icon = "info",
  title,
  children,
}: {
  tone?: Tone;
  icon?: IconName;
  title?: string;
  children: ReactNode;
}) {
  return (
    <s-box padding="base" borderRadius="base" borderWidth="base" background="subdued">
      <s-stack direction="inline" gap="base" alignItems="start">
        <s-icon type={icon} tone={tone === "neutral" ? "auto" : tone} size="small" />
        <s-stack direction="block" gap="small-300">
          {title ? <s-text type="strong">{title}</s-text> : null}
          <s-text color="subdued">{children}</s-text>
        </s-stack>
      </s-stack>
    </s-box>
  );
}

/** A numbered walkthrough step with a title, body and optional link. */
export function NumberedStep({
  n,
  title,
  children,
  action,
  done,
}: {
  n: number;
  title: string;
  children?: ReactNode;
  action?: { label: string; href: string };
  done?: boolean;
}) {
  return (
    <s-box padding="base" borderRadius="base" borderWidth="base" background="base">
      <s-stack direction="inline" gap="base" alignItems="start">
        <div
          style={{
            flex: "0 0 auto",
            width: 30,
            height: 30,
            borderRadius: 999,
            display: "grid",
            placeItems: "center",
            fontWeight: 650,
            fontSize: 13,
            background: done ? "rgba(0,128,96,.14)" : "rgba(0,0,0,.06)",
          }}
          aria-hidden
        >
          {done ? "✓" : n}
        </div>
        <s-stack direction="block" gap="small-300">
          <s-text type="strong">{title}</s-text>
          {children ? <s-text color="subdued">{children}</s-text> : null}
          {action ? (
            <div>
              <s-link href={action.href}>{action.label}</s-link>
            </div>
          ) : null}
        </s-stack>
      </s-stack>
    </s-box>
  );
}

/** Section-level "N of M complete" progress bar. */
export function ProgressMeter({ done, total }: { done: number; total: number }) {
  const pct = total === 0 ? 0 : Math.round((done / total) * 100);
  return (
    <s-stack direction="block" gap="small-300">
      <s-stack direction="inline" gap="small-200" alignItems="center">
        <s-badge tone={done === total ? "success" : "info"}>
          {done} of {total}
        </s-badge>
        <s-text color="subdued">{pct}% complete</s-text>
      </s-stack>
      <div style={{ height: 6, borderRadius: 999, background: "rgba(0,0,0,.08)", overflow: "hidden" }}>
        <div
          style={{
            width: `${pct}%`,
            height: "100%",
            borderRadius: 999,
            background: "currentColor",
            opacity: 0.85,
            transition: "width .3s ease",
          }}
        />
      </div>
    </s-stack>
  );
}

/* -------------------------------------------------------------------------- */
/*  Live job progress (catalog sync / feed run / change apply)                 */
/* -------------------------------------------------------------------------- */

/** Revalidate the current route on an interval while `active` is true. */
export function useLiveRefresh(active: boolean, intervalMs = 2500) {
  const revalidator = useRevalidator();
  useEffect(() => {
    if (!active) return;
    const id = setInterval(() => {
      if (revalidator.state === "idle") revalidator.revalidate();
    }, intervalMs);
    return () => clearInterval(id);
  }, [active, intervalMs, revalidator]);
}

export interface JobProgressProps {
  phase: string | null;
  done: number;
  total: number;
  startedAt: string | null;
  finishedAt?: string | null;
  active: boolean;
  /** overrides the phase line, e.g. a failure summary */
  note?: string | null;
  tone?: Tone;
}

/**
 * Animated progress bar with phase, "N of M", elapsed and ETA — the
 * Matrixify-style readout. Renders nothing useful when there's no work.
 */
export function JobProgress({
  phase,
  done,
  total,
  startedAt,
  finishedAt = null,
  active,
  note = null,
  tone = "info",
}: JobProgressProps) {
  const p = computeProgress({ phase, done, total, startedAt, finishedAt, active });
  const barColor =
    tone === "critical"
      ? "var(--s-color-bg-fill-critical, #d72c0d)"
      : tone === "success"
        ? "var(--s-color-bg-fill-success, #008060)"
        : "var(--s-color-bg-fill-brand, #303030)";

  return (
    <s-stack direction="block" gap="small-300">
      <s-stack direction="inline" gap="small-200" alignItems="center">
        {active ? <s-spinner size="base" /> : null}
        <s-text type="strong">{note ?? p.phase ?? (active ? "Working…" : "Done")}</s-text>
        {p.total > 0 ? <s-badge tone={active ? "info" : "success"}>{p.countLabel}</s-badge> : null}
      </s-stack>

      <div
        style={{
          height: 8,
          borderRadius: 999,
          background: "rgba(0,0,0,.08)",
          overflow: "hidden",
          position: "relative",
        }}
        role="progressbar"
        aria-valuenow={p.percent}
        aria-valuemin={0}
        aria-valuemax={100}
      >
        <div
          style={{
            width: `${p.total > 0 ? p.percent : active ? 40 : 100}%`,
            height: "100%",
            borderRadius: 999,
            background: barColor,
            transition: "width .4s cubic-bezier(.4,0,.2,1)",
            ...(active && p.total === 0
              ? { animation: "mp-indeterminate 1.4s ease-in-out infinite" }
              : {}),
          }}
        />
      </div>

      <s-stack direction="inline" gap="base" alignItems="center">
        <s-text color="subdued">{p.percent}%</s-text>
        <s-text color="subdued">·</s-text>
        <s-text color="subdued">{p.elapsedLabel} elapsed</s-text>
        {p.etaLabel ? (
          <>
            <s-text color="subdued">·</s-text>
            <s-text color="subdued">{p.etaLabel}</s-text>
          </>
        ) : null}
      </s-stack>

      <style
        dangerouslySetInnerHTML={{
          __html:
            "@keyframes mp-indeterminate{0%{transform:translateX(-60%)}100%{transform:translateX(220%)}}",
        }}
      />
    </s-stack>
  );
}
