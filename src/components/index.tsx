/**
 * Shared display pieces.
 *
 * Presentation only. Anything with modal or overlay behaviour lives in
 * primitives.tsx on top of Radix, so focus management is never re-implemented.
 */
import { useEffect, useState, type ReactNode } from "react";
import { Check, Copy } from "lucide-react";
import { formatAmount } from "../lib/money";
import type { Direction } from "../db/schema";

export * from "./primitives";
export * from "./toast";
export * from "./asset-icon";
export * from "./charts";
export * from "./category-chip";

/* ============================ empty & loading ============================ */

export function EmptyState({
  icon,
  title,
  description,
  action,
}: {
  icon?: ReactNode;
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div className="empty">
      {icon ? <div className="empty__icon">{icon}</div> : null}
      <p className="empty__title">{title}</p>
      {description ? <p className="empty__description">{description}</p> : null}
      {action ? <div className="mt-1">{action}</div> : null}
    </div>
  );
}

/** Placeholder rows that hold the layout steady while data arrives. */
export function Skeleton({ rows = 3, width = "100%" }: { rows?: number; width?: string }) {
  return (
    <div className="stack stack--sm" aria-hidden="true">
      {Array.from({ length: rows }, (_, index) => (
        <div
          key={index}
          className="skeleton"
          // Uneven widths read as content rather than as a loading bar.
          style={{ width: index === rows - 1 ? `calc(${width} * 0.6)` : width }}
        />
      ))}
    </div>
  );
}

export function LoadingRow({ label = "Loading…" }: { label?: string }) {
  return (
    <p className="text-sm muted" role="status">
      {label}
    </p>
  );
}

/* ============================ copy ============================ */

export function CopyButton({
  value,
  label,
  size = "sm",
}: {
  value: string;
  label: string;
  size?: "sm" | "md";
}) {
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 1400);
    return () => clearTimeout(timer);
  }, [copied]);

  return (
    <button
      type="button"
      className={`button button--subtle button--icon${size === "sm" ? " button--sm" : ""}`}
      aria-label={copied ? `${label} copied` : `Copy ${label}`}
      onClick={() => {
        void navigator.clipboard.writeText(value).then(() => setCopied(true));
      }}
    >
      {copied ? <Check size={13} aria-hidden="true" /> : <Copy size={13} aria-hidden="true" />}
    </button>
  );
}

/* ============================ direction & amount ============================ */

const DIRECTION_LABEL: Record<Direction, string> = {
  incoming: "Incoming",
  outgoing: "Outgoing",
  internal: "Transfer",
  neutral: "No effect",
};

export function DirectionTag({ direction }: { direction: Direction }) {
  return <span className={`tag tag--${direction}`}>{DIRECTION_LABEL[direction]}</span>;
}

/**
 * An amount with its asset.
 *
 * The sign and the label carry the meaning; colour only reinforces it, so the
 * ledger stays readable without colour vision.
 */
export function Amount({
  amount,
  assetCode,
  direction,
  size,
}: {
  amount: string;
  assetCode: string;
  direction: Direction;
  size?: "lg";
}) {
  const signed = direction === "incoming" || direction === "outgoing";
  const prefix = direction === "incoming" ? "+" : direction === "outgoing" ? "−" : "";

  return (
    <span className={`numeric amount--${direction}${size === "lg" ? " text-2xl semibold" : ""}`}>
      {signed ? prefix : ""}
      {formatAmount(amount)} <span className="subtle">{assetCode}</span>
      <span className="visually-hidden"> {DIRECTION_LABEL[direction]}</span>
    </span>
  );
}

/* ============================ formatting ============================ */

/** Shortens an address for dense display, keeping both ends recognisable. */
export function shortAddress(address: string | null | undefined, size = 4): string {
  if (!address) return "—";
  if (address.length <= size * 2 + 3) return address;
  return `${address.slice(0, size)}…${address.slice(-size)}`;
}

export function relativeTime(iso: string | null | undefined): string {
  if (!iso) return "never";
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "never";

  const seconds = Math.max(0, Math.round((Date.now() - then) / 1000));
  if (seconds < 45) return "just now";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? "" : "s"} ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"} ago`;
  const days = Math.round(hours / 24);
  return `${days} day${days === 1 ? "" : "s"} ago`;
}

export function formatDate(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "2-digit" });
}

export function formatDateTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}
