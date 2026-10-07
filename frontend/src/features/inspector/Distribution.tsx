import { useQuery } from "@tanstack/react-query";
import { api } from "../../lib/api";
import { Spinner } from "../../components/ui";
import { formatCell, formatCount } from "../../lib/format";
import type { CellValue, HistogramBin } from "../../lib/types";

/** Loaded only when a column card is expanded — one scan per column is enough. */
export function Distribution({ datasetId, column }: { datasetId: string; column: string }) {
  const { data, isLoading, error } = useQuery({
    queryKey: ["distribution", datasetId, column],
    queryFn: () => api.distribution(datasetId, column),
    staleTime: 5 * 60_000,
    retry: false,
  });

  if (isLoading) {
    return (
      <div className="flex justify-center py-3">
        <Spinner size={12} />
      </div>
    );
  }
  if (error || !data) {
    return <div className="py-2 text-[11px] text-ink-400">No distribution available</div>;
  }

  return data.kind === "histogram" ? (
    <Histogram bins={data.bins} />
  ) : (
    <TopValues values={data.values} />
  );
}

function Histogram({ bins }: { bins: HistogramBin[] }) {
  const peak = Math.max(1, ...bins.map((bin) => bin.count));
  const first = bins[0];
  const last = bins[bins.length - 1];

  return (
    <div className="pt-1">
      <div className="flex h-16 items-end gap-[3px]">
        {bins.map((bin, index) => (
          <div
            key={index}
            className="group/bar relative flex-1 rounded-t-[2px] bg-brand-200 transition-colors hover:bg-brand-500"
            // A zero bin still shows a hairline, so gaps read as gaps.
            style={{ height: `${Math.max(2, (bin.count / peak) * 100)}%` }}
            title={`${edge(bin.from, bin.temporal)} – ${edge(bin.to, bin.temporal)}: ${formatCount(bin.count)}`}
          />
        ))}
      </div>
      <div className="mt-1 flex justify-between text-[10px] text-ink-400 num">
        <span>{first ? edge(first.from, first.temporal) : ""}</span>
        <span>{last ? edge(last.to, last.temporal) : ""}</span>
      </div>
    </div>
  );
}

function TopValues({ values }: { values: { value: CellValue; count: number }[] }) {
  const peak = Math.max(1, ...values.map((entry) => entry.count));
  return (
    <div className="space-y-1 pt-1">
      {values.map((entry, index) => (
        <div key={index} className="flex items-center gap-2">
          <span
            className={`w-24 flex-none truncate text-[11px] ${
              entry.value === null ? "text-ink-400 italic" : "text-ink-700"
            }`}
            title={String(entry.value)}
          >
            {entry.value === null ? "NULL" : formatCell(entry.value)}
          </span>
          <span className="h-2.5 flex-1 overflow-hidden rounded-sm bg-slate-100">
            <span
              className="block h-full rounded-sm bg-brand-400"
              style={{ width: `${(entry.count / peak) * 100}%` }}
            />
          </span>
          <span className="num w-12 flex-none text-right text-[10.5px] text-ink-500">
            {formatCount(entry.count)}
          </span>
        </div>
      ))}
    </div>
  );
}

/** Histogram edges: seconds since the epoch on temporal columns. */
function edge(value: number, temporal: boolean): string {
  if (!temporal) {
    const abs = Math.abs(value);
    if (abs >= 1000) return formatCount(Math.round(value));
    return String(Math.round(value * 100) / 100);
  }
  return new Date(value * 1000).toISOString().slice(0, 10);
}
