import dagre from "@dagrejs/dagre";
import type { Edge, Node } from "@xyflow/react";
import type { LineageGraph, LineageNode } from "../../lib/types";

export const NODE_WIDTH = 186;
export const NODE_HEIGHT = 46;

/** Left-to-right layered layout, which is how data lineage reads. */
export function layoutGraph(graph: LineageGraph): { nodes: Node[]; edges: Edge[] } {
  const g = new dagre.graphlib.Graph();
  g.setDefaultEdgeLabel(() => ({}));
  g.setGraph({ rankdir: "LR", nodesep: 22, ranksep: 78, marginx: 24, marginy: 24 });

  for (const node of graph.nodes) g.setNode(node.id, { width: NODE_WIDTH, height: NODE_HEIGHT });
  for (const edge of graph.edges) g.setEdge(edge.source, edge.target);
  dagre.layout(g);

  const nodes: Node[] = graph.nodes.map((node) => {
    const placed = g.node(node.id);
    return {
      id: node.id,
      type: "lineage",
      // dagre positions from the centre; React Flow wants the top-left corner.
      position: { x: (placed?.x ?? 0) - NODE_WIDTH / 2, y: (placed?.y ?? 0) - NODE_HEIGHT / 2 },
      // Declared up front so the minimap can draw before nodes are measured.
      width: NODE_WIDTH,
      height: NODE_HEIGHT,
      data: node as unknown as Record<string, unknown>,
      draggable: true,
    };
  });

  const edges: Edge[] = graph.edges.map((edge) => ({
    id: `${edge.source}->${edge.target}`,
    source: edge.source,
    target: edge.target,
    type: "smoothstep",
    animated: false,
    style: { stroke: "#c3d0fe", strokeWidth: 1.6 },
    markerEnd: { type: "arrowclosed", color: "#c3d0fe", width: 16, height: 16 } as never,
  }));

  return { nodes, edges };
}

export type { LineageNode };
