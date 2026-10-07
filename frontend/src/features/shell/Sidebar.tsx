import clsx from "clsx";
import {
  BarChart3, Download, FolderTree, History, Home,
  NotebookText, Settings, Share2, SquareTerminal,
} from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { api } from "../../lib/api";
import { formatBytes } from "../../lib/format";
import { Logo } from "../../components/Logo";
import { useWorkspace, type Section } from "../../store/workspace";

const NAV: { id: Section; label: string; icon: typeof Home }[] = [
  { id: "home", label: "Home", icon: Home },
  { id: "explorer", label: "Explorer", icon: FolderTree },
  { id: "sql", label: "SQL Editor", icon: SquareTerminal },
  { id: "notebooks", label: "Notebooks", icon: NotebookText },
  { id: "charts", label: "Charts", icon: BarChart3 },
  { id: "lineage", label: "Lineage", icon: Share2 },
  { id: "imports", label: "Imports", icon: Download },
  { id: "history", label: "History", icon: History },
  { id: "settings", label: "Settings", icon: Settings },
];

/** Rough capacity readout — the disk the project lives on, not a quota. */
const STORAGE_CAPACITY_BYTES = 500 * 1024 ** 3;

export function Brand() {
  return (
    <div className="flex items-center gap-2.5">
      <Logo size={30} />
      <span className="text-[19px] font-semibold tracking-[-0.025em] text-ink-900">Localake</span>
    </div>
  );
}

export function Sidebar() {
  const section = useWorkspace((state) => state.section);
  const setSection = useWorkspace((state) => state.setSection);
  const { data: project } = useQuery({ queryKey: ["project"], queryFn: api.project });
  const used = useSizeOnDisk();

  return (
    <aside className="flex w-[212px] flex-none flex-col gap-3 px-3 pb-3">
      <nav className="flex flex-col gap-0.5">
        {NAV.map(({ id, label, icon: Icon }) => {
          const active = section === id;
          return (
            <button
              key={id}
              onClick={() => setSection(id)}
              className={clsx(
                "flex items-center gap-3 rounded-lg px-3 py-2 text-[13px] transition-colors",
                active
                  ? "bg-brand-50 font-semibold text-brand-700"
                  : "font-medium text-ink-600 hover:bg-slate-100 hover:text-ink-900",
              )}
            >
              <Icon size={17} strokeWidth={active ? 2.1 : 1.8} />
              {label}
            </button>
          );
        })}
      </nav>

      <div className="mt-auto flex flex-col gap-2.5">
        <div className="card px-3.5 py-3">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <div className="text-[11px] text-ink-500">Project</div>
              <div className="truncate text-[14px] font-semibold text-ink-900">
                {project?.name ?? "—"}
              </div>
              <div className="truncate text-[11px] text-ink-500">{project?.displayRoot ?? ""}</div>
            </div>
            <Settings size={15} className="mt-0.5 flex-none text-ink-400" />
          </div>
        </div>

        <div className="card px-3.5 py-3">
          <div className="text-[11px] font-medium text-ink-600">Storage</div>
          <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-slate-200">
            <div
              className="h-full rounded-full bg-brand-600"
              style={{ width: `${Math.min(100, Math.max(2, (used / STORAGE_CAPACITY_BYTES) * 100))}%` }}
            />
          </div>
          <div className="mt-1.5 text-[11px] text-ink-500 num">
            {formatBytes(used)} / {formatBytes(STORAGE_CAPACITY_BYTES)}
          </div>
        </div>

      </div>
    </aside>
  );
}

/** Total bytes of every registered dataset, used for the storage meter. */
function useSizeOnDisk(): number {
  const { data } = useQuery({ queryKey: ["datasets"], queryFn: () => api.datasets() });
  return data?.datasets.reduce((total, dataset) => total + dataset.sizeBytes, 0) ?? 0;
}
