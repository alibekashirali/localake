import clsx from "clsx";
import { useQuery } from "@tanstack/react-query";
import {
  ArrowDown, ArrowUp, FileJson, Search, Sheet, Table2, TriangleAlert,
} from "lucide-react";
import { useMemo, useState } from "react";
import { api } from "../../lib/api";
import { formatBytes, formatCount, formatRelativeTime } from "../../lib/format";
import { Card, EmptyState, Spinner } from "../../components/ui";
import type { DatasetInfo } from "../../lib/types";
import { useWorkspace } from "../../store/workspace";

type SortKey = "name" | "format" | "rows" | "columns" | "size" | "modified";

const COLUMNS: { key: SortKey; label: string; numeric?: boolean }[] = [
  { key: "name", label: "Dataset" },
  { key: "format", label: "Format" },
  { key: "rows", label: "Rows", numeric: true },
  { key: "columns", label: "Columns", numeric: true },
  { key: "size", label: "Size", numeric: true },
  { key: "modified", label: "Modified", numeric: true },
];

/** A flat, sortable catalog of every dataset — the tree's counterpart. */
export function CatalogSection() {
  const [filter, setFilter] = useState("");
  const [sort, setSort] = useState<{ key: SortKey; desc: boolean }>({ key: "size", desc: true });
  const selectDataset = useWorkspace((state) => state.selectDataset);
  const openDatasetTab = useWorkspace((state) => state.openDatasetTab);
  const setSection = useWorkspace((state) => state.setSection);

  const { data, isLoading } = useQuery({
    queryKey: ["datasets", "stats"],
    queryFn: () => api.datasets(true),
  });

  const rows = useMemo(() => {
    const needle = filter.trim().toLowerCase();
    const list = (data?.datasets ?? []).filter(
      (dataset) => !needle || dataset.qualifiedName.toLowerCase().includes(needle),
    );
    const value = (dataset: DatasetInfo): string | number => {
      switch (sort.key) {
        case "name": return dataset.qualifiedName;
        case "format": return dataset.format;
        case "rows": return dataset.stats?.rows ?? -1;
        case "columns": return dataset.stats?.columns ?? -1;
        case "size": return dataset.sizeBytes;
        case "modified": return dataset.modifiedAt;
      }
    };
    return [...list].sort((a, b) => {
      const left = value(a);
      const right = value(b);
      const order = typeof left === "string" ? String(left).localeCompare(String(right))
        : Number(left) - Number(right);
      return sort.desc ? -order : order;
    });
  }, [data, filter, sort]);

  const total = (data?.datasets ?? []).reduce((sum, d) => sum + d.sizeBytes, 0);

  const open = (dataset: DatasetInfo) => {
    selectDataset(dataset.id);
    openDatasetTab(dataset.id, dataset.name);
    setSection("sql");
  };

  return (
    <div className="min-h-0 flex-1 px-3 pb-1">
      <Card className="h-full">
        <div className="flex flex-none items-center justify-between gap-4 border-b border-line px-4 py-3">
          <div>
            <div className="text-[15px] font-semibold tracking-[-0.01em] text-ink-900">
              Data catalog
            </div>
            <div className="num text-[11.5px] text-ink-500">
              {data?.datasets.length ?? 0} datasets · {formatBytes(total)}
            </div>
          </div>
          <div className="flex h-8 w-72 items-center gap-2 rounded-lg border border-line px-2.5">
            <Search size={14} className="flex-none text-ink-400" />
            <input
              value={filter}
              onChange={(event) => setFilter(event.target.value)}
              placeholder="Filter datasets..."
              className="w-full bg-transparent text-[12.5px] outline-none placeholder:text-ink-400"
            />
          </div>
        </div>

        {isLoading ? (
          <div className="flex flex-1 items-center justify-center">
            <Spinner />
          </div>
        ) : rows.length === 0 ? (
          <EmptyState
            icon={<Table2 size={24} />}
            title={filter ? `Nothing matches “${filter}”` : "No datasets in this project"}
            hint={filter ? undefined : "Drop Parquet, CSV or JSON files into the project folder."}
          />
        ) : (
          <div className="min-h-0 flex-1 overflow-auto">
            <table className="w-full border-collapse text-[12.5px]">
              <thead className="sticky top-0 bg-slate-50">
                <tr>
                  {COLUMNS.map((column) => (
                    <th
                      key={column.key}
                      onClick={() =>
                        setSort((current) =>
                          current.key === column.key
                            ? { key: column.key, desc: !current.desc }
                            : { key: column.key, desc: column.key !== "name" },
                        )
                      }
                      className={clsx(
                        "cursor-pointer border-b border-line px-4 py-2 text-[12px] font-semibold",
                        "text-ink-700 select-none hover:bg-slate-100",
                        column.numeric ? "text-right" : "text-left",
                      )}
                    >
                      <span
                        className={clsx(
                          "inline-flex items-center gap-1",
                          column.numeric && "flex-row-reverse",
                        )}
                      >
                        {column.label}
                        {sort.key === column.key ? (
                          sort.desc ? <ArrowDown size={12} className="text-brand-600" />
                            : <ArrowUp size={12} className="text-brand-600" />
                        ) : null}
                      </span>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((dataset) => (
                  <tr
                    key={dataset.id}
                    onClick={() => open(dataset)}
                    className="cursor-default hover:bg-brand-50/50"
                  >
                    <td className="border-b border-line/70 px-4 py-2">
                      <span className="flex items-center gap-2">
                        <FormatIcon format={dataset.format} />
                        <span className="font-medium text-ink-900">{dataset.qualifiedName}</span>
                        {dataset.error ? (
                          <span title={dataset.error} className="flex-none">
                            <TriangleAlert size={13} className="text-warn" />
                          </span>
                        ) : null}
                      </span>
                      <span className="block truncate pl-[22px] text-[11px] text-ink-400">
                        {dataset.path}
                      </span>
                    </td>
                    <td className="border-b border-line/70 px-4 py-2 text-ink-500 uppercase">
                      {dataset.format}
                    </td>
                    <td className="num border-b border-line/70 px-4 py-2 text-right text-ink-700">
                      {dataset.stats?.rows == null ? "—" : formatCount(dataset.stats.rows)}
                    </td>
                    <td className="num border-b border-line/70 px-4 py-2 text-right text-ink-700">
                      {dataset.stats?.columns ?? "—"}
                    </td>
                    <td className="num border-b border-line/70 px-4 py-2 text-right text-ink-700">
                      {formatBytes(dataset.sizeBytes)}
                    </td>
                    <td className="num border-b border-line/70 px-4 py-2 text-right text-ink-500">
                      {formatRelativeTime(dataset.modifiedAt)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}

function FormatIcon({ format }: { format: DatasetInfo["format"] }) {
  const Icon = format === "csv" ? Sheet : format === "json" ? FileJson : Table2;
  return <Icon size={14} className="flex-none text-ink-400" strokeWidth={1.8} />;
}
