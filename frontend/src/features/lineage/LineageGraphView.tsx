import clsx from "clsx";
import {
  Background, Controls, Handle, MiniMap, Position, ReactFlow, ReactFlowProvider,
  type NodeProps,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import {
  BarChart3, Eye, FileJson, FileText, Sheet, SquareTerminal, Table2,
} from "lucide-react";
import { useMemo } from "react";
import { formatBytes } from "../../lib/format";
import type { LineageGraph, LineageKind, LineageNode } from "../../lib/types";
import { layoutGraph, NODE_HEIGHT, NODE_WIDTH } from "./layout";

const STYLES: Record<LineageKind, { ring: string; tint: string; icon: typeof Table2 }> = {
  file: { ring: "border-line", tint: "text-ink-400", icon: FileText },
  table: { ring: "border-brand-200", tint: "text-brand-600", icon: Table2 },
  view: { ring: "border-violet-200", tint: "text-violet-500", icon: Eye },
  query: { ring: "border-emerald-200", tint: "text-emerald-600", icon: SquareTerminal },
  chart: { ring: "border-amber-200", tint: "text-amber-600", icon: BarChart3 },
};

const MINIMAP_COLORS: Record<LineageKind, string> = {
  file: "#cbd5e1", table: "#4a6df0", view: "#a78bfa", query: "#34d399", chart: "#fbbf24",
};

function LineageCard({ data }: NodeProps) {
  const node = data as unknown as LineageNode;
  const style = STYLES[node.kind] ?? STYLES.table;
  const Icon =
    node.kind === "file"
      ? node.format === "csv" ? Sheet : node.format === "json" ? FileJson : FileText
      : style.icon;

  const subtitle =
    node.kind === "file"
      ? formatBytes(node.sizeBytes)
      : node.kind === "chart"
        ? (node.chartType ?? "chart")
        : node.kind;

  return (
    <div
      style={{ width: NODE_WIDTH, height: NODE_HEIGHT }}
      className={clsx(
        "flex items-center gap-2.5 rounded-lg border bg-white px-3 shadow-[var(--shadow-card)]",
        style.ring,
        node.error && "border-warn/50",
        (data as { highlighted?: boolean }).highlighted &&
          "!border-brand-600 ring-2 ring-brand-200",
      )}
      title={node.error ?? node.sql ?? node.path ?? node.label}
    >
      <Handle type="target" position={Position.Left} className="!h-1.5 !w-1.5 !border-0 !bg-brand-200" />
      <Icon size={16} className={clsx("flex-none", style.tint)} strokeWidth={1.8} />
      <div className="min-w-0 leading-tight">
        <div className="truncate text-[12.5px] font-medium text-ink-900">{node.label}</div>
        <div className="truncate text-[10.5px] text-ink-400">{subtitle}</div>
      </div>
      <Handle type="source" position={Position.Right} className="!h-1.5 !w-1.5 !border-0 !bg-brand-200" />
    </div>
  );
}

const NODE_TYPES = { lineage: LineageCard };

export const LINEAGE_KINDS: LineageKind[] = ["file", "table", "view", "query", "chart"];
export { MINIMAP_COLORS };

interface Props {
  graph: LineageGraph;
  onSelect?: (node: LineageNode) => void;
  /** The inspector panel is too narrow for a minimap and zoom controls. */
  compact?: boolean;
  highlight?: string;
}

export function LineageGraphView({ graph, onSelect, compact, highlight }: Props) {
  const { nodes, edges } = useMemo(() => {
    const laid = layoutGraph(graph);
    if (!highlight) return laid;
    return {
      ...laid,
      nodes: laid.nodes.map((node) =>
        node.id === highlight
          ? { ...node, data: { ...(node.data as object), highlighted: true } }
          : node,
      ),
    };
  }, [graph, highlight]);

  return (
    <ReactFlowProvider>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={NODE_TYPES}
        fitView
        fitViewOptions={{ padding: compact ? 0.12 : 0.18 }}
        minZoom={0.15}
        maxZoom={1.6}
        proOptions={{ hideAttribution: true }}
        nodesDraggable={!compact}
        onNodeClick={(_, node) => onSelect?.(node.data as unknown as LineageNode)}
      >
        <Background color="#e5e9f2" gap={18} size={1.5} />
        {compact ? null : (
          <>
            <Controls
              showInteractive={false}
              className="!overflow-hidden !rounded-lg !border !border-line !bg-white !shadow-[var(--shadow-card)]"
            />
            <MiniMap
              pannable
              zoomable
              nodeColor={(node) =>
                MINIMAP_COLORS[(node.data as unknown as LineageNode).kind] ?? "#cbd5e1"
              }
              maskColor="rgb(244 246 251 / 0.75)"
              className="!rounded-lg !border !border-line !bg-white"
            />
          </>
        )}
      </ReactFlow>
    </ReactFlowProvider>
  );
}
