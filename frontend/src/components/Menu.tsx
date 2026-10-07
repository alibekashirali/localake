import clsx from "clsx";
import { useEffect, useRef, useState, type ReactNode } from "react";

export interface MenuItem {
  label: string;
  icon?: ReactNode;
  onSelect: () => void;
  danger?: boolean;
  disabled?: boolean;
  hint?: string;
}

interface Props {
  items: (MenuItem | "separator")[];
  children: (props: { open: boolean; toggle: () => void }) => ReactNode;
  align?: "left" | "right";
  className?: string;
}

/** A small popover menu: click to open, click outside or Escape to dismiss. */
export function Menu({ items, children, align = "right", className }: Props) {
  const [open, setOpen] = useState(false);
  const container = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: MouseEvent) => {
      if (!container.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    // Capture phase so a click on another menu's trigger closes this one first.
    document.addEventListener("mousedown", onPointerDown, true);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onPointerDown, true);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div ref={container} className={clsx("relative", className)}>
      {children({ open, toggle: () => setOpen((value) => !value) })}
      {open ? (
        <div
          role="menu"
          className={clsx(
            "absolute top-full z-40 mt-1.5 min-w-[192px] overflow-hidden rounded-xl",
            "border border-line bg-white py-1 shadow-[var(--shadow-pop)]",
            align === "right" ? "right-0" : "left-0",
          )}
        >
          {items.map((item, index) =>
            item === "separator" ? (
              <div key={`sep-${index}`} className="my-1 h-px bg-line" />
            ) : (
              <button
                key={item.label}
                role="menuitem"
                disabled={item.disabled}
                onClick={() => {
                  setOpen(false);
                  item.onSelect();
                }}
                className={clsx(
                  "flex w-full items-center gap-2.5 px-3 py-1.5 text-left text-[12.5px]",
                  "transition-colors disabled:cursor-not-allowed disabled:opacity-40",
                  item.danger
                    ? "text-danger hover:bg-red-50"
                    : "text-ink-700 hover:bg-slate-100 hover:text-ink-900",
                )}
              >
                {item.icon ? <span className="flex-none text-ink-400">{item.icon}</span> : null}
                <span className="flex-1 truncate">{item.label}</span>
                {item.hint ? (
                  <span className="flex-none text-[11px] text-ink-400">{item.hint}</span>
                ) : null}
              </button>
            ),
          )}
        </div>
      ) : null}
    </div>
  );
}
