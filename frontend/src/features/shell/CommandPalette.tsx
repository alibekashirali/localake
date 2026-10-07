import clsx from "clsx";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { BarChart3, Columns3, FileText, FolderOpen, Search, Table2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { api } from "../../lib/api";
import { Spinner } from "../../components/ui";
import { useWorkspace } from "../../store/workspace";

const ICONS: Record<string, typeof Table2> = {
  tables: Table2,
  columns: Columns3,
  queries: FileText,
  charts: BarChart3,
  files: FileText,
  projects: FolderOpen,
};

export function CommandPalette() {
  const open = useWorkspace((state) => state.searchOpen);
  const setOpen = useWorkspace((state) => state.setSearchOpen);
  const selectDataset = useWorkspace((state) => state.selectDataset);
  const setExpanded = useWorkspace((state) => state.setExpanded);
  const setSection = useWorkspace((state) => state.setSection);
  const addSqlTab = useWorkspace((state) => state.addSqlTab);
  const openDatasetTab = useWorkspace((state) => state.openDatasetTab);
  const queryClient = useQueryClient();
  const [term, setTerm] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setOpen(true);
      }
      if (event.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [setOpen]);

  useEffect(() => {
    if (open) window.setTimeout(() => inputRef.current?.focus(), 10);
    else setTerm("");
  }, [open]);

  const openProject = useMutation({
    mutationFn: api.openProject,
    onSuccess: () => {
      selectDataset(null);
      queryClient.invalidateQueries();
    },
  });

  const { data, isFetching } = useQuery({
    queryKey: ["search", term],
    queryFn: () => api.search(term),
    enabled: open && term.trim().length >= 2,
  });

  if (!open) return null;

  const choose = (item: {
    label: string;
    datasetId?: string;
    queryId?: string;
    chartId?: string;
    sql?: string;
    path?: string;
    projectPath?: string;
  }) => {
    if (item.projectPath) {
      openProject.mutate(item.projectPath);
      setOpen(false);
      return;
    }
    // A saved query opens in a new tab; a chart jumps to the gallery.
    if (item.queryId && item.sql != null) {
      addSqlTab(item.sql, item.label);
      setOpen(false);
      return;
    }
    if (item.chartId) {
      setSection("charts");
      setOpen(false);
      return;
    }
    // A non-dataset file has no viewer; reveal it in the explorer tree instead.
    if (item.path && !item.datasetId) {
      const segments = item.path.split("/").slice(0, -1);
      setExpanded(segments.map((_, index) => segments.slice(0, index + 1).join("/")));
      setSection("sql");
      setOpen(false);
      return;
    }
    if (item.datasetId) {
      selectDataset(item.datasetId);
      // A column result labels itself "schema.table.column"; use the dataset
      // path for a stable tab title instead.
      const name = item.datasetId.split("/").pop() ?? item.label;
      openDatasetTab(item.datasetId, name);
      setSection("sql");
      // Reveal the dataset's folders so the selection is visible in the tree.
      const segments = item.datasetId.split("/").slice(0, -1);
      setExpanded(segments.map((_, index) => segments.slice(0, index + 1).join("/")));
    }
    setOpen(false);
  };

  const groups = data?.groups ?? [];

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-ink-900/20 pt-[12vh] backdrop-blur-[2px]"
      onClick={() => setOpen(false)}
    >
      <div
        onClick={(event) => event.stopPropagation()}
        className="w-full max-w-[560px] overflow-hidden rounded-2xl border border-line bg-white shadow-[var(--shadow-pop)]"
      >
        <div className="flex items-center gap-3 border-b border-line px-4">
          <Search size={17} className="flex-none text-ink-400" />
          <input
            ref={inputRef}
            value={term}
            onChange={(event) => setTerm(event.target.value)}
            placeholder="Search tables, columns, queries..."
            className="h-12 w-full bg-transparent text-[14px] text-ink-900 outline-none placeholder:text-ink-400"
          />
          {isFetching ? <Spinner /> : null}
        </div>

        <div className="max-h-[52vh] overflow-auto py-2">
          {term.trim().length < 2 ? (
            <p className="px-4 py-3 text-[12.5px] text-ink-400">
              Type at least two characters to search the catalog.
            </p>
          ) : groups.length === 0 ? (
            <p className="px-4 py-3 text-[12.5px] text-ink-400">No matches for “{term}”.</p>
          ) : (
            groups.map((group) => {
              const Icon = ICONS[group.kind] ?? Table2;
              return (
                <div key={group.kind} className="mb-1.5">
                  <div className="px-4 py-1.5 text-[11px] font-semibold tracking-wide text-ink-400 uppercase">
                    {group.title}
                  </div>
                  {group.items.map((item) => (
                    <button
                      key={`${group.kind}-${item.label}`}
                      onClick={() => choose(item)}
                      className={clsx(
                        "flex w-full items-center gap-3 px-4 py-2 text-left transition-colors",
                        "hover:bg-brand-50",
                      )}
                    >
                      <Icon size={15} className="flex-none text-ink-400" strokeWidth={1.8} />
                      <span className="min-w-0 flex-1 truncate text-[13px] text-ink-800">
                        {item.label}
                      </span>
                      <span className="flex-none text-[11px] text-ink-400">{item.sublabel}</span>
                    </button>
                  ))}
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}
