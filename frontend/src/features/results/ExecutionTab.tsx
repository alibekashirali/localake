import { useQuery } from "@tanstack/react-query";
import { Gauge } from "lucide-react";
import { EmptyState, Spinner } from "../../components/ui";
import { api } from "../../lib/api";
import { formatBytes, formatCount, formatDuration, formatInteger } from "../../lib/format";
import type { Tab } from "../../store/workspace";
import { PlanGraphView } from "./PlanGraphView";

export function ExecutionTab({ tab }: { tab: Tab }) {
  const { data, isLoading, error } = useQuery({
    queryKey: ["plan", tab.queryId, tab.result?.elapsedMs],
    enabled: Boolean(tab.queryId && tab.status === "completed"),
    queryFn: () => api.plan(tab.queryId!),
    retry: false,
  });

  if (tab.status !== "completed" || !tab.result) {
    return <EmptyState icon={<Gauge size={22} />} title="Run a query to see how it executed" />;
  }

  return (
    <div className="min-h-0 flex-1 overflow-auto p-4">
      <dl className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Execution time" value={formatDuration(tab.result.elapsedMs)} />
        <Stat
          label="Rows scanned"
          value={data?.rowsScanned == null ? "—" : formatCount(data.rowsScanned)}
          hint="Rows read off storage, measured by re-running under profiling"
        />
        <Stat label="Rows returned" value={formatInteger(tab.result.rowCount)} />
        <Stat
          label="Data read"
          value={data?.bytesRead == null ? "—" : formatBytes(data.bytesRead)}
        />
      </dl>

      {data?.operators?.length ? (
        <div className="mt-5">
          <div className="mb-2 text-[12px] font-semibold text-ink-700">Operator tree</div>
          <div className="h-[360px] overflow-hidden rounded-lg border border-line">
            <PlanGraphView operators={data.operators} />
          </div>
        </div>
      ) : null}

      <details className="mt-5">
        <summary className="cursor-pointer text-[12px] font-semibold text-ink-700 select-none">
          Raw query plan
        </summary>
        <div className="mt-2">
          {isLoading ? (
            <Spinner />
          ) : error || !data ? (
            <div className="text-[12.5px] text-ink-500">
              DuckDB could not produce a plan for this statement.
            </div>
          ) : (
            <pre className="overflow-x-auto rounded-lg border border-line bg-slate-50 p-3 font-mono text-[11.5px] leading-[1.35] text-ink-700">
              {data.plan}
            </pre>
          )}
        </div>
      </details>
    </div>
  );
}

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-lg border border-line bg-slate-50/60 px-3.5 py-3" title={hint}>
      <dt className="text-[11px] text-ink-500">{label}</dt>
      <dd className="num mt-0.5 text-[17px] font-semibold text-ink-900">{value}</dd>
    </div>
  );
}
