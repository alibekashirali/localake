import clsx from "clsx";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { api, ApiError } from "../../lib/api";
import { Distribution } from "./Distribution";
import { formatBytes, formatCount, formatPercent } from "../../lib/format";
import { EmptyState, Spinner } from "../../components/ui";
import type { ProfileColumn, SchemaColumn } from "../../lib/types";

export function ProfileTab({
  datasetId, columns,
}: { datasetId: string; columns: SchemaColumn[] }) {
  const { data, isLoading, error } = useQuery({
    queryKey: ["profile", datasetId],
    queryFn: () => api.profile(datasetId),
    retry: false,
    // Profiling touches the whole file; keep the answer around while the
    // dataset is being explored.
    staleTime: 5 * 60_000,
  });

  if (isLoading) {
    return (
      <div className="flex flex-1 items-center justify-center py-8">
        <Spinner />
      </div>
    );
  }
  if (error || !data) {
    return <EmptyState title="Could not profile this dataset" hint={error instanceof ApiError ? error.message : String(error ?? "")} />;
  }

  return (
    <div className="min-h-0 flex-1 overflow-auto px-4 py-3.5">
      <dl className="grid grid-cols-3 gap-2.5">
        <Stat label="Rows" value={formatCount(data.stats.rows)} />
        <Stat label="Columns" value={String(data.stats.columns || columns.length)} />
        <Stat label="File size" value={formatBytes(data.stats.sizeBytes)} />
        <Stat label="Null rate" value={formatPercent(data.nullRate)} />
        <Stat
          label="Duplicate rate"
          value={data.duplicateRate == null ? "—" : formatPercent(data.duplicateRate)}
          hint={data.duplicateRate == null ? "Too many rows to check exactly" : undefined}
        />
        <Stat
          label="Most unique"
          value={data.uniqueShare == null ? "—" : formatPercent(Math.min(100, data.uniqueShare))}
        />
      </dl>

      <div className="mt-5 space-y-2.5">
        {data.columns.map((column) => (
          <ColumnCard
            key={column.name}
            column={column}
            rows={data.stats.rows}
            datasetId={datasetId}
          />
        ))}
      </div>
    </div>
  );
}

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-lg border border-line bg-slate-50/60 px-3 py-2.5" title={hint}>
      <dt className="text-[11px] text-ink-500">{label}</dt>
      <dd className="num mt-0.5 text-[16px] font-semibold text-ink-900">{value}</dd>
    </div>
  );
}

function ColumnCard({
  column, rows, datasetId,
}: { column: ProfileColumn; rows: number; datasetId: string }) {
  const [open, setOpen] = useState(false);
  const uniqueShare =
    column.approxUnique != null && rows ? Math.min(100, (column.approxUnique / rows) * 100) : null;

  const facts: [string, string][] = [];
  if (column.category === "number") {
    facts.push(["Min", fmt(column.min)], ["Max", fmt(column.max)]);
    facts.push(["Average", fmt(column.avg)], ["Median", fmt(column.median)]);
  } else {
    facts.push(["Min", fmt(column.min)], ["Max", fmt(column.max)]);
  }
  facts.push(["Unique", uniqueShare == null ? "—" : formatPercent(uniqueShare)]);
  facts.push(["Nulls", formatPercent(column.nullRate)]);

  return (
    <div className="rounded-lg border border-line px-3.5 py-3">
      <button
        onClick={() => setOpen((value) => !value)}
        className="flex w-full items-baseline justify-between gap-2 text-left"
        aria-expanded={open}
      >
        <span className="flex min-w-0 items-center gap-1.5">
          <span className="flex-none text-ink-400">
            {open ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
          </span>
          <span className="truncate text-[13px] font-semibold text-ink-900">{column.name}</span>
        </span>
        <span className="flex-none text-[11px] text-ink-400">{column.type}</span>
      </button>

      <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1">
        {facts.map(([label, value]) => (
          <div key={label} className="flex items-baseline justify-between gap-2">
            <dt className="text-[11.5px] text-ink-500">{label}</dt>
            <dd
              className={clsx(
                "num truncate text-[11.5px] font-medium",
                label === "Nulls" && (column.nullRate ?? 0) > 5 ? "text-warn" : "text-ink-800",
              )}
              title={value}
            >
              {value}
            </dd>
          </div>
        ))}
      </dl>

      {open ? (
        <div className="mt-2.5 border-t border-line pt-2">
          <Distribution datasetId={datasetId} column={column.name} />
        </div>
      ) : null}
    </div>
  );
}

function fmt(value: unknown): string {
  if (value === null || value === undefined) return "—";
  if (typeof value === "number") {
    return Number.isInteger(value)
      ? value.toLocaleString("en-US")
      : value.toLocaleString("en-US", { maximumFractionDigits: 2 });
  }
  const text = String(value);
  return text.length > 22 ? `${text.slice(0, 21)}…` : text;
}
