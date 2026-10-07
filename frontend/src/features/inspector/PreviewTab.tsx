import { useQuery } from "@tanstack/react-query";
import { api, ApiError } from "../../lib/api";
import { EmptyState, Spinner } from "../../components/ui";
import type { ColumnCategory } from "../../lib/types";
import { DataGrid } from "../results/DataGrid";

const PREVIEW_ROWS = 100;

/** First N rows only — the backend never scans past the LIMIT. */
export function PreviewTab({ datasetId }: { datasetId: string }) {
  const { data, isLoading, error } = useQuery({
    queryKey: ["preview", datasetId],
    queryFn: () => api.preview(datasetId, PREVIEW_ROWS),
    retry: false,
  });

  if (isLoading) {
    return (
      <div className="flex flex-1 items-center justify-center py-8">
        <Spinner />
      </div>
    );
  }
  if (error || !data) {
    return <EmptyState title="Could not read this dataset" hint={error instanceof ApiError ? error.message : String(error ?? "")} />;
  }

  const columns = data.columns.map((column) => ({
    name: column.name,
    type: column.type,
    category: column.category as ColumnCategory,
  }));

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <DataGrid columns={columns} rows={data.rows} />
      <div className="flex-none border-t border-line px-4 py-2 text-[11.5px] text-ink-500">
        First {data.rows.length} rows
      </div>
    </div>
  );
}
