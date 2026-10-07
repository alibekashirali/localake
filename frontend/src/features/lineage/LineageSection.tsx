import { useQuery } from "@tanstack/react-query";
import { Share2 } from "lucide-react";
import { api } from "../../lib/api";
import { Card, EmptyState, Spinner } from "../../components/ui";
import { useWorkspace } from "../../store/workspace";
import { LINEAGE_KINDS, LineageGraphView, MINIMAP_COLORS } from "./LineageGraphView";

export function LineageSection() {
  const selectDataset = useWorkspace((state) => state.selectDataset);
  const setSection = useWorkspace((state) => state.setSection);
  const addSqlTab = useWorkspace((state) => state.addSqlTab);
  const { data, isLoading } = useQuery({ queryKey: ["lineage"], queryFn: api.lineage });

  return (
    <div className="min-h-0 flex-1 px-3 pb-1">
      <Card className="h-full overflow-hidden">
        <div className="flex flex-none items-center justify-between border-b border-line px-4 py-3">
          <span className="text-[15px] font-semibold tracking-[-0.01em] text-ink-900">Lineage</span>
          <div className="flex items-center gap-3.5">
            {LINEAGE_KINDS.map((kind) => (
              <span key={kind} className="flex items-center gap-1.5 text-[11px] text-ink-500">
                <span className="h-2 w-2 rounded-full" style={{ background: MINIMAP_COLORS[kind] }} />
                {kind}
              </span>
            ))}
          </div>
        </div>

        {isLoading ? (
          <div className="flex flex-1 items-center justify-center">
            <Spinner />
          </div>
        ) : !data || data.nodes.length === 0 ? (
          <EmptyState
            icon={<Share2 size={24} />}
            title="Nothing to trace yet"
            hint="Lineage is derived from your SQL. Save a query or a chart and the graph fills in."
          />
        ) : (
          <div className="min-h-0 flex-1">
            <LineageGraphView
              graph={data}
              onSelect={(node) => {
                // Clicking a node takes you to the thing it represents.
                if (node.kind === "table" && node.datasetId) {
                  selectDataset(node.datasetId);
                  setSection("sql");
                } else if (node.kind === "query" && node.sql) {
                  addSqlTab(node.sql, node.label);
                } else if (node.kind === "chart") {
                  setSection("charts");
                }
              }}
            />
          </div>
        )}
      </Card>
    </div>
  );
}
