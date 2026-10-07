// The narrow `editor.api` entry plus one language contribution: importing the
// `monaco-editor` barrel would bundle 40+ grammars and four language services
// we never use, tripling the payload.
import * as monaco from "monaco-editor/esm/vs/editor/editor.api";
import "monaco-editor/esm/vs/basic-languages/sql/sql.contribution";
import editorWorker from "monaco-editor/esm/vs/editor/editor.worker?worker";
import { loader } from "@monaco-editor/react";
import type { CompletionTable } from "../../lib/types";

/**
 * Monaco is bundled, never fetched: `@monaco-editor/react` would otherwise pull
 * it from a CDN, which would break the product's Local Mode promise.
 */
self.MonacoEnvironment = { getWorker: () => new editorWorker() };
loader.config({ monaco });

export const THEME = "localake";

const KEYWORDS = [
  "SELECT", "FROM", "WHERE", "GROUP BY", "ORDER BY", "HAVING", "LIMIT", "OFFSET",
  "JOIN", "LEFT JOIN", "RIGHT JOIN", "FULL JOIN", "INNER JOIN", "CROSS JOIN", "ON",
  "USING", "WITH", "AS", "DISTINCT", "UNION", "UNION ALL", "EXCEPT", "INTERSECT",
  "CASE", "WHEN", "THEN", "ELSE", "END", "AND", "OR", "NOT", "IN", "BETWEEN",
  "LIKE", "ILIKE", "IS NULL", "IS NOT NULL", "ASC", "DESC", "QUALIFY", "OVER",
  "PARTITION BY", "CREATE VIEW", "CREATE TABLE", "INSERT INTO", "VALUES", "EXPLAIN",
  "SUMMARIZE", "DESCRIBE", "PIVOT", "UNPIVOT",
];

const FUNCTIONS = [
  "count", "sum", "avg", "min", "max", "median", "mode", "stddev", "variance",
  "approx_count_distinct", "quantile_cont", "any_value", "arg_max", "arg_min",
  "date_trunc", "date_part", "date_diff", "datesub", "strftime", "strptime",
  "current_date", "now", "epoch_ms", "age", "last_day", "make_date",
  "row_number", "rank", "dense_rank", "lag", "lead", "first_value", "last_value",
  "ntile", "cume_dist", "percent_rank",
  "coalesce", "nullif", "ifnull", "greatest", "least", "cast", "try_cast",
  "upper", "lower", "trim", "ltrim", "rtrim", "replace", "regexp_matches",
  "regexp_replace", "regexp_extract", "split_part", "concat", "concat_ws",
  "substring", "length", "starts_with", "ends_with", "contains", "printf",
  "round", "floor", "ceil", "abs", "sign", "power", "sqrt", "exp", "ln", "log",
  "list", "list_aggregate", "unnest", "struct_pack", "map", "json_extract",
  "read_parquet", "read_csv_auto", "read_json_auto", "glob", "range", "generate_series",
];

let themeDefined = false;

/** Palette tuned to match the reference interface's editor. */
export function defineTheme(): void {
  if (themeDefined) return;
  monaco.editor.defineTheme(THEME, {
    base: "vs",
    inherit: true,
    rules: [
      { token: "keyword", foreground: "3355e8", fontStyle: "bold" },
      { token: "keyword.sql", foreground: "3355e8", fontStyle: "bold" },
      { token: "operator.sql", foreground: "64748b" },
      { token: "string", foreground: "b02a37" },
      { token: "string.sql", foreground: "b02a37" },
      { token: "number", foreground: "1d4ed8" },
      { token: "predefined", foreground: "1e3a8a" },
      { token: "predefined.sql", foreground: "1e3a8a" },
      { token: "identifier", foreground: "0f172a" },
      { token: "comment", foreground: "94a3b8", fontStyle: "italic" },
    ],
    colors: {
      "editor.background": "#ffffff",
      "editor.foreground": "#0f172a",
      "editorLineNumber.foreground": "#cbd5e1",
      "editorLineNumber.activeForeground": "#64748b",
      "editor.selectionBackground": "#dfe6ff",
      "editor.lineHighlightBackground": "#f8fafc",
      "editorCursor.foreground": "#3355e8",
      "editorIndentGuide.background1": "#f1f5f9",
      "editorSuggestWidget.selectedBackground": "#eef2ff",
    },
  });
  themeDefined = true;
}

