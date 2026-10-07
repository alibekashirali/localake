import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowLeft, ArrowDown, ArrowUp, FileText, NotebookText, Play, Plus, Save, Trash2, X,
} from "lucide-react";
import { useState } from "react";
import { api, ApiError } from "../../lib/api";
import { formatInteger } from "../../lib/format";
import { Button, Card, EmptyState, Spinner } from "../../components/ui";
import { DataGrid } from "../results/DataGrid";
import type { NotebookCell, NotebookCellResult } from "../../lib/types";

type CellOutput =
  | { kind: "running" }
  | { kind: "result"; result: NotebookCellResult }
  | { kind: "error"; message: string };

interface Draft {
  id: string | null; // null until first saved
  name: string;
  cells: NotebookCell[];
}

let cellCounter = 0;
const newCellId = () => `cell_${Date.now().toString(36)}_${(cellCounter += 1).toString(36)}`;

export function NotebooksSection() {
  const queryClient = useQueryClient();
  const { data, isLoading } = useQuery({ queryKey: ["notebooks"], queryFn: api.notebooks });
  const notebooks = data?.notebooks ?? [];

  const [draft, setDraft] = useState<Draft | null>(null);
  const [outputs, setOutputs] = useState<Record<string, CellOutput>>({});

  const save = useMutation({
    mutationFn: (current: Draft) =>
      api.saveNotebook({
        id: current.id ?? undefined,
        name: current.name,
        cells: current.cells.map((cell) => ({ id: cell.id, sql: cell.sql })),
      }),
    onSuccess: (saved) => {
      setDraft({ id: saved.id, name: saved.name, cells: saved.cells });
      queryClient.invalidateQueries({ queryKey: ["notebooks"] });
    },
  });

  const remove = useMutation({
    mutationFn: (id: string) => api.deleteNotebook(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["notebooks"] });
      setDraft(null);
    },
  });

  const runCell = async (cellId: string, sql: string) => {
    setOutputs((current) => ({ ...current, [cellId]: { kind: "running" } }));
    try {
      const result = await api.runNotebookCell(sql);
      setOutputs((current) => ({ ...current, [cellId]: { kind: "result", result } }));
    } catch (error) {
      setOutputs((current) => ({
        ...current,
        [cellId]: {
          kind: "error",
          message: error instanceof ApiError ? error.message : "Run failed",
        },
      }));
    }
  };

  const runAll = async () => {
    if (!draft) return;
    for (const cell of draft.cells) await runCell(cell.id, cell.sql);
  };

  const patchCell = (cellId: string, sql: string) => {
    if (!draft) return;
    setDraft({ ...draft, cells: draft.cells.map((c) => (c.id === cellId ? { ...c, sql } : c)) });
  };

  const moveCell = (index: number, delta: number) => {
    if (!draft) return;
    const target = index + delta;
    if (target < 0 || target >= draft.cells.length) return;
    const cells = [...draft.cells];
    [cells[index], cells[target]] = [cells[target]!, cells[index]!];
    setDraft({ ...draft, cells });
  };

  // -- list view ---------------------------------------------------------
  if (!draft) {
    return (
      <div className="min-h-0 flex-1 overflow-auto px-3 pb-1">
        <div className="mx-auto w-full max-w-3xl py-4">
          <Card>
            <div className="flex items-center justify-between border-b border-line px-4 py-3">
              <span className="text-[15px] font-semibold tracking-[-0.01em] text-ink-900">
                Notebooks
              </span>
              <Button
                icon={<Plus size={14} />}
                onClick={() => {
                  setDraft({
                    id: null,
                    name: "Untitled notebook",
                    cells: [{ id: newCellId(), sql: "" }],
                  });
                  setOutputs({});
                }}
              >
                New notebook
              </Button>
            </div>

            {isLoading ? (
              <div className="flex justify-center py-8">
                <Spinner />
              </div>
            ) : notebooks.length === 0 ? (
              <EmptyState
                icon={<NotebookText size={24} />}
                title="No notebooks yet"
                hint="Create one to keep ordered SQL cells over the same DuckDB session."
              />
            ) : (
              <div className="px-2 py-2">
                {notebooks.map((notebook) => (
                  <button
                    key={notebook.id}
                    onClick={() => {
                      setDraft({ id: notebook.id, name: notebook.name, cells: notebook.cells });
                      setOutputs({});
                    }}
                    className="flex w-full items-center gap-2.5 rounded-lg px-2 py-2 text-left transition-colors hover:bg-brand-50"
                  >
                    <FileText size={15} className="flex-none text-ink-400" />
                    <span className="min-w-0 flex-1 truncate text-[13px] text-ink-800">
                      {notebook.name}
                    </span>
                    <span className="num flex-none text-[11px] text-ink-400">
                      {notebook.cells.length} cells
                    </span>
                  </button>
                ))}
              </div>
            )}
          </Card>
        </div>
      </div>
    );
  }

  // -- editor view -------------------------------------------------------
  return (
    <div className="min-h-0 flex-1 overflow-auto px-3 pb-1">
      <div className="mx-auto flex w-full max-w-4xl flex-col gap-3 py-4">
        <Card>
          <div className="flex flex-none items-center gap-2 border-b border-line px-4 py-2.5">
            <button
              onClick={() => setDraft(null)}
              aria-label="Back to notebooks"
              className="rounded-md p-1.5 text-ink-400 transition-colors hover:bg-slate-100 hover:text-ink-700"
            >
              <ArrowLeft size={15} />
            </button>
            <input
              value={draft.name}
              onChange={(event) => setDraft({ ...draft, name: event.target.value })}
              className="min-w-0 flex-1 bg-transparent text-[15px] font-semibold text-ink-900 outline-none"
            />
            <Button
              icon={<Save size={14} />}
              onClick={() => save.mutate(draft)}
              loading={save.isPending}
            >
              Save
            </Button>
            {draft.id ? (
              <Button
                icon={<Trash2 size={14} />}
                onClick={() => {
                  if (window.confirm(`Delete “${draft.name}”?`)) remove.mutate(draft.id!);
                }}
              >
                Delete
              </Button>
            ) : null}
          </div>

          <div className="flex flex-none items-center justify-between px-4 py-2">
            <span className="text-[12px] text-ink-500">
              Cells run in order against the same DuckDB session.
            </span>
            <Button icon={<Play size={13} className="fill-current" />} onClick={runAll}>
              Run all
            </Button>
          </div>
        </Card>

        {draft.cells.map((cell, index) => (
          <CellEditor
            key={cell.id}
            cell={cell}
            index={index}
            total={draft.cells.length}
            output={outputs[cell.id]}
            onChange={(sql) => patchCell(cell.id, sql)}
            onRun={() => runCell(cell.id, cell.sql)}
            onMove={(delta) => moveCell(index, delta)}
            onDelete={() =>
              setDraft({ ...draft, cells: draft.cells.filter((c) => c.id !== cell.id) })
            }
          />
        ))}

        <Button
          icon={<Plus size={14} />}
          onClick={() =>
            setDraft({ ...draft, cells: [...draft.cells, { id: newCellId(), sql: "" }] })
          }
        >
          Add cell
        </Button>
      </div>
    </div>
  );
}

