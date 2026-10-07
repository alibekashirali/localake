import { create } from "zustand";
import { persist } from "zustand/middleware";
import { api } from "../lib/api";
import type { QueryResult } from "../lib/types";

export type Section =
  | "home" | "explorer" | "sql" | "notebooks" | "charts"
  | "lineage" | "imports" | "history" | "settings";

export type TabStatus = "idle" | "running" | "completed" | "failed" | "cancelled";

export interface Tab {
  id: string;
  kind: "sql" | "dataset";
  name: string;
  sql: string;
  datasetId?: string;
  limit: number;
  savedQueryId?: string;
  /** Set once the tab has been seeded with a starter query or edited. */
  seeded?: boolean;
  /** Set when a tab should run as soon as it becomes active. */
  pendingRun?: boolean;
  /** Transient run state — never persisted, since results die with the process. */
  status: TabStatus;
  queryId?: string;
  progress?: number;
  result?: QueryResult;
  error?: string;
  startedAt?: number;
}

export const DEFAULT_LIMIT = 1000;

let counter = 0;
const nextId = () => `tab_${Date.now().toString(36)}_${(counter += 1).toString(36)}`;

function makeSqlTab(name: string, sql = "", limit = DEFAULT_LIMIT): Tab {
  return {
    id: nextId(), kind: "sql", name, sql,
    limit, status: "idle", seeded: sql.length > 0,
  };
}

interface WorkspaceState {
  section: Section;
  tabs: Tab[];
  activeTabId: string;
  selectedDatasetId: string | null;
  expanded: Record<string, boolean>;
  inspectorTab: "schema" | "profile" | "lineage" | "preview";
  resultsTab: "results" | "chart" | "summary" | "execution";
  searchOpen: boolean;
  /** Server-side "Default row limit" setting, seeded on load for new tabs. */
  defaultRowLimit: number;

  setSection: (section: Section) => void;
  setActiveTab: (id: string) => void;
  addSqlTab: (sql?: string, name?: string, options?: { run?: boolean }) => string;
  openDatasetTab: (datasetId: string, name: string) => string;
  closeTab: (id: string) => void;
  updateTab: (id: string, patch: Partial<Tab>) => void;
  selectDataset: (id: string | null) => void;
  toggleExpanded: (path: string) => void;
  collapseAll: () => void;
  setExpanded: (paths: string[]) => void;
  setInspectorTab: (tab: WorkspaceState["inspectorTab"]) => void;
  setResultsTab: (tab: WorkspaceState["resultsTab"]) => void;
  setSearchOpen: (open: boolean) => void;
  setDefaultRowLimit: (limit: number) => void;
  activeTab: () => Tab | undefined;
}

