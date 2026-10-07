import clsx from "clsx";
import { useQuery } from "@tanstack/react-query";
import {
  BarChart3, Database, FileText, FolderTree, HardDrive, Play, Plus, Table2,
} from "lucide-react";
import { api } from "../../lib/api";
import { formatBytes, formatCount, formatRelativeTime } from "../../lib/format";
import { Card, Spinner } from "../../components/ui";
import type { HistoryEntry } from "../../lib/types";
import { useWorkspace } from "../../store/workspace";

const RECENT_LIMIT = 6;

export function HomeSection() {
  const addSqlTab = useWorkspace((state) => state.addSqlTab);
  const setSection = useWorkspace((state) => state.setSection);
  const selectDataset = useWorkspace((state) => state.selectDataset);
  const openDatasetTab = useWorkspace((state) => state.openDatasetTab);

  const { data: project } = useQuery({ queryKey: ["project"], queryFn: api.project });
  const { data: datasets, isLoading } = useQuery({
    queryKey: ["datasets", "stats"],
    queryFn: () => api.datasets(true),
  });
  const { data: saved } = useQuery({ queryKey: ["saved-queries"], queryFn: api.savedQueries });
  const { data: charts } = useQuery({ queryKey: ["charts"], queryFn: api.charts });
  const { data: history } = useQuery({ queryKey: ["history"], queryFn: () => api.history({ limit: 60 }) });

  const all = datasets?.datasets ?? [];
  const totalBytes = all.reduce((sum, d) => sum + d.sizeBytes, 0);
  const totalRows = all.reduce((sum, d) => sum + (d.stats?.rows ?? 0), 0);
  const biggest = [...all].sort((a, b) => b.sizeBytes - a.sizeBytes).slice(0, RECENT_LIMIT);

  // History repeats the same query many times; show each distinct one once.
  const recent: HistoryEntry[] = [];
  const seen = new Set<string>();
  for (const entry of history?.entries ?? []) {
    const key = entry.sql.replace(/\s+/g, " ").trim();
    if (seen.has(key) || entry.status !== "completed") continue;
    seen.add(key);
    recent.push(entry);
    if (recent.length >= RECENT_LIMIT) break;
  }

  return (
    <div className="min-h-0 flex-1 overflow-auto px-3 pb-1">
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-4 pb-4">
        <Card className="flex-none">
          <div className="flex flex-wrap items-end justify-between gap-4 px-5 py-4">
            <div>
              <div className="text-[11.5px] text-ink-500">Project</div>
              <div className="text-[24px] font-semibold tracking-[-0.02em] text-ink-900">
                {project?.name ?? "…"}
              </div>
              <div className="text-[12px] text-ink-500">{project?.displayRoot}</div>
            </div>
            <div className="flex gap-2.5">
              <Action icon={<Plus size={15} />} label="New query" onClick={() => addSqlTab()} />
              <Action
                icon={<FolderTree size={15} />}
                label="Browse data"
                onClick={() => setSection("explorer")}
              />
            </div>
          </div>
          <dl className="grid grid-cols-2 gap-px border-t border-line bg-line sm:grid-cols-4">
            <Stat icon={<Table2 size={15} />} label="Datasets" value={String(all.length)} />
            <Stat
              icon={<Database size={15} />}
              label="Rows"
              value={totalRows ? formatCount(totalRows) : "—"}
              hint={totalRows ? "Parquet only; CSV and JSON are not counted" : undefined}
            />
            <Stat icon={<HardDrive size={15} />} label="On disk" value={formatBytes(totalBytes)} />
            <Stat
              icon={<BarChart3 size={15} />}
              label="Saved"
              value={`${saved?.queries.length ?? 0} queries · ${charts?.charts.length ?? 0} charts`}
            />
          </dl>
        </Card>

        {isLoading ? (
          <div className="flex justify-center py-8">
            <Spinner />
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <Panel title="Recent queries" onSeeAll={() => setSection("history")}>
              {recent.length === 0 ? (
                <Empty>Run a query and it will appear here.</Empty>
              ) : (
                recent.map((entry) => (
                  <Row
                    key={`${entry.id}-${entry.startedAt}`}
                    icon={<FileText size={14} />}
                    title={entry.name ?? oneLine(entry.sql)}
                    subtitle={entry.name ? oneLine(entry.sql) : undefined}
                    meta={formatRelativeTime(entry.startedAt)}
                    onClick={() => addSqlTab(entry.sql, entry.name ?? undefined)}
                  />
                ))
              )}
            </Panel>

            <Panel title="Saved queries" onSeeAll={() => setSection("history")}>
              {(saved?.queries ?? []).length === 0 ? (
                <Empty>Press Save above the editor to keep a query.</Empty>
              ) : (
                saved!.queries.slice(0, RECENT_LIMIT).map((query) => (
                  <Row
                    key={query.id}
                    icon={<Play size={14} />}
                    title={query.name}
                    subtitle={oneLine(query.sql)}
                    meta={formatRelativeTime(query.updatedAt)}
                    onClick={() => addSqlTab(query.sql, query.name)}
                  />
                ))
              )}
            </Panel>

            <Panel title="Largest datasets" onSeeAll={() => setSection("explorer")}>
              {biggest.length === 0 ? (
                <Empty>Drop Parquet, CSV or JSON files into the project folder.</Empty>
              ) : (
                biggest.map((dataset) => (
                  <Row
                    key={dataset.id}
                    icon={<Table2 size={14} />}
                    title={dataset.qualifiedName}
                    subtitle={
                      dataset.stats?.rows != null
                        ? `${formatCount(dataset.stats.rows)} rows · ${dataset.stats.columns} columns`
                        : dataset.path
                    }
                    meta={formatBytes(dataset.sizeBytes)}
                    onClick={() => {
                      selectDataset(dataset.id);
                      openDatasetTab(dataset.id, dataset.name);
                      setSection("sql");
                    }}
                  />
                ))
              )}
            </Panel>

            <Panel title="Charts" onSeeAll={() => setSection("charts")}>
              {(charts?.charts ?? []).length === 0 ? (
                <Empty>Build a chart under the editor, then save it.</Empty>
              ) : (
                charts!.charts.slice(0, RECENT_LIMIT).map((chart) => (
                  <Row
                    key={chart.id}
                    icon={<BarChart3 size={14} />}
                    title={chart.name}
                    subtitle={`${chart.y.join(", ")} by ${chart.x}`}
                    meta={chart.type}
                    onClick={() => setSection("charts")}
                  />
                ))
              )}
            </Panel>
          </div>
        )}
      </div>
    </div>
  );
}

