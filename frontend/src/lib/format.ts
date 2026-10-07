const BYTE_UNITS = ["B", "KB", "MB", "GB", "TB"];

export function formatBytes(bytes: number | null | undefined): string {
  if (bytes == null) return "—";
  if (bytes < 1024) return `${bytes} B`;
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < BYTE_UNITS.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value.toFixed(value >= 100 ? 0 : 1)} ${BYTE_UNITS[unit]}`;
}

/** Compact row counts the way the reference UI shows them: 12.4M, 24K, 812. */
export function formatCount(value: number | null | undefined): string {
  if (value == null) return "—";
  if (value < 1000) return String(value);
  if (value < 1_000_000) return `${(value / 1000).toFixed(value < 10_000 ? 1 : 0)}K`;
  if (value < 1_000_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  return `${(value / 1_000_000_000).toFixed(1)}B`;
}

export function formatInteger(value: number): string {
  return value.toLocaleString("en-US");
}

export function formatDuration(ms: number | null | undefined): string {
  if (ms == null) return "—";
  if (ms < 1000) return `${Math.round(ms)}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(ms < 10_000 ? 2 : 1)}s`;
  return `${Math.floor(ms / 60_000)}m ${Math.round((ms % 60_000) / 1000)}s`;
}

export function formatPercent(value: number | null | undefined): string {
  if (value == null) return "—";
  if (value === 0) return "0%";
  if (value < 0.1) return "<0.1%";
  return `${value.toFixed(value < 10 ? 1 : 0)}%`;
}

/** Numbers right-align and get thousands separators; everything else is text. */
export function formatCell(value: unknown, category?: string): string {
  if (value === null || value === undefined) return "NULL";
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "number") {
    if (!Number.isFinite(value)) return "NULL";
    if (Number.isInteger(value)) return value.toLocaleString("en-US");
    return value.toLocaleString("en-US", { maximumFractionDigits: 2, minimumFractionDigits: 2 });
  }
  if (category === "temporal" && typeof value === "string") {
    // ISO timestamps read better without the "T" and trailing zero seconds.
    return value.replace("T", " ").replace(/\.\d+$/, "").replace(/ 00:00:00$/, "");
  }
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

export function formatRelativeTime(seconds: number): string {
  const delta = Date.now() / 1000 - seconds;
  if (delta < 60) return "just now";
  if (delta < 3600) return `${Math.floor(delta / 60)}m ago`;
  if (delta < 86_400) return `${Math.floor(delta / 3600)}h ago`;
  return new Date(seconds * 1000).toLocaleDateString();
}

/** Bucket history entries into Today / Yesterday / older, as the spec's §20 shows. */
export function dayBucket(seconds: number): string {
  const date = new Date(seconds * 1000);
  const today = new Date();
  const startOfToday = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const startOfYesterday = new Date(startOfToday.getTime() - 86_400_000);
  if (date >= startOfToday) return "Today";
  if (date >= startOfYesterday) return "Yesterday";
  return date.toLocaleDateString(undefined, { month: "long", day: "numeric" });
}
