import { useQuery } from "@tanstack/react-query";
import { Maximize2, Share2 } from "lucide-react";
import { api } from "../../lib/api";
import { EmptyState, Spinner } from "../../components/ui";
import { LineageGraphView } from "../lineage/LineageGraphView";
import { useWorkspace } from "../../store/workspace";

/** The neighbourhood around this one dataset, upstream and downstream. */
export function LineageTab({ datasetId, qualifiedName }: { datasetId: string; qualifiedName?: string }) {
  const setSection = useWorkspace((state) => state.setSection);
  const addSqlTab = useWorkspace((state) => state.addSqlTab);

  const { data, isLoading, error } = useQuery({
    queryKey: ["lineage", datasetId],
    queryFn: () => api.datasetLineage(datasetId),
    retry: false,
  });

  if (isLoading) {
    return (
      <div className="flex flex-1 items-center justify-center py-8">
        <Spinner />
      </div>
    );
  }
  if (error || !data || data.nodes.length === 0) {
    return (
      <EmptyState
        icon={<Share2 size={22} />}
        title="Nothing connects to this dataset yet"
        hint="Save a query or a chart that reads it and the graph fills in."
      />
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex flex-none items-center justify-between border-b border-line px-4 py-2">
        <span className="text-[11.5px] text-ink-500">
          {data.nodes.length} nodes · {data.edges.length} edges
        </span>
        <button
          onClick={() => setSection("lineage")}
          className="inline-flex items-center gap-1.5 text-[12px] font-medium text-brand-600 hover:text-brand-700"
        >
          <Maximize2 size={13} />
          Full graph
        </button>
      </div>
      <div className="min-h-0 flex-1">
        <LineageGraphView
          graph={data}
          compact
          highlight={qualifiedName ? `table:${qualifiedName}` : undefined}
          onSelect={(node) => {
            if (node.kind === "query" && node.sql) addSqlTab(node.sql, node.label);
            else if (node.kind === "chart") setSection("charts");
          }}
        />
      </div>
    </div>
  );
}
