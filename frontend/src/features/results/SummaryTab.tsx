import { useQuery } from "@tanstack/react-query";
import { Sigma } from "lucide-react";
import { EmptyState, Spinner } from "../../components/ui";
import { formatCell, formatPercent } from "../../lib/format";
import type { Row } from "../../lib/types";
import type { Tab } from "../../store/workspace";

interface SummaryResponse {
  columns: { name: string }[];
  rows: Row[];
}

const SHOWN = ["min", "max", "avg", "q50", "approx_unique", "null_percentage"] as const;
const HEADINGS: Record<string, string> = {
  min: "Min",
  max: "Max",
  avg: "Average",
  q50: "Median",
  approx_unique: "Unique",
  null_percentage: "Nulls",
};

/** DuckDB's SUMMARIZE over the materialised result — exact, not sampled. */
export function SummaryTab({ tab }: { tab: Tab; rows: Row[] }) {
  const { data, isLoading, error } = useQuery({
    queryKey: ["summary", tab.queryId, tab.result?.rowCount],
    enabled: Boolean(tab.queryId && tab.result && tab.result.columns.length > 0),
    queryFn: async (): Promise<SummaryResponse> => {
      const response = await fetch(`/api/query/${tab.queryId}/summary`);
      if (!response.ok) throw new Error((await response.json()).detail ?? "Summary unavailable");
      return response.json();
    },
  });

  if (!tab.result || tab.result.columns.length === 0) {
    return <EmptyState icon={<Sigma size={22} />} title="Run a query to see column statistics" />;
  }
  if (isLoading) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <Spinner />
      </div>
    );
  }
  if (error || !data) {
    return <EmptyState title="Statistics are not available for this result" />;
  }

  const index = Object.fromEntries(data.columns.map((column, i) => [column.name, i]));

  return (
    <div className="min-h-0 flex-1 overflow-auto">
      <table className="w-full border-collapse text-[12.5px]">
        <thead className="sticky top-0 bg-slate-50">
          <tr className="text-left text-[12px] font-semibold text-ink-700">
            <th className="border-b border-line px-4 py-2">Column</th>
            <th className="border-b border-line px-4 py-2">Type</th>
            {SHOWN.map((key) => (
              <th key={key} className="border-b border-line px-4 py-2 text-right">
                {HEADINGS[key]}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {data.rows.map((row, rowIndex) => (
            <tr key={rowIndex} className="hover:bg-brand-50/40">
              <td className="border-b border-line/70 px-4 py-2 font-medium whitespace-nowrap text-ink-900">
                {String(row[index.column_name!] ?? "")}
              </td>
              <td className="border-b border-line/70 px-4 py-2 whitespace-nowrap text-ink-500">
                {String(row[index.column_type!] ?? "")}
              </td>
              {SHOWN.map((key) => {
                const value = row[index[key]!];
                const text =
                  key === "null_percentage"
                    ? formatPercent(value === null ? null : Number(value))
                    : value === null
                      ? "—"
                      : formatCell(maybeNumber(value));
                return (
                  <td
                    key={key}
                    className="num border-b border-line/70 px-4 py-2 text-right whitespace-nowrap text-ink-700"
                  >
                    {text}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** SUMMARIZE returns its numeric aggregates as strings; show them as numbers. */
function maybeNumber(value: unknown): unknown {
  if (typeof value !== "string") return value;
  const parsed = Number(value);
  return value.trim() !== "" && Number.isFinite(parsed) ? parsed : value;
}
