import clsx from "clsx";
import { useQuery } from "@tanstack/react-query";
import { CircleAlert, CircleCheck, CircleSlash, History } from "lucide-react";
import { useMemo, useState } from "react";
import { Search } from "lucide-react";
import { api } from "../../lib/api";
import { dayBucket, formatDuration, formatInteger, formatRelativeTime } from "../../lib/format";
import { Card, EmptyState, Spinner } from "../../components/ui";
import type { HistoryEntry } from "../../lib/types";
import { useWorkspace } from "../../store/workspace";

const FILTERS = [
  { id: "all", label: "All" },
  { id: "completed", label: "Succeeded" },
  { id: "failed", label: "Failed" },
] as const;

const WINDOWS = [
  { id: "all", label: "Any time" },
  { id: "today", label: "Today" },
  { id: "week", label: "Last 7 days" },
  { id: "month", label: "Last 30 days" },
] as const;

export function HistorySection() {
  const [filter, setFilter] = useState<(typeof FILTERS)[number]["id"]>("all");
  const [window, setWindow] = useState<(typeof WINDOWS)[number]["id"]>("all");
  const [term, setTerm] = useState("");
  const addSqlTab = useWorkspace((state) => state.addSqlTab);

  // Filtering happens server-side so a long history never ships in full.
  const { data, isLoading } = useQuery({
    queryKey: ["history", filter, window, term],
    queryFn: () => api.history({ limit: 300, status: filter, since: window, q: term || undefined }),
  });

  const grouped = useMemo(() => {
    const entries = data?.entries ?? [];
    const buckets = new Map<string, HistoryEntry[]>();
    for (const entry of entries) {
      const key = dayBucket(entry.startedAt);
      const list = buckets.get(key) ?? [];
      list.push(entry);
      buckets.set(key, list);
    }
    return [...buckets.entries()];
  }, [data]);

  return (
    <div className="min-h-0 flex-1 px-3 pb-1">
      <Card className="h-full">
        <div className="flex flex-none items-center justify-between border-b border-line px-4 py-3">
          <span className="text-[15px] font-semibold tracking-[-0.01em] text-ink-900">
            Query history
          </span>
          <div className="flex items-center gap-2">
            <div className="flex h-8 w-56 items-center gap-2 rounded-lg border border-line px-2.5">
              <Search size={14} className="flex-none text-ink-400" />
              <input
                value={term}
                onChange={(event) => setTerm(event.target.value)}
                placeholder="Search name or SQL..."
                className="w-full bg-transparent text-[12.5px] outline-none placeholder:text-ink-400"
              />
            </div>
            <select
              value={window}
              onChange={(event) => setWindow(event.target.value as typeof window)}
              className="h-8 rounded-lg border border-line bg-white px-2 text-[12.5px] text-ink-700"
            >
              {WINDOWS.map((entry) => (
                <option key={entry.id} value={entry.id}>
                  {entry.label}
                </option>
              ))}
            </select>
          <div className="flex items-center gap-1 rounded-lg bg-slate-100 p-0.5">
            {FILTERS.map((entry) => (
              <button
                key={entry.id}
                onClick={() => setFilter(entry.id)}
                className={clsx(
                  "rounded-md px-2.5 py-1 text-[12px] font-medium transition-colors",
                  filter === entry.id
                    ? "bg-white text-ink-900 shadow-sm"
                    : "text-ink-500 hover:text-ink-800",
                )}
              >
                {entry.label}
              </button>
            ))}
            </div>
          </div>
        </div>

        {isLoading ? (
          <div className="flex flex-1 items-center justify-center">
            <Spinner />
          </div>
        ) : grouped.length === 0 ? (
          <EmptyState
            icon={<History size={24} />}
            title={term ? `Nothing matches “${term}”` : "Nothing here yet"}
            hint={
              term ? undefined : "Every query you run is recorded, with its duration and row count."
            }
          />
        ) : (
          <div className="min-h-0 flex-1 overflow-auto px-3 py-2">
            <div className="w-full max-w-4xl">
            {grouped.map(([day, entries]) => (
              <section key={day} className="mb-3">
                <h3 className="px-2 py-1.5 text-[11px] font-semibold tracking-wide text-ink-400 uppercase">
                  {day}
                </h3>
                {entries.map((entry) => (
                  <button
                    key={`${entry.id}-${entry.startedAt}`}
                    onClick={() => addSqlTab(entry.sql, entry.name ?? undefined)}
                    className="group flex w-full items-center gap-3 rounded-lg px-2 py-2 text-left transition-colors hover:bg-brand-50"
                  >
                    <StatusIcon status={entry.status} />
                    <span className="min-w-0 flex-1">
                      <span
                        className={clsx(
                          "block truncate text-[13px] text-ink-800 group-hover:text-brand-700",
                          entry.name ? null : "font-mono text-[11.5px]",
                        )}
                      >
                        {entry.name ?? oneLine(entry.sql)}
                      </span>
                      {entry.error ? (
                        <span className="block truncate text-[11.5px] text-danger">
                          {entry.error}
                        </span>
                      ) : entry.name ? (
                        // Only worth repeating the SQL when the title is a name.
                        <span className="block truncate font-mono text-[11px] text-ink-400">
                          {oneLine(entry.sql)}
                        </span>
                      ) : null}
                    </span>
                    <span className="num flex-none text-right text-[11.5px] text-ink-500">
                      <span className="block">{formatDuration(entry.elapsedMs)}</span>
                      <span className="block text-ink-400">
                        {entry.rowCount == null ? "—" : `${formatInteger(entry.rowCount)} rows`}
                      </span>
                    </span>
                    <span className="w-16 flex-none text-right text-[11px] text-ink-400">
                      {formatRelativeTime(entry.startedAt)}
                    </span>
                  </button>
                ))}
              </section>
            ))}
            </div>
          </div>
        )}
      </Card>
    </div>
  );
}

function StatusIcon({ status }: { status: HistoryEntry["status"] }) {
  if (status === "completed") return <CircleCheck size={15} className="flex-none text-ok" />;
  if (status === "failed") return <CircleAlert size={15} className="flex-none text-danger" />;
  return <CircleSlash size={15} className="flex-none text-ink-400" />;
}

function oneLine(sql: string): string {
  const flat = sql.replace(/\s+/g, " ").trim();
  return flat.length > 110 ? `${flat.slice(0, 109)}…` : flat;
}
