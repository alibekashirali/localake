export type NodeKind = "folder" | "dataset" | "file";
export type DataFormat = "parquet" | "csv" | "json";
export type ColumnCategory =
  | "number" | "string" | "boolean" | "temporal" | "binary" | "complex" | "other";

export interface TreeNode {
  id: string;
  name: string;
  kind: NodeKind;
  path: string;
  format?: DataFormat;
  datasetId?: string;
  sizeBytes?: number;
  error?: string;
  children?: TreeNode[];
}

export interface ProjectInfo {
  name: string;
  root: string;
  displayRoot: string;
  dataRoot: string;
  engine: string;
  datasetCount: number;
  catalogVersion: number;
  mode: "local" | "remote";
}

export interface DatasetStats {
  rows: number;
  columns: number;
  sizeBytes: number;
}

export interface DatasetInfo {
  id: string;
  name: string;
  path: string;
  format: DataFormat;
  schema: string;
  table: string;
  qualifiedName: string;
  sizeBytes: number;
  modifiedAt: number;
  partitioned: boolean;
  error: string | null;
  stats?: DatasetStats;
}

export interface CatalogStats {
  rows: number | null;
  columns: number | null;
  sizeBytes: number;
}

export interface SchemaColumn {
  name: string;
  type: string;
  category: ColumnCategory;
  nullRate: number | null;
}

export interface ResultColumn {
  name: string;
  type: string;
  category: ColumnCategory;
}

export type CellValue = string | number | boolean | null;
export type Row = CellValue[];

export interface QueryResult {
  queryId: string;
  columns: ResultColumn[];
  rowCount: number;
  truncated: boolean;
  elapsedMs: number;
  message: string | null;
  statements: number;
}

export interface RowPage {
  rows: Row[];
  offset: number;
  total: number;
}

export interface ProfileColumn {
  name: string;
  type: string;
  category: ColumnCategory;
  min: CellValue;
  max: CellValue;
  avg: number | null;
  median: number | null;
  q25: number | null;
  q75: number | null;
  std: number | null;
  approxUnique: number | null;
  nullRate: number | null;
}

export interface DatasetProfile {
  dataset: DatasetInfo;
  stats: DatasetStats;
  nullRate: number;
  duplicateRate: number | null;
  uniqueShare: number | null;
  columns: ProfileColumn[];
}

export interface SavedQuery {
  id: string;
  name: string;
  sql: string;
  description: string | null;
  createdAt: number;
  updatedAt: number;
}

export interface HistoryEntry {
  id: string;
  name: string | null;
  sql: string;
  status: "completed" | "failed" | "cancelled";
  startedAt: number;
  finishedAt: number | null;
  elapsedMs: number | null;
  rowCount: number | null;
  error: string | null;
}

export interface CompletionTable {
  schema: string;
  name: string;
  qualifiedName: string;
  datasetId: string;
  format: DataFormat;
  columns: { name: string; type: string }[];
}

export interface HistogramBin {
  from: number;
  to: number;
  count: number;
  temporal: boolean;
}

export type Distribution =
  | { column: string; kind: "histogram"; bins: HistogramBin[] }
  | { column: string; kind: "topValues"; values: { value: CellValue; count: number }[] };

export interface SavedChart {
  id: string;
  name: string;
  sql: string;
  type: "line" | "bar" | "area" | "scatter";
  x: string;
  y: string[];
  description: string | null;
  createdAt: number;
  updatedAt: number;
}

export interface ChartData {
  chart: SavedChart;
  columns: ResultColumn[];
  rows: Row[];
}

export interface NotebookCell {
  id: string;
  sql: string;
}

export interface SavedNotebook {
  id: string;
  name: string;
  cells: NotebookCell[];
  createdAt: number;
  updatedAt: number;
}

export interface NotebookCellResult {
  columns: ResultColumn[];
  rows: Row[];
  rowCount: number;
  truncated: boolean;
  message: string | null;
}

export interface SearchGroup {
  kind: string;
  title: string;
  items: {
    label: string;
    sublabel: string;
    datasetId?: string;
    queryId?: string;
    chartId?: string;
    sql?: string;
    path?: string;
    projectPath?: string;
  }[];
}

export interface PlanOperator {
  name: string;
  rows: number | null;
  timing: number | null;
  detail: string | null;
  depth: number;
  scan: boolean;
}

export interface QueryPlan {
  plan: string;
  elapsedMs: number | null;
  rowCount: number | null;
  statements: number | null;
  rowsScanned: number | null;
  bytesRead: number | null;
  operators: PlanOperator[];
}

export interface AppSettings {
  engine: {
    memoryLimit: string;
    threads: number;
    tempDirectory: string;
    externalAccess: boolean;
  };
  workspace: { defaultRowLimit: number; watchFiles: boolean };
  about: {
    localake: string;
    duckdb: string;
    project: string;
    metadata: string;
    datasets: number;
  };
}

export type LineageKind = "file" | "table" | "view" | "query" | "chart";

export interface LineageNode {
  id: string;
  kind: LineageKind;
  label: string;
  datasetId?: string;
  format?: DataFormat;
  path?: string;
  sizeBytes?: number;
  error?: string | null;
  sql?: string;
  chartType?: string;
}

export interface LineageGraph {
  nodes: LineageNode[];
  edges: { source: string; target: string }[];
}

export type WorkspaceEvent =
  | { type: "hello"; project: string; catalogVersion: number }
  | { type: "ping" }
  | { type: "catalog.updated"; version: number }
  | { type: "query.running"; queryId: string; tabId: string | null }
  | { type: "query.progress"; queryId: string; tabId: string | null; percent: number }
  | { type: "query.completed"; queryId: string; tabId: string | null; result: QueryResult }
  | { type: "query.failed"; queryId: string; tabId: string | null; error: string }
  | { type: "query.cancelled"; queryId: string; tabId: string | null };