/** Table names referenced by the statement under the cursor. */
function referencedTables(text: string, tables: CompletionTable[]): CompletionTable[] {
  const names = new Set<string>();
  const pattern = /\b(?:from|join|update|into)\s+([a-zA-Z_][\w.]*)/gi;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(text))) names.add(match[1]!.toLowerCase());
  const hits = tables.filter(
    (table) => names.has(table.qualifiedName.toLowerCase()) || names.has(table.name.toLowerCase()),
  );
  // With nothing recognised, offering every column beats offering none.
  return hits.length ? hits : tables;
}

let disposable: monaco.IDisposable | null = null;

/** (Re)install the completion provider whenever the catalog changes. */
export function registerCompletions(tables: CompletionTable[]): void {
  disposable?.dispose();
  const schemas = [...new Set(tables.map((table) => table.schema))];

  disposable = monaco.languages.registerCompletionItemProvider("sql", {
    triggerCharacters: [".", " "],
    provideCompletionItems(model, position) {
      const word = model.getWordUntilPosition(position);
      const range: monaco.IRange = {
        startLineNumber: position.lineNumber,
        endLineNumber: position.lineNumber,
        startColumn: word.startColumn,
        endColumn: word.endColumn,
      };
      const linePrefix = model.getValueInRange({
        startLineNumber: position.lineNumber,
        startColumn: 1,
        endLineNumber: position.lineNumber,
        endColumn: position.column,
      });
      const kinds = monaco.languages.CompletionItemKind;
      const qualifier = /([a-zA-Z_]\w*)\.\w*$/.exec(linePrefix)?.[1]?.toLowerCase();

      if (qualifier) {
        if (schemas.includes(qualifier)) {
          return {
            suggestions: tables
              .filter((table) => table.schema === qualifier)
              .map((table) => ({
                label: table.name,
                kind: kinds.Struct,
                detail: table.format,
                insertText: table.name,
                range,
              })),
          };
        }
        const owner = tables.find(
          (table) => table.name.toLowerCase() === qualifier || table.qualifiedName.toLowerCase().endsWith(`.${qualifier}`),
        );
        if (owner) {
          return {
            suggestions: owner.columns.map((column, index) => ({
              label: column.name,
              kind: kinds.Field,
              detail: column.type,
              insertText: column.name,
              sortText: String(index).padStart(4, "0"),
              range,
            })),
          };
        }
        return { suggestions: [] };
      }

      const columns = referencedTables(model.getValue(), tables).flatMap((table) =>
        table.columns.map((column) => ({
          label: column.name,
          kind: kinds.Field,
          detail: `${column.type} · ${table.qualifiedName}`,
          insertText: column.name,
          sortText: `1_${column.name}`,
          range,
        })),
      );

      return {
        suggestions: [
          ...tables.map((table) => ({
            label: table.qualifiedName,
            kind: kinds.Struct,
            detail: `${table.format} · ${table.columns.length} columns`,
            insertText: table.qualifiedName,
            sortText: `0_${table.qualifiedName}`,
            range,
          })),
          ...dedupe(columns),
          ...KEYWORDS.map((keyword) => ({
            label: keyword,
            kind: kinds.Keyword,
            insertText: keyword,
            sortText: `2_${keyword}`,
            range,
          })),
          ...FUNCTIONS.map((fn) => ({
            label: fn,
            kind: kinds.Function,
            insertText: `${fn}($0)`,
            insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
            sortText: `3_${fn}`,
            range,
          })),
        ],
      };
    },
  });
}

function dedupe<T extends { label: string }>(items: T[]): T[] {
  const seen = new Set<string>();
  return items.filter((item) => (seen.has(item.label) ? false : (seen.add(item.label), true)));
}

export { monaco };
