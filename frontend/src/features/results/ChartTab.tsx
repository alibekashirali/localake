import ReactECharts from "echarts-for-react/lib/core";
import echarts from "../../lib/echarts";
import { BarChart3, Save } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Button, EmptyState } from "../../components/ui";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../../lib/api";
import { buildChartOption, CHART_TYPES, suggestAxes, type ChartType } from "../../lib/chart";
import type { Row } from "../../lib/types";
import type { Tab } from "../../store/workspace";

export function ChartTab({ tab, rows }: { tab: Tab; rows: Row[] }) {
  const columns = tab.result?.columns ?? [];
  const [type, setType] = useState<ChartType>("line");
  const [x, setX] = useState<string>("");
  const [y, setY] = useState<string[]>([]);

  // Re-seed the axes whenever the result's shape changes.
  const signature = columns.map((column) => column.name).join("|");
  useEffect(() => {
    const suggested = suggestAxes(columns);
    setX(suggested.x ?? "");
    setY(suggested.y ? [suggested.y] : []);
  }, [signature]); // eslint-disable-line react-hooks/exhaustive-deps

  const option = useMemo(
    () => (x && y.length ? buildChartOption({ type, columns, rows, x, y }) : null),
    [type, columns, rows, x, y],
  );

  const queryClient = useQueryClient();
  const save = useMutation({
    mutationFn: api.saveChart,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["charts"] }),
  });

  const saveChart = () => {
    // The chart stores the SQL, not the rows, so the gallery stays live.
    const name = window.prompt("Save chart as", suggestName(y[0] ?? "chart"));
    if (!name?.trim() || !x || y.length === 0) return;
    save.mutate({ name: name.trim(), sql: tab.sql, type, x, y });
  };

  if (columns.length === 0) {
    return (
      <EmptyState
        icon={<BarChart3 size={22} />}
        title="Nothing to chart yet"
        hint="Run a query that returns rows, then pick the axes here."
      />
    );
  }

  const numericColumns = columns.filter((column) => column.category === "number");

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex flex-none flex-wrap items-end gap-4 border-b border-line px-4 py-3">
        <Field label="Type">
          <Select value={type} onChange={(value) => setType(value as ChartType)}>
            {CHART_TYPES.map((entry) => (
              <option key={entry.id} value={entry.id}>
                {entry.label}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="X">
          <Select value={x} onChange={setX}>
            {columns.map((column) => (
              <option key={column.name} value={column.name}>
                {column.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Y">
          <Select value={y[0] ?? ""} onChange={(value) => setY(value ? [value] : [])}>
            <option value="">None</option>
            {numericColumns.map((column) => (
              <option key={column.name} value={column.name}>
                {column.name}
              </option>
            ))}
          </Select>
        </Field>
        {y.length > 0 && numericColumns.length > 1 ? (
          <Field label="Compare">
            <Select
              value={y[1] ?? ""}
              onChange={(value) => setY(value ? [y[0]!, value] : [y[0]!])}
            >
              <option value="">None</option>
              {numericColumns
                .filter((column) => column.name !== y[0])
                .map((column) => (
                  <option key={column.name} value={column.name}>
                    {column.name}
                  </option>
                ))}
            </Select>
          </Field>
        ) : null}
        <Button
          icon={<Save size={14} />}
          onClick={saveChart}
          loading={save.isPending}
          disabled={!option || !tab.sql.trim()}
          className="ml-auto"
          title={tab.sql.trim() ? "Save to the Charts section" : "Run a query first"}
        >
          Save chart
        </Button>
      </div>

      <div className="min-h-0 flex-1 p-3">
        {option ? (
          <ReactECharts
            echarts={echarts}
            option={option}
            style={{ height: "100%", width: "100%" }}
            notMerge
            lazyUpdate
          />
        ) : (
          <EmptyState title="Pick a numeric Y column to draw the chart" />
        )}
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-[11px] font-medium text-ink-500">{label}</span>
      {children}
    </label>
  );
}

function Select({
  value, onChange, children,
}: { value: string; onChange: (value: string) => void; children: React.ReactNode }) {
  return (
    <select
      value={value}
      onChange={(event) => onChange(event.target.value)}
      className="h-8 min-w-[132px] rounded-lg border border-line bg-white px-2 text-[12.5px] text-ink-800 transition-colors hover:border-line-strong"
    >
      {children}
    </select>
  );
}

function suggestName(column: string): string {
  return column.replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase());
}
