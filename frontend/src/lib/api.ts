import type {
  AppSettings, ChartData, CompletionTable, DatasetInfo, DatasetProfile, Distribution,
  HistoryEntry, LineageGraph, NotebookCellResult, ProjectInfo, QueryPlan, QueryResult,
  RowPage, SavedChart, SavedNotebook, SavedQuery, SchemaColumn, SearchGroup, TreeNode,
} from "./types";

export class ApiError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
    this.name = "ApiError";
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`/api${path}`, {
    headers: init?.body ? { "Content-Type": "application/json" } : undefined,
    ...init,
  });
  if (!response.ok) {
    // FastAPI puts the human-readable reason in `detail`.
    const detail = await response.json().catch(() => null);
    throw new ApiError(detail?.detail ?? response.statusText, response.status);
  }
  return response.json() as Promise<T>;
}

const encodePath = (id: string) => id.split("/").map(encodeURIComponent).join("/");

export const api = {
  project: () => request<ProjectInfo>("/project"),
  recentProjects: () =>
    request<{ recent: { path: string; name: string; exists: boolean }[] }>("/project/recent"),
  openProject: (path: string) =>
    request<ProjectInfo>("/project", { method: "POST", body: JSON.stringify({ path }) }),

  tree: () => request<{ tree: TreeNode; version: number }>("/tree"),
  refreshTree: () =>
    request<{ tree: TreeNode; version: number }>("/tree/refresh", { method: "POST" }),

  datasets: (withStats = false) =>
    request<{ datasets: DatasetInfo[]; version: number }>(
      withStats ? "/datasets?stats=true" : "/datasets",
    ),
  dataset: (id: string) => request<DatasetInfo>(`/datasets/${encodePath(id)}`),
  schema: (id: string) =>
    request<{ dataset: DatasetInfo; columns: SchemaColumn[] }>(`/datasets/${encodePath(id)}/schema`),
  distribution: (id: string, column: string) =>
    request<Distribution>(
      `/datasets/${encodePath(id)}/distribution?column=${encodeURIComponent(column)}`,
    ),
  profile: (id: string) => request<DatasetProfile>(`/datasets/${encodePath(id)}/profile`),
  preview: (id: string, limit = 100) =>
    request<RowPage & { columns: { name: string; type: string; category: string }[] }>(
      `/datasets/${encodePath(id)}/preview?limit=${limit}`,
    ),

  completions: () => request<{ tables: CompletionTable[]; version: number }>("/completions"),
  search: (q: string) =>
    request<{ query: string; groups: SearchGroup[] }>(`/search?q=${encodeURIComponent(q)}`),

  run: (body: { sql: string; queryId?: string; tabId?: string; name?: string; limit?: number }) =>
    request<{ queryId: string; status: string }>("/query", {
      method: "POST",
      body: JSON.stringify(body),
    }),
  cancel: (queryId: string) =>
    request<{ cancelled: boolean }>(`/query/${queryId}/cancel`, { method: "POST" }),
  queryState: (queryId: string) =>
    request<{ status: string; result?: QueryResult; error?: string }>(`/query/${queryId}`),
  rows: (
    queryId: string,
    opts: { offset?: number; limit?: number; sort?: string; desc?: boolean; search?: string } = {},
  ) => {
    const params = new URLSearchParams();
    if (opts.offset) params.set("offset", String(opts.offset));
    params.set("limit", String(opts.limit ?? 200));
    if (opts.sort) params.set("sort", opts.sort);
    if (opts.desc) params.set("desc", "true");
    if (opts.search) params.set("search", opts.search);
    return request<RowPage>(`/query/${queryId}/rows?${params}`);
  },
  release: (queryId: string) => request(`/query/${queryId}`, { method: "DELETE" }),
  exportUrl: (queryId: string, format: "csv" | "json") =>
    `/api/query/${queryId}/export?format=${format}`,
  importFile: async (file: File, target: string) => {
    const form = new FormData();
    form.append("file", file);
    // Do not set Content-Type: the browser must add the multipart boundary.
    const response = await fetch(`/api/import?target=${encodeURIComponent(target)}`, {
      method: "POST",
      body: form,
    });
    if (!response.ok) {
      const detail = await response.json().catch(() => null);
      throw new ApiError(detail?.detail ?? response.statusText, response.status);
    }
    return response.json() as Promise<{
      filename: string;
      path: string;
      sizeBytes: number;
      dataset: DatasetInfo | null;
    }>;
  },

  notebooks: () => request<{ notebooks: SavedNotebook[] }>("/notebooks"),
  saveNotebook: (body: { id?: string; name: string; cells: { id?: string; sql: string }[] }) =>
    request<SavedNotebook>("/notebooks", { method: "POST", body: JSON.stringify(body) }),
  deleteNotebook: (id: string) => request(`/notebooks/${id}`, { method: "DELETE" }),
  runNotebookCell: (sql: string, limit = 1000) =>
    request<NotebookCellResult>("/notebooks/run", {
      method: "POST",
      body: JSON.stringify({ sql, limit }),
    }),

  savedQueries: () => request<{ queries: SavedQuery[] }>("/queries"),
  saveQuery: (body: { id?: string; name: string; sql: string }) =>
    request<SavedQuery>("/queries", { method: "POST", body: JSON.stringify(body) }),
  deleteQuery: (id: string) => request(`/queries/${id}`, { method: "DELETE" }),

  settings: () => request<AppSettings>("/settings"),
  saveSettings: (body: Record<string, unknown>) =>
    request<AppSettings>("/settings", { method: "PUT", body: JSON.stringify(body) }),

  lineage: () => request<LineageGraph>("/lineage"),
  datasetLineage: (id: string) => request<LineageGraph>(`/lineage/${encodePath(id)}`),

  charts: () => request<{ charts: SavedChart[] }>("/charts"),
  saveChart: (body: {
    id?: string; name: string; sql: string;
    type: SavedChart["type"]; x: string; y: string[];
  }) => request<SavedChart>("/charts", { method: "POST", body: JSON.stringify(body) }),
  deleteChart: (id: string) => request(`/charts/${id}`, { method: "DELETE" }),
  chartData: (id: string) => request<ChartData>(`/charts/${id}/data`),

  plan: (queryId: string) => request<QueryPlan>(`/query/${queryId}/plan`),

  history: (opts: { limit?: number; q?: string; since?: string; status?: string } = {}) => {
    const params = new URLSearchParams({ limit: String(opts.limit ?? 100) });
    if (opts.q) params.set("q", opts.q);
    if (opts.since && opts.since !== "all") params.set("since", opts.since);
    if (opts.status && opts.status !== "all") params.set("status", opts.status);
    return request<{ entries: HistoryEntry[] }>(`/history?${params}`);
  },
};
