/**
 * Shared presentational building blocks for the embedded admin UI.
 *
 * Everything here is built from Polaris web components (`s-*`) so the app stays
 * visually native to Shopify admin, works in the App Bridge iframe, and meets
 * Built for Shopify UI expectations. No custom CSS framework.
 */
import type { ComponentProps, ReactNode } from "react";

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
