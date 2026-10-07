import ReactECharts from "echarts-for-react/lib/core";
import echarts from "../../lib/echarts";
import { useInfiniteQuery } from "@tanstack/react-query";
import { BarChart3, ChevronDown, Maximize2, MoreVertical, RefreshCw, Save } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { api } from "../../lib/api";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, IconButton } from "../../components/ui";
import { Menu } from "../../components/Menu";
import { buildChartOption, CHART_TYPES, suggestAxes, type ChartType } from "../../lib/chart";
import { useWorkspace } from "../../store/workspace";

const SAMPLE_ROWS = 500;

/** A miniature of the active tab's result, always visible beside the editor. */
export function QuickChart() {
  const tab = useWorkspace((state) => state.tabs.find((t) => t.id === state.activeTabId));
  const setResultsTab = useWorkspace((state) => state.setResultsTab);
  const [type, setType] = useState<ChartType>("line");
  const columns = tab?.result?.columns ?? [];

  const { data } = useInfiniteQuery({
    queryKey: ["rows", tab?.queryId, undefined, undefined],
    enabled: Boolean(tab?.queryId && tab?.result && columns.length > 0),
    initialPageParam: 0,
    queryFn: ({ pageParam }) =>
      api.rows(tab!.queryId!, { offset: pageParam as number, limit: SAMPLE_ROWS }),
    getNextPageParam: () => undefined,
  });

  const rows = useMemo(() => data?.pages.flatMap((page) => page.rows) ?? [], [data]);

  const signature = columns.map((column) => column.name).join("|");
  const [axes, setAxes] = useState<{ x?: string; y?: string }>({});
  useEffect(() => setAxes(suggestAxes(columns)), [signature]); // eslint-disable-line react-hooks/exhaustive-deps

  const option = useMemo(
    () =>
      axes.x && axes.y
        ? buildChartOption({ type, columns, rows, x: axes.x, y: [axes.y], compact: true })
        : null,
    [type, columns, rows, axes],
  );

  const queryClient = useQueryClient();
  const save = useMutation({
    mutationFn: api.saveChart,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["charts"] }),
  });

  const title = option
    ? axes.y!.replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase())
    : null;

  return (
    <Card className="flex-none">
      <div className="flex items-center justify-between gap-2 px-4 pt-3.5 pb-2">
        <span className="text-[15px] font-semibold tracking-[-0.01em] text-ink-900">
          Quick Chart
        </span>
        <div className="flex items-center gap-1.5">
          <div className="relative">
            <select
              value={type}
              onChange={(event) => setType(event.target.value as ChartType)}
              className="h-7 appearance-none rounded-lg border border-line bg-white pr-6 pl-2.5 text-[12px] text-ink-700"
            >
              {CHART_TYPES.map((entry) => (
                <option key={entry.id} value={entry.id}>
                  {entry.label}
                </option>
              ))}
            </select>
            <ChevronDown
              size={13}
              className="pointer-events-none absolute top-2 right-1.5 text-ink-400"
            />
          </div>
          <Menu
            items={[
              {
                label: "Open in Chart tab",
                icon: <BarChart3 size={14} />,
                disabled: !option,
                onSelect: () => setResultsTab("chart"),
              },
              {
                label: "Pick axes again",
                icon: <RefreshCw size={14} />,
                disabled: columns.length === 0,
                onSelect: () => setAxes(suggestAxes(columns)),
              },
              "separator",
              {
                label: "Save chart",
                icon: <Save size={14} />,
                disabled: !option || !tab?.sql.trim(),
                onSelect: () => {
                  const name = window.prompt("Save chart as", title ?? "Chart");
                  if (!name?.trim()) return;
                  save.mutate({
                    name: name.trim(), sql: tab!.sql, type,
                    x: axes.x!, y: [axes.y!],
                  });
                },
              },
            ]}
          >
            {({ toggle }) => (
              <IconButton label="Chart options" onClick={toggle}>
                <MoreVertical size={15} />
              </IconButton>
            )}
          </Menu>
        </div>
      </div>

      {title ? (
        <div className="flex items-center justify-between px-4 pb-1">
          <span className="truncate text-[13px] font-semibold text-ink-800">{title}</span>
          <IconButton label="Open in Chart tab" onClick={() => setResultsTab("chart")}>
            <Maximize2 size={14} />
          </IconButton>
        </div>
      ) : null}

      <div className="h-[150px] px-2 pb-2">
        {option ? (
          <ReactECharts echarts={echarts} option={option} style={{ height: "100%", width: "100%" }} notMerge lazyUpdate />
        ) : (
          <div className="flex h-full items-center justify-center text-[12px] text-ink-400">
            Run a query to chart its result
          </div>
        )}
      </div>
    </Card>
  );
}