function Action({ icon, label, onClick }: { icon: React.ReactNode; label: string; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="inline-flex h-9 items-center gap-2 rounded-lg border border-line bg-white px-3.5 text-[13px] font-medium text-ink-700 transition-colors hover:border-line-strong hover:bg-slate-50"
    >
      {icon}
      {label}
    </button>
  );
}

function Stat({
  icon, label, value, hint,
}: { icon: React.ReactNode; label: string; value: string; hint?: string }) {
  return (
    <div className="bg-white px-5 py-3.5" title={hint}>
      <dt className="flex items-center gap-1.5 text-[11.5px] text-ink-500">
        <span className="text-ink-400">{icon}</span>
        {label}
      </dt>
      <dd className="num mt-0.5 text-[17px] font-semibold text-ink-900">{value}</dd>
    </div>
  );
}

function Panel({
  title, onSeeAll, children,
}: { title: string; onSeeAll?: () => void; children: React.ReactNode }) {
  return (
    <Card className="flex-none">
      <div className="flex items-center justify-between px-4 pt-3.5 pb-1.5">
        <span className="text-[14px] font-semibold tracking-[-0.01em] text-ink-900">{title}</span>
        {onSeeAll ? (
          <button
            onClick={onSeeAll}
            className="text-[12.5px] font-medium text-brand-600 hover:text-brand-700"
          >
            View all
          </button>
        ) : null}
      </div>
      <div className="px-2 pb-2.5">{children}</div>
    </Card>
  );
}

function Row({
  icon, title, subtitle, meta, onClick,
}: {
  icon: React.ReactNode; title: string; subtitle?: string; meta?: string; onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={clsx(
        "group flex w-full items-center gap-2.5 rounded-lg px-2 py-[7px] text-left",
        "transition-colors hover:bg-brand-50",
      )}
    >
      <span className="flex-none text-ink-400">{icon}</span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[13px] text-ink-800 group-hover:text-brand-700">
          {title}
        </span>
        {subtitle ? (
          <span className="block truncate font-mono text-[10.5px] text-ink-400">{subtitle}</span>
        ) : null}
      </span>
      {meta ? <span className="num flex-none text-[11px] text-ink-400">{meta}</span> : null}
    </button>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return <p className="px-2 py-3 text-[12px] leading-relaxed text-ink-500">{children}</p>;
}

function oneLine(sql: string): string {
  const flat = sql.replace(/\s+/g, " ").trim();
  return flat.length > 80 ? `${flat.slice(0, 79)}…` : flat;
}
