import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import ReactECharts from "echarts-for-react/lib/core";
import { BarChart3, Pencil, Trash2, TriangleAlert } from "lucide-react";
import { api, ApiError } from "../../lib/api";
import echarts from "../../lib/echarts";
import { buildChartOption } from "../../lib/chart";
import { formatRelativeTime } from "../../lib/format";
import { Card, EmptyState, IconButton, Spinner } from "../../components/ui";
import type { SavedChart } from "../../lib/types";
import { useWorkspace } from "../../store/workspace";

export function ChartsSection() {
  const { data, isLoading } = useQuery({ queryKey: ["charts"], queryFn: api.charts });
  const charts = data?.charts ?? [];

  return (
    <div className="min-h-0 flex-1 px-3 pb-1">
      <Card className="h-full">
        <div className="flex flex-none items-center justify-between border-b border-line px-4 py-3">
          <span className="text-[15px] font-semibold tracking-[-0.01em] text-ink-900">Charts</span>
          <span className="text-[12px] text-ink-500">
            {charts.length === 0 ? "" : `${charts.length} saved`}
          </span>
        </div>

        {isLoading ? (
          <div className="flex flex-1 items-center justify-center">
            <Spinner />
          </div>
        ) : charts.length === 0 ? (
          <EmptyState
            icon={<BarChart3 size={24} />}
            title="No saved charts yet"
            hint="Run a query, open the Chart tab beneath the editor, pick your axes, then press Save chart."
          />
        ) : (
          <div className="min-h-0 flex-1 overflow-auto p-4">
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-2 2xl:grid-cols-3">
              {charts.map((chart) => (
                <ChartCard key={chart.id} chart={chart} />
              ))}
            </div>
          </div>
        )}
      </Card>
    </div>
  );
}

function ChartCard({ chart }: { chart: SavedChart }) {
  const queryClient = useQueryClient();
  const addSqlTab = useWorkspace((state) => state.addSqlTab);

  // Re-runs the saved SQL, so a chart always reflects the data as it is now.
  const { data, isLoading, error } = useQuery({
    queryKey: ["chart-data", chart.id, chart.updatedAt],
    queryFn: () => api.chartData(chart.id),
    retry: false,
  });

  const remove = useMutation({
    mutationFn: () => api.deleteChart(chart.id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["charts"] }),
  });

  const option = data
    ? buildChartOption({
        type: chart.type,
        columns: data.columns,
        rows: data.rows,
        x: chart.x,
        y: chart.y,
      })
    : null;

  return (
    <div className="rounded-xl border border-line bg-white p-3.5">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="truncate text-[13.5px] font-semibold text-ink-900">{chart.name}</div>
          <div className="truncate text-[11px] text-ink-500">
            {chart.y.join(", ")} by {chart.x} · {formatRelativeTime(chart.updatedAt)}
          </div>
        </div>
        <div className="flex flex-none items-center gap-0.5">
          <IconButton label="Open query" onClick={() => addSqlTab(chart.sql, chart.name)}>
            <Pencil size={14} />
          </IconButton>
          <IconButton
            label="Delete chart"
            onClick={() => {
              if (window.confirm(`Delete the chart “${chart.name}”?`)) remove.mutate();
            }}
          >
            <Trash2 size={14} />
          </IconButton>
        </div>
      </div>

      <div className="mt-2 h-[190px]">
        {isLoading ? (
          <div className="flex h-full items-center justify-center">
            <Spinner />
          </div>
        ) : error ? (
          <div className="flex h-full flex-col items-center justify-center gap-1.5 px-3 text-center">
            <TriangleAlert size={18} className="text-warn" />
            <div className="text-[12px] font-medium text-ink-700">This chart no longer runs</div>
            <div className="text-[11px] leading-relaxed text-ink-500">
              {error instanceof ApiError ? error.message : String(error)}
            </div>
          </div>
        ) : option ? (
          <ReactECharts
            echarts={echarts}
            option={option}
            style={{ height: "100%", width: "100%" }}
            notMerge
            lazyUpdate
          />
        ) : (
          <div className="flex h-full items-center justify-center text-[12px] text-ink-400">
            The saved columns are not in this result any more
          </div>
        )}
      </div>
    </div>
  );
}
