import { useQuery } from "@tanstack/react-query";
import { Play, Table2 } from "lucide-react";
import { api, ApiError } from "../../lib/api";
import { formatBytes, formatCount } from "../../lib/format";
import { Button, Card, EmptyState, Spinner } from "../../components/ui";
import type { ColumnCategory } from "../../lib/types";
import { useWorkspace } from "../../store/workspace";
import { DataGrid } from "../results/DataGrid";

/** What a dataset tab shows: the first rows, plus a shortcut into the editor. */
export function DatasetView({ datasetId }: { datasetId: string }) {
  const addSqlTab = useWorkspace((state) => state.addSqlTab);
  const { data: dataset } = useQuery({
    queryKey: ["dataset", datasetId],
    queryFn: () => api.dataset(datasetId),
  });
  const { data: preview, isLoading, error } = useQuery({
    queryKey: ["preview", datasetId],
    queryFn: () => api.preview(datasetId, 200),
  });

  const columns =
    preview?.columns.map((column) => ({
      name: column.name,
      type: column.type,
      category: column.category as ColumnCategory,
    })) ?? [];

  return (
    <Card className="min-h-0 flex-1">
      <div className="flex flex-none items-center justify-between gap-3 border-b border-line px-4 py-3">
        <div className="flex min-w-0 items-center gap-2.5">
          <Table2 size={18} className="flex-none text-brand-600" strokeWidth={1.7} />
          <div className="min-w-0">
            <div className="truncate text-[14px] font-semibold text-ink-900">
              {dataset?.qualifiedName ?? datasetId}
            </div>
            <div className="num truncate text-[11.5px] text-ink-500">
              {dataset?.stats
                ? `${formatCount(dataset.stats.rows)} rows · ${dataset.stats.columns} columns · ${formatBytes(dataset.stats.sizeBytes)}`
                : dataset?.path}
            </div>
          </div>
        </div>
        <Button
          icon={<Play size={14} className="fill-current" />}
          variant="primary"
          onClick={() =>
            addSqlTab(
              `SELECT *\nFROM ${dataset?.qualifiedName ?? datasetId}\nLIMIT 100;`,
              `Query ${dataset?.name ?? ""}`.trim(),
            )
          }
        >
          Query this table
        </Button>
      </div>

      {isLoading ? (
        <div className="flex flex-1 items-center justify-center">
          <Spinner />
        </div>
      ) : error ? (
        <EmptyState
          title="Could not read this dataset"
          hint={error instanceof ApiError ? error.message : String(error)}
        />
      ) : (
        <>
          <DataGrid columns={columns} rows={preview?.rows ?? []} />
          <div className="flex-none border-t border-line px-4 py-2.5 text-[12px] text-ink-500">
            Showing the first {preview?.rows.length ?? 0} rows
          </div>
        </>
      )}
    </Card>
  );
}
