import clsx from "clsx";
import { useQuery } from "@tanstack/react-query";
import {
  Binary, Braces, Calendar, Copy, FileWarning, Hash, KeyRound, MoreHorizontal,
  Play, Search, Table2, ToggleLeft, Type,
} from "lucide-react";
import { useState } from "react";
import { api, ApiError } from "../../lib/api";
import { formatPercent } from "../../lib/format";
import { Badge, Card, EmptyState, IconButton, Spinner, TabBar } from "../../components/ui";
import { Menu } from "../../components/Menu";
import type { ColumnCategory, SchemaColumn } from "../../lib/types";
import { useWorkspace } from "../../store/workspace";
import { ProfileTab } from "./ProfileTab";
import { PreviewTab } from "./PreviewTab";
import { LineageTab } from "./LineageTab";

const TABS = [
  { id: "schema", label: "Schema" },
  { id: "profile", label: "Profile" },
  { id: "preview", label: "Preview" },
  { id: "lineage", label: "Lineage" },
] as const;

export function Inspector() {
  const datasetId = useWorkspace((state) => state.selectedDatasetId);
  const inspectorTab = useWorkspace((state) => state.inspectorTab);
  const setInspectorTab = useWorkspace((state) => state.setInspectorTab);
  const addSqlTab = useWorkspace((state) => state.addSqlTab);

  const { data, isLoading, error } = useQuery({
    queryKey: ["schema", datasetId],
    queryFn: () => api.schema(datasetId!),
    enabled: Boolean(datasetId),
    retry: false, // an unreadable file will not become readable on a retry
  });

  if (!datasetId) {
    return (
      <Card className="min-h-0 flex-1">
        <EmptyState
          icon={<Table2 size={22} />}
          title="No dataset selected"
          hint="Pick a table in the Data Explorer to inspect its schema, profile and rows."
        />
      </Card>
    );
  }

  const dataset = data?.dataset;
  // An unreadable file has no schema response, so fall back to its filename
  // rather than showing a placeholder where the name belongs.
  const title = dataset?.name ?? datasetId.split("/").pop()?.replace(/\.[^.]+$/, "") ?? datasetId;

  return (
    <Card className="min-h-0 flex-1">
      <div className="flex items-start justify-between gap-2 px-4 pt-3.5 pb-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2.5">
            <Table2 size={20} className="flex-none text-brand-600" strokeWidth={1.7} />
            <span className="truncate text-[17px] font-semibold tracking-[-0.01em] text-ink-900">
              {title}
            </span>
            {dataset ? <Badge tone="brand">{dataset.format.toUpperCase()}</Badge> : null}
          </div>
          <div className="mt-1 truncate text-[11.5px] text-ink-500">
            {dataset?.qualifiedName ?? datasetId}
          </div>
        </div>
        <Menu
          items={[
            {
              label: "Query this table",
              icon: <Play size={14} />,
              disabled: !dataset,
              onSelect: () =>
                addSqlTab(`SELECT *\nFROM ${dataset!.qualifiedName}\nLIMIT 100;`, dataset!.name),
            },
            {
              label: "Copy table name",
              icon: <Copy size={14} />,
              disabled: !dataset,
              onSelect: () => navigator.clipboard?.writeText(dataset!.qualifiedName),
            },
            {
              label: "Copy file path",
              icon: <Copy size={14} />,
              disabled: !dataset,
              onSelect: () => navigator.clipboard?.writeText(dataset!.path),
            },
          ]}
        >
          {({ toggle }) => (
            <IconButton label="Dataset actions" onClick={toggle}>
              <MoreHorizontal size={17} />
            </IconButton>
          )}
        </Menu>
      </div>

      <TabBar tabs={TABS} value={inspectorTab} onChange={setInspectorTab} />

      {isLoading ? (
        <div className="flex flex-1 items-center justify-center">
          <Spinner />
        </div>
      ) : error ? (
        <EmptyState
          icon={<FileWarning size={22} className="text-warn" />}
          title="This file could not be read"
          hint={error instanceof ApiError ? error.message : String(error)}
        />
      ) : inspectorTab === "schema" ? (
        <SchemaTab columns={data?.columns ?? []} />
      ) : inspectorTab === "profile" ? (
        <ProfileTab datasetId={datasetId} columns={data?.columns ?? []} />
      ) : inspectorTab === "preview" ? (
        <PreviewTab datasetId={datasetId} />
      ) : (
        <LineageTab datasetId={datasetId} qualifiedName={dataset?.qualifiedName} />
      )}
    </Card>
  );
}

function SchemaTab({ columns }: { columns: SchemaColumn[] }) {
  const [filter, setFilter] = useState("");
  const needle = filter.trim().toLowerCase();
  const visible = needle
    ? columns.filter((column) => column.name.toLowerCase().includes(needle))
    : columns;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex-none px-4 py-3">
        <div className="flex h-8 items-center gap-2 rounded-lg border border-line px-2.5">
          <Search size={14} className="flex-none text-ink-400" />
          <input
            value={filter}
            onChange={(event) => setFilter(event.target.value)}
            placeholder="Search columns..."
            className="w-full bg-transparent text-[12.5px] text-ink-800 outline-none placeholder:text-ink-400"
          />
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-auto">
        <table className="w-full border-collapse text-[12.5px]">
          <thead className="sticky top-0 bg-slate-50 text-left">
            <tr className="text-[12px] font-semibold text-ink-700">
              <th className="border-y border-line px-4 py-2">Column</th>
              <th className="border-y border-line px-3 py-2">Type</th>
              <th className="border-y border-line px-4 py-2 text-right">Nulls</th>
            </tr>
          </thead>
          <tbody>
            {visible.map((column) => (
              <tr key={column.name} className="hover:bg-brand-50/40">
                <td className="border-b border-line/70 px-4 py-[7px]">
                  <span className="flex items-center gap-2">
                    <ColumnIcon column={column} />
                    <span className="truncate font-medium text-ink-900">{column.name}</span>
                  </span>
                </td>
                <td className="border-b border-line/70 px-3 py-[7px] text-ink-500">{column.type}</td>
                <td
                  className={clsx(
                    "num border-b border-line/70 px-4 py-[7px] text-right",
                    (column.nullRate ?? 0) > 5 ? "text-warn" : "text-ink-600",
                  )}
                >
                  {formatPercent(column.nullRate)}
                </td>
              </tr>
            ))}
            {visible.length === 0 ? (
              <tr>
                <td colSpan={3} className="px-4 py-6 text-center text-[12.5px] text-ink-400">
                  No columns match “{filter}”
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </div>
  );
}

const ICONS: Record<ColumnCategory, typeof Hash> = {
  number: Hash,
  string: Type,
  temporal: Calendar,
  boolean: ToggleLeft,
  binary: Binary,
  complex: Braces,
  other: Type,
};

function ColumnIcon({ column }: { column: SchemaColumn }) {
  // A leading id column reads as a key; it is a hint, not a real constraint.
  const isKeyish = /(^|_)id$/i.test(column.name) && column.category === "number";
  const Icon = isKeyish ? KeyRound : ICONS[column.category];
  return <Icon size={13} className="flex-none text-ink-400" strokeWidth={1.9} />;
}