export const useWorkspace = create<WorkspaceState>()(
  persist(
    (set, get) => ({
      section: "sql",
      tabs: [makeSqlTab("Query 1")],
      activeTabId: "",
      selectedDatasetId: null,
      expanded: { analytics: true, views: true },
      inspectorTab: "schema",
      resultsTab: "results",
      searchOpen: false,
      defaultRowLimit: DEFAULT_LIMIT,

      setSection: (section) => set({ section }),
      setActiveTab: (id) => set({ activeTabId: id }),

      addSqlTab: (sql = "", name, options) => {
        const tabs = get().tabs;
        const used = tabs
          .map((tab) => /^Query (\d+)$/.exec(tab.name)?.[1])
          .filter(Boolean)
          .map(Number);
        const label = name ?? `Query ${Math.max(0, ...used) + 1}`;
        const tab = {
          ...makeSqlTab(label, sql, get().defaultRowLimit),
          pendingRun: options?.run ?? false,
        };
        set({ tabs: [...tabs, tab], activeTabId: tab.id, section: "sql" });
        return tab.id;
      },

      openDatasetTab: (datasetId, name) => {
        const existing = get().tabs.find((tab) => tab.datasetId === datasetId);
        if (existing) {
          set({ activeTabId: existing.id, selectedDatasetId: datasetId });
          return existing.id;
        }
        const tab: Tab = {
          id: nextId(), kind: "dataset", name, sql: "", datasetId,
          limit: get().defaultRowLimit, status: "idle",
        };
        set({ tabs: [...get().tabs, tab], activeTabId: tab.id, selectedDatasetId: datasetId });
        return tab.id;
      },

      closeTab: (id) => {
        const { tabs, activeTabId } = get();
        const index = tabs.findIndex((tab) => tab.id === id);
        if (index === -1) return;
        const closing = tabs[index];
        // Materialised results live in an in-memory DuckDB database until
        // released; drop the table when its tab goes away so a long session
        // does not accumulate result sets it no longer shows. A query still in
        // flight is interrupted too, otherwise it would re-materialise its
        // result after we released it.
        if (closing?.queryId) {
          if (closing.status === "running") {
            void api.cancel(closing.queryId).catch(() => {});
          }
          void api.release(closing.queryId).catch(() => {});
        }
        const remaining = tabs.filter((tab) => tab.id !== id);
        if (remaining.length === 0) {
          const fresh = makeSqlTab("Query 1", "", get().defaultRowLimit);
          set({ tabs: [fresh], activeTabId: fresh.id });
          return;
        }
        // Closing the active tab focuses its neighbour, like an editor would.
        const nextActive =
          activeTabId === id ? (remaining[Math.max(0, index - 1)]?.id ?? remaining[0]!.id) : activeTabId;
        set({ tabs: remaining, activeTabId: nextActive });
      },

      updateTab: (id, patch) =>
        set({ tabs: get().tabs.map((tab) => (tab.id === id ? { ...tab, ...patch } : tab)) }),

      selectDataset: (id) => set({ selectedDatasetId: id }),

      toggleExpanded: (path) =>
        set({ expanded: { ...get().expanded, [path]: !get().expanded[path] } }),

      collapseAll: () => set({ expanded: {} }),

      setExpanded: (paths) =>
        set({
          expanded: { ...get().expanded, ...Object.fromEntries(paths.map((p) => [p, true])) },
        }),

      setInspectorTab: (inspectorTab) => set({ inspectorTab }),
      setResultsTab: (resultsTab) => set({ resultsTab }),
      setSearchOpen: (searchOpen) => set({ searchOpen }),
      setDefaultRowLimit: (limit) => set({ defaultRowLimit: Math.max(1, limit) }),

      activeTab: () => {
        const { tabs, activeTabId } = get();
        return tabs.find((tab) => tab.id === activeTabId) ?? tabs[0];
      },
    }),
    {
      name: "localake.workspace",
      version: 2,
      migrate: (state, from) => {
        // v1 pointed several sidebar entries at the same screen; "explorer" now
        // means the data catalog, so send old sessions to the workspace.
        const stored = state as { section?: string };
        if (from < 2 && stored?.section === "explorer") stored.section = "sql";
        return stored as never;
      },
      // Only editable intent survives a reload; run state is rebuilt from scratch.
      partialize: (state) => ({
        section: state.section,
        activeTabId: state.activeTabId,
        selectedDatasetId: state.selectedDatasetId,
        expanded: state.expanded,
        inspectorTab: state.inspectorTab,
        resultsTab: state.resultsTab,
        tabs: state.tabs.map(({ id, kind, name, sql, datasetId, limit, savedQueryId, seeded }) => ({
          id, kind, name, sql, datasetId, limit, savedQueryId, seeded,
          status: "idle" as TabStatus,
        })),
      }),
    },
  ),
);

/** Zustand's persisted state can arrive with an id that no longer exists. */
export function ensureActiveTab(): void {
  const { tabs, activeTabId, setActiveTab } = useWorkspace.getState();
  if (!tabs.some((tab) => tab.id === activeTabId) && tabs[0]) setActiveTab(tabs[0].id);
}

/**
 * Seed the opening tab with a query against the user's own data.
 *
 * A hardcoded example is worse than useless in a project that has no such
 * table — the first thing a new user presses is Run.
 */
export function seedFirstTab(tables: { qualifiedName: string; sizeBytes?: number }[]): void {
  const { tabs, updateTab } = useWorkspace.getState();
  const target = tabs.find((tab) => tab.kind === "sql" && !tab.seeded && !tab.sql.trim());
  if (!target || tables.length === 0) return;
  const biggest = [...tables].sort((a, b) => (b.sizeBytes ?? 0) - (a.sizeBytes ?? 0))[0]!;
  updateTab(target.id, {
    sql: `SELECT *\nFROM ${biggest.qualifiedName}\nLIMIT 100;`,
    seeded: true,
  });
}
