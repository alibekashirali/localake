import dagre from "@dagrejs/dagre";
import {
  Background, Controls, Handle, MiniMap, Position, ReactFlow, ReactFlowProvider,
  type NodeProps,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { useMemo } from "react";
import { formatCount } from "../../lib/format";
import type { PlanOperator } from "../../lib/types";

const NODE_WIDTH = 200;
const NODE_HEIGHT = 46;

/** `TABLE_SCAN` → `Table Scan`, `HASH_GROUP_BY` → `Hash Group By`. */
function prettyOperator(name: string): string {
  return name
    .split("_")
    .filter(Boolean)
    .map((word) => word[0]!.toUpperCase() + word.slice(1).toLowerCase())
    .join(" ");
}

function PlanNodeCard({ data }: NodeProps) {
  const node = data as unknown as PlanOperator & { label: string };
  return (
    <div
      style={{ width: NODE_WIDTH, minHeight: NODE_HEIGHT }}
      className={
        "flex items-center gap-2 rounded-lg border bg-white px-3 shadow-[var(--shadow-card)] " +
        (node.scan ? "border-brand-300" : "border-line")
      }
      title={node.detail ?? node.name}
    >
      <Handle type="target" position={Position.Top} className="!h-1.5 !w-1.5 !border-0 !bg-brand-300" />
      <div className="min-w-0 flex-1 leading-tight">
        <div className="truncate text-[12px] font-medium text-ink-900">{node.label}</div>
        {node.detail ? (
          <div className="truncate text-[10.5px] text-ink-400">{node.detail}</div>
        ) : null}
      </div>
      {node.rows != null ? (
        <span className="num flex-none text-[11px] text-ink-500">{formatCount(node.rows)}</span>
      ) : null}
      <Handle
        type="source"
        position={Position.Bottom}
        className="!h-1.5 !w-1.5 !border-0 !bg-brand-300"
      />
    </div>
  );
}

const NODE_TYPES = { plan: PlanNodeCard };

/**
 * The backend flattens DuckDB's operator tree into a depth-annotated list.
 * Rebuild parent→child edges from those depths, then lay the DAG out top-down.
 */
function layoutPlan(operators: PlanOperator[]) {
  const graph = new dagre.graphlib.Graph();
  graph.setDefaultEdgeLabel(() => ({}));
  graph.setGraph({ rankdir: "TB", nodesep: 18, ranksep: 52, marginx: 20, marginy: 20 });

  const nodes = operators.map((operator, index) => ({
    id: `op-${index}`,
    type: "plan",
    data: { ...operator, label: prettyOperator(operator.name) } as unknown as Record<
      string, unknown
    >,
    position: { x: 0, y: 0 },
  }));
  for (const node of nodes) graph.setNode(node.id, { width: NODE_WIDTH, height: NODE_HEIGHT });

  const edges: { id: string; source: string; target: string }[] = [];
  const stack: { depth: number; index: number }[] = [];
  operators.forEach((operator, index) => {
    while (stack.length && stack[stack.length - 1]!.depth >= operator.depth) stack.pop();
    const parent = stack[stack.length - 1];
    if (parent && parent.depth === operator.depth - 1) {
      const source = `op-${parent.index}`;
      const target = `op-${index}`;
      edges.push({ id: `${source}->${target}`, source, target });
      graph.setEdge(source, target);
    }
    stack.push({ depth: operator.depth, index });
  });

  dagre.layout(graph);
  for (const node of nodes) {
    const placed = graph.node(node.id);
    node.position = {
      x: (placed?.x ?? 0) - NODE_WIDTH / 2,
      y: (placed?.y ?? 0) - NODE_HEIGHT / 2,
    };
  }

  const rfEdges = edges.map((edge) => ({
    ...edge,
    type: "smoothstep" as const,
    animated: false,
    style: { stroke: "#c3d0fe", strokeWidth: 1.6 },
    markerEnd: { type: "arrowclosed", color: "#c3d0fe", width: 16, height: 16 } as never,
  }));

  return { nodes, edges: rfEdges };
}

export function PlanGraphView({ operators }: { operators: PlanOperator[] }) {
  const { nodes, edges } = useMemo(() => layoutPlan(operators), [operators]);

  return (
    <ReactFlowProvider>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={NODE_TYPES}
        fitView
        fitViewOptions={{ padding: 0.2 }}
        minZoom={0.25}
        maxZoom={1.5}
        proOptions={{ hideAttribution: true }}
        nodesDraggable
      >
        <Background color="#e5e9f2" gap={18} size={1.5} />
        <Controls
          showInteractive={false}
          className="!overflow-hidden !rounded-lg !border !border-line !bg-white !shadow-[var(--shadow-card)]"
        />
        <MiniMap
          pannable
          zoomable
          nodeColor={(node) =>
            (node.data as unknown as PlanOperator).scan ? "#4a6df0" : "#cbd5e1"
          }
          maskColor="rgb(244 246 251 / 0.75)"
          className="!rounded-lg !border !border-line !bg-white"
        />
      </ReactFlow>
    </ReactFlowProvider>
  );
}