function CellEditor({
  cell, index, total, output, onChange, onRun, onMove, onDelete,
}: {
  cell: NotebookCell;
  index: number;
  total: number;
  output?: CellOutput;
  onChange: (sql: string) => void;
  onRun: () => void;
  onMove: (delta: number) => void;
  onDelete: () => void;
}) {
  return (
    <Card>
      <div className="flex flex-none items-center gap-1 border-b border-line px-2.5 py-1.5">
        <span className="num px-1 text-[11px] text-ink-400">{index + 1}</span>
        <button
          onClick={() => onRun()}
          disabled={!cell.sql.trim() || output?.kind === "running"}
          className="inline-flex h-7 items-center gap-1.5 rounded-md bg-brand-600 px-2.5 text-[12px] font-medium text-white transition-colors hover:bg-brand-700 disabled:opacity-50"
        >
          <Play size={12} className="fill-current" />
          Run
        </button>
        <div className="ml-auto flex items-center gap-0.5">
          <Icon title="Move up" disabled={index === 0} onClick={() => onMove(-1)}>
            <ArrowUp size={13} />
          </Icon>
          <Icon title="Move down" disabled={index === total - 1} onClick={() => onMove(1)}>
            <ArrowDown size={13} />
          </Icon>
          <Icon title="Delete cell" onClick={onDelete}>
            <X size={13} />
          </Icon>
        </div>
      </div>

      <textarea
        value={cell.sql}
        onChange={(event) => onChange(event.target.value)}
        spellCheck={false}
        placeholder="SELECT ..."
        className="block h-24 w-full resize-y bg-transparent px-3 py-2.5 font-mono text-[12.5px] leading-relaxed text-ink-900 outline-none placeholder:text-ink-300"
      />

      {output ? <CellOutputView output={output} /> : null}
    </Card>
  );
}

function CellOutputView({ output }: { output: CellOutput }) {
  if (output.kind === "running") {
    return (
      <div className="flex items-center gap-2 border-t border-line px-3 py-2.5 text-[12px] text-ink-500">
        <Spinner size={12} />
        Running…
      </div>
    );
  }
  if (output.kind === "error") {
    return (
      <div className="border-t border-line px-3 py-2.5 text-[12px] text-danger">{output.message}</div>
    );
  }

  const { result } = output;
  if (result.columns.length === 0) {
    return (
      <div className="border-t border-line px-3 py-2.5 text-[12px] text-ink-500">
        {result.message ?? "Executed"}
      </div>
    );
  }
  return (
    <div className="border-t border-line px-3 py-2.5">
      <div className="flex h-56 flex-col overflow-hidden rounded-lg border border-line">
        <DataGrid columns={result.columns} rows={result.rows} />
      </div>
      <div className="num mt-1.5 text-[11.5px] text-ink-500">
        {formatInteger(result.rowCount)} rows
        {result.truncated ? " · limited" : ""}
      </div>
    </div>
  );
}

function Icon({
  title, onClick, disabled, children,
}: {
  title: string;
  onClick: () => void;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      title={title}
      aria-label={title}
      disabled={disabled}
      onClick={onClick}
      className="rounded-md p-1.5 text-ink-400 transition-colors hover:bg-slate-100 hover:text-ink-700 disabled:cursor-not-allowed disabled:opacity-40"
    >
      {children}
    </button>
  );
}
