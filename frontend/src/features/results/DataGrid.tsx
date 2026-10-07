import clsx from "clsx";
import { useVirtualizer } from "@tanstack/react-virtual";
import { ArrowDown, ArrowUp } from "lucide-react";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { formatCell } from "../../lib/format";
import type { ResultColumn, Row } from "../../lib/types";

const ROW_HEIGHT = 27;
const HEADER_HEIGHT = 32;
const MIN_WIDTH = 72;
const MAX_AUTO_WIDTH = 320;
const CELL_PADDING = 26;
const HEADER_PADDING = 44; // padding plus room for the sort arrow

const CELL_FONT = '12.5px -apple-system, BlinkMacSystemFont, "Segoe UI", Inter, sans-serif';
const HEADER_FONT = '600 12px -apple-system, BlinkMacSystemFont, "Segoe UI", Inter, sans-serif';

let context: CanvasRenderingContext2D | null | undefined;

/** Real text metrics: a fixed average character width truncates proportional
 *  digits and wide glyphs at the column edge. */
function textWidth(text: string, font: string): number {
  if (context === undefined) context = document.createElement("canvas").getContext("2d");
  if (!context) return text.length * 7.4;
  context.font = font;
  return context.measureText(text).width;
}

export interface SortState {
  column: string;
  desc: boolean;
}

interface Props {
  columns: ResultColumn[];
  rows: Row[];
  sort?: SortState | null;
  onSortChange?: (sort: SortState | null) => void;
  onReachEnd?: () => void;
  loading?: boolean;
  emptyMessage?: string;
}

/** Widths are estimated from the first page, then the user can drag to adjust. */
function estimateWidths(columns: ResultColumn[], rows: Row[]): number[] {
  return columns.map((column, index) => {
    let widest = textWidth(column.name, HEADER_FONT) + HEADER_PADDING;
    for (let r = 0; r < Math.min(rows.length, 60); r += 1) {
      const width = textWidth(formatCell(rows[r]?.[index], column.category), CELL_FONT) + CELL_PADDING;
      if (width > widest) widest = width;
    }
    return Math.min(MAX_AUTO_WIDTH, Math.max(MIN_WIDTH, Math.ceil(widest)));
  });
}

export function DataGrid({
  columns, rows, sort, onSortChange, onReachEnd, loading, emptyMessage,
}: Props) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [widths, setWidths] = useState<number[]>([]);
  const signature = useMemo(() => columns.map((c) => c.name).join("|"), [columns]);
  const measured = useRef({ signature: "", withRows: false });

  useLayoutEffect(() => {
    const hasRows = rows.length > 0;
    // Columns usually arrive a beat before the first page of rows, so measure
    // twice at most: once on the headers, again when there is data to sample.
    // After that, widths are the user's to change by dragging.
    if (measured.current.signature === signature && (measured.current.withRows || !hasRows)) {
      return;
    }
    setWidths(estimateWidths(columns, rows));
    measured.current = { signature, withRows: hasRows };
  }, [signature, rows.length]); // eslint-disable-line react-hooks/exhaustive-deps

  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 12,
  });

  const items = virtualizer.getVirtualItems();
  const last = items[items.length - 1];

  useEffect(() => {
    if (!onReachEnd || loading || rows.length === 0) return;
    if (last && last.index >= rows.length - 8) onReachEnd();
  }, [last?.index, rows.length, loading, onReachEnd]); // eslint-disable-line react-hooks/exhaustive-deps

  const totalWidth = widths.reduce((sum, width) => sum + width, 0);

  const startResize = (index: number, event: React.MouseEvent) => {
    event.preventDefault();
    event.stopPropagation();
    const startX = event.clientX;
    const startWidth = widths[index] ?? MIN_WIDTH;
    const move = (moveEvent: MouseEvent) => {
      const next = Math.max(MIN_WIDTH, startWidth + moveEvent.clientX - startX);
      setWidths((current) => current.map((width, i) => (i === index ? next : width)));
    };
    const stop = () => {
      window.removeEventListener("mousemove", move);
      window.removeEventListener("mouseup", stop);
    };
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", stop);
  };

  const toggleSort = (name: string) => {
    if (!onSortChange) return;
    if (sort?.column !== name) onSortChange({ column: name, desc: false });
    else if (!sort.desc) onSortChange({ column: name, desc: true });
    else onSortChange(null);
  };

  if (columns.length === 0) {
    return (
      <div className="flex flex-1 items-center justify-center text-[12.5px] text-ink-400">
        {emptyMessage ?? "No columns to show"}
      </div>
    );
  }

  return (
    <div ref={scrollRef} className="min-h-0 flex-1 overflow-auto">
      <div style={{ width: Math.max(totalWidth, 0) || undefined, minWidth: "100%" }}>
        <div
          className="sticky top-0 z-10 flex border-b border-line bg-slate-50"
          style={{ height: HEADER_HEIGHT }}
        >
          {columns.map((column, index) => {
            const active = sort?.column === column.name;
            return (
              <div
                key={`${column.name}-${index}`}
                onClick={() => toggleSort(column.name)}
                title={`${column.name} · ${column.type}`}
                style={{ width: widths[index] ?? MIN_WIDTH }}
                className={clsx(
                  "group relative flex flex-none cursor-pointer items-center gap-1 border-r border-line px-3",
                  "text-[12px] font-semibold text-ink-700 select-none hover:bg-slate-100",
                  column.category === "number" && "justify-end",
                )}
              >
                <span className="truncate">{column.name}</span>
                {active ? (
                  sort.desc ? (
                    <ArrowDown size={12} className="flex-none text-brand-600" />
                  ) : (
                    <ArrowUp size={12} className="flex-none text-brand-600" />
                  )
                ) : null}
                <span
                  onMouseDown={(event) => startResize(index, event)}
                  onClick={(event) => event.stopPropagation()}
                  className="absolute top-0 right-0 h-full w-2 cursor-col-resize hover:bg-brand-200"
                />
              </div>
            );
          })}
        </div>

        {rows.length === 0 ? (
          <div className="flex h-24 items-center justify-center text-[12.5px] text-ink-400">
            {emptyMessage ?? "No rows returned"}
          </div>
        ) : (
          <div style={{ height: virtualizer.getTotalSize(), position: "relative" }}>
            {items.map((item) => {
              const row = rows[item.index]!;
              return (
                <div
                  key={item.key}
                  className="absolute left-0 flex border-b border-line/70 hover:bg-brand-50/50"
                  style={{ top: 0, transform: `translateY(${item.start}px)`, height: ROW_HEIGHT }}
                >
                  {columns.map((column, index) => {
                    const value = row[index];
                    const isNull = value === null || value === undefined;
                    return (
                      <div
                        key={`${column.name}-${index}`}
                        style={{ width: widths[index] ?? MIN_WIDTH }}
                        className={clsx(
                          "flex flex-none items-center overflow-hidden px-3 text-[12.5px] whitespace-nowrap",
                          column.category === "number" && "justify-end num",
                          isNull ? "text-ink-400 italic" : "text-ink-800",
                        )}
                        title={isNull ? "NULL" : String(value)}
                      >
                        <span className="truncate">{formatCell(value, column.category)}</span>
                      </div>
                    );
                  })}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
