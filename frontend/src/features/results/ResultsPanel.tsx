import clsx from "clsx";
import { useInfiniteQuery } from "@tanstack/react-query";
import { CircleAlert, CircleCheck, Copy, Download, TableProperties } from "lucide-react";
import { useCallback, useMemo, useState } from "react";
import { api } from "../../lib/api";
import { formatDuration, formatInteger } from "../../lib/format";
import { Card, EmptyState, IconButton, Spinner, TabBar } from "../../components/ui";
import { useWorkspace, type Tab } from "../../store/workspace";
import type { Row } from "../../lib/types";
import { DataGrid, type SortState } from "./DataGrid";
import { ChartTab } from "./ChartTab";
import { SummaryTab } from "./SummaryTab";
import { ExecutionTab } from "./ExecutionTab";

const PAGE_SIZE = 200;

const TABS = [
  { id: "results", label: "Results" },
  { id: "chart", label: "Chart" },
  { id: "summary", label: "Summary" },
  { id: "execution", label: "Execution" },
] as const;

export function ResultsPanel({ tab }: { tab: Tab }) {
  const resultsTab = useWorkspace((state) => state.resultsTab);
  const setResultsTab = useWorkspace((state) => state.setResultsTab);
  const [sort, setSort] = useState<SortState | null>(null);

  const result = tab.result;
  const queryId = tab.queryId;

  const rowsQuery = useInfiniteQuery({
    queryKey: ["rows", queryId, sort?.column, sort?.desc],
    enabled: Boolean(queryId && result && result.columns.length > 0),
    initialPageParam: 0,
    queryFn: ({ pageParam }) =>
      api.rows(queryId!, {
        offset: pageParam as number,
        limit: PAGE_SIZE,
        sort: sort?.column,
        desc: sort?.desc,
      }),
    getNextPageParam: (last, pages) => {
      const loaded = pages.reduce((count, page) => count + page.rows.length, 0);
      return loaded < last.total ? loaded : undefined;
    },
  });

  const rows: Row[] = useMemo(
    () => rowsQuery.data?.pages.flatMap((page) => page.rows) ?? [],
    [rowsQuery.data],
  );

  const loadMore = useCallback(() => {
    if (rowsQuery.hasNextPage && !rowsQuery.isFetchingNextPage) rowsQuery.fetchNextPage();
  }, [rowsQuery]);

  const copyLoadedRows = () => {
    if (!result) return;
    const header = result.columns.map((column) => column.name).join("\t");
    const body = rows.map((row) => row.map((cell) => (cell === null ? "" : cell)).join("\t"));
    navigator.clipboard?.writeText([header, ...body].join("\n"));
  };

  return (
    <Card className="h-full">
      <TabBar
        tabs={TABS}
        value={resultsTab}
        onChange={setResultsTab}
        right={<StatusLine tab={tab} />}
      />

      {resultsTab === "results" ? (
        <>
          {tab.status === "failed" ? (
            <EmptyState
              icon={<CircleAlert size={22} className="text-danger" />}
              title="Query failed"
              hint={tab.error ?? undefined}
            />
          ) : !result ? (
            <EmptyState
              icon={<TableProperties size={22} />}
              title="No results yet"
              hint="Run a query with ⌘↵ to see rows here."
            />
          ) : result.columns.length === 0 ? (
            <EmptyState
              icon={<CircleCheck size={22} className="text-ok" />}
              title={result.message ?? "Statement executed"}
              hint="This statement did not return any rows."
            />
          ) : (
            <DataGrid
              columns={result.columns}
              rows={rows}
              sort={sort}
              onSortChange={setSort}
              onReachEnd={loadMore}
              loading={rowsQuery.isFetching}
            />
          )}

          <div className="flex flex-none items-center justify-between border-t border-line px-4 py-2.5">
            <span className="text-[12px] text-ink-500 num">
              {result && result.columns.length > 0
                ? `${formatInteger(result.rowCount)} row${result.rowCount === 1 ? "" : "s"}${
                    result.truncated ? ` · limited to ${formatInteger(tab.limit)}` : ""
                  }`
                : ""}
            </span>
            {result && result.columns.length > 0 ? (
              <div className="flex items-center gap-2">
                <a
                  href={api.exportUrl(queryId!, "csv")}
                  download
                  title={`Download all ${formatInteger(result.rowCount)} rows as CSV`}
                  className="inline-flex h-8 items-center gap-2 rounded-lg border border-line bg-white px-3 text-[12.5px] font-medium text-ink-700 transition-colors hover:bg-slate-50"
                >
                  <Download size={14} />
                  Export
                </a>
                <IconButton
                  label={`Copy rows (${formatInteger(rows.length)} loaded)`}
                  onClick={copyLoadedRows}
                  className="h-8 w-8 border border-line bg-white"
                >
                  <Copy size={14} />
                </IconButton>
              </div>
            ) : null}
          </div>
        </>
      ) : null}

      {resultsTab === "chart" ? <ChartTab tab={tab} rows={rows} /> : null}
      {resultsTab === "summary" ? <SummaryTab tab={tab} rows={rows} /> : null}
      {resultsTab === "execution" ? <ExecutionTab tab={tab} /> : null}
    </Card>
  );
}

function StatusLine({ tab }: { tab: Tab }) {
  if (tab.status === "running") {
    return (
      <span className="flex items-center gap-2 text-[12px] text-ink-500">
        <Spinner size={12} />
        {tab.progress == null ? (
          "Running…"
        ) : (
          <>
            <span className="num">{Math.round(tab.progress)}%</span>
            <span className="h-1 w-20 overflow-hidden rounded-full bg-slate-200">
              <span
                className="block h-full rounded-full bg-brand-500 transition-[width] duration-300"
                style={{ width: `${tab.progress}%` }}
              />
            </span>
          </>
        )}
      </span>
    );
  }
  if (tab.status === "failed") {
    return (
      <span className="flex max-w-[420px] items-center gap-2 text-[12px] text-danger">
        <span className="h-1.5 w-1.5 flex-none rounded-full bg-danger" />
        <span className="truncate" title={tab.error ?? ""}>
          {tab.error ?? "Query failed"}
        </span>
      </span>
    );
  }
  if (tab.status === "cancelled") {
    return <span className="text-[12px] text-ink-500">Query cancelled</span>;
  }
  if (tab.status === "completed" && tab.result) {
    return (
      <span className={clsx("flex items-center gap-2 text-[12px] text-ink-600 num")}>
        <span className="h-1.5 w-1.5 flex-none rounded-full bg-ok" />
        Query completed · {formatDuration(tab.result.elapsedMs)} ·{" "}
        {formatInteger(tab.result.rowCount)} rows
      </span>
    );
  }
  return null;
}
