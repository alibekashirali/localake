import type { ResultColumn, Row } from "./types";

export type ChartType = "line" | "bar" | "area" | "scatter";

export const CHART_TYPES: { id: ChartType; label: string }[] = [
  { id: "line", label: "Line chart" },
  { id: "bar", label: "Bar chart" },
  { id: "area", label: "Area chart" },
  { id: "scatter", label: "Scatter plot" },
];

const SERIES_COLORS = ["#3355e8", "#0ea5e9", "#8b5cf6", "#f59e0b", "#10b981", "#ef4444"];

/** A sensible default pairing: first non-numeric column against the first numeric one. */
export function suggestAxes(columns: ResultColumn[]): { x?: string; y?: string } {
  const numeric = columns.filter((column) => column.category === "number");
  const label = columns.find(
    (column) => column.category === "temporal" || column.category === "string",
  );
  return { x: (label ?? columns[0])?.name, y: numeric[0]?.name };
}

function compactAxisLabel(value: number): string {
  const abs = Math.abs(value);
  // Keep a decimal on half-steps: rounding 2500 and 2000 both to "2K" puts two
  // identical labels on adjacent ticks.
  const scaled = (divisor: number, unit: string) => {
    const scaledValue = value / divisor;
    const decimals = Number.isInteger(scaledValue) ? 0 : 1;
    return `${scaledValue.toFixed(decimals)}${unit}`;
  };
  if (abs >= 1_000_000_000) return scaled(1_000_000_000, "B");
  if (abs >= 1_000_000) return scaled(1_000_000, "M");
  if (abs >= 1000) return scaled(1000, "K");
  return String(Math.round(value * 100) / 100);
}

/** Long ISO timestamps compress to a readable tick: 2024-03-01 → Mar. */
function axisTick(value: unknown): string {
  const text = String(value ?? "");
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(text);
  if (!match) return text.length > 16 ? `${text.slice(0, 15)}…` : text;
  const month = Number(match[2]) - 1;
  const names = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return names[month] ?? text;
}

export function buildChartOption({
  type, columns, rows, x, y, compact = false,
}: {
  type: ChartType;
  columns: ResultColumn[];
  rows: Row[];
  x: string;
  y: string[];
  compact?: boolean;
}) {
  const xIndex = columns.findIndex((column) => column.name === x);
  const yIndices = y
    .map((name) => ({ name, index: columns.findIndex((column) => column.name === name) }))
    .filter((entry) => entry.index >= 0);
  if (xIndex < 0 || yIndices.length === 0) return null;

  const categories = rows.map((row) => String(row[xIndex] ?? ""));
  const isScatter = type === "scatter";

  return {
    animation: false,
    color: SERIES_COLORS,
    grid: {
      left: compact ? 42 : 56,
      right: compact ? 12 : 20,
      top: compact ? 12 : 24,
      bottom: compact ? 24 : 34,
    },
    tooltip: {
      trigger: isScatter ? "item" : "axis",
      backgroundColor: "#ffffff",
      borderColor: "#e5e9f2",
      textStyle: { color: "#0f172a", fontSize: 12 },
      extraCssText: "box-shadow: 0 10px 30px rgb(15 23 42 / 0.12); border-radius: 8px;",
    },
    legend:
      yIndices.length > 1 && !compact
        ? { top: 0, right: 0, icon: "circle", itemHeight: 8, textStyle: { fontSize: 11 } }
        : undefined,
    xAxis: {
      type: "category",
      data: categories,
      boundaryGap: type === "bar",
      axisLine: { lineStyle: { color: "#e5e9f2" } },
      axisTick: { show: false },
      axisLabel: {
        color: "#94a3b8",
        fontSize: compact ? 10 : 11,
        hideOverlap: true,
        formatter: axisTick,
      },
    },
    yAxis: {
      type: "value",
      splitLine: { lineStyle: { color: "#f1f5f9" } },
      axisLabel: {
        color: "#94a3b8",
        fontSize: compact ? 10 : 11,
        formatter: compactAxisLabel,
      },
    },
    series: yIndices.map(({ name, index }) => ({
      name,
      type: isScatter ? "scatter" : type === "bar" ? "bar" : "line",
      smooth: false,
      symbol: type === "line" || type === "area" ? "circle" : undefined,
      symbolSize: isScatter ? 7 : 4,
      barMaxWidth: 28,
      lineStyle: { width: 2 },
      areaStyle:
        type === "area"
          ? { opacity: 0.14 }
          : type === "line"
            ? { opacity: 0.07 }
            : undefined,
      data: rows.map((row) => {
        const value = row[index];
        return typeof value === "number" ? value : Number(value ?? 0) || 0;
      }),
    })),
  };
}
