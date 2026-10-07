import clsx from "clsx";
import { useQuery } from "@tanstack/react-query";
import { MoreVertical, Search } from "lucide-react";
import { api } from "../../lib/api";
import { useWorkspace } from "../../store/workspace";
import { Brand } from "./Sidebar";
import { ProjectMenu } from "./ProjectMenu";

export function TopBar() {
  const { data: project } = useQuery({ queryKey: ["project"], queryFn: api.project });
  const setSearchOpen = useWorkspace((state) => state.setSearchOpen);
  const remote = project?.mode === "remote";

  return (
    <header className="flex h-16 flex-none items-center gap-3 pr-4 pl-5">
      <div className="w-[188px] flex-none">
        <Brand />
      </div>

      <div className="flex flex-none items-center gap-1.5 text-ink-400">
        <MoreVertical size={15} />
        <ProjectMenu />
      </div>

      <button
        onClick={() => setSearchOpen(true)}
        className="mx-auto flex h-10 w-full max-w-[500px] items-center gap-2.5 rounded-xl border border-line bg-white px-3.5 text-left shadow-[0_1px_2px_rgb(15_23_42/0.04)] transition-colors hover:border-line-strong"
      >
        <Search size={16} className="flex-none text-ink-400" />
        <span className="text-[13px] text-ink-400">Search tables, columns, queries...</span>
        <kbd className="ml-auto hidden rounded border border-line px-1.5 py-0.5 text-[10px] font-medium text-ink-400 sm:block">
          ⌘K
        </kbd>
      </button>

      <div className="flex flex-none items-center gap-3">
        <div className="flex items-center gap-2.5">
          <span className="relative flex h-2.5 w-2.5">
            <span
              className={clsx(
                "absolute inline-flex h-full w-full rounded-full opacity-60",
                remote ? "bg-amber-400" : "bg-emerald-400",
              )}
            />
            <span
              className={clsx(
                "relative inline-flex h-2.5 w-2.5 rounded-full",
                remote ? "bg-amber-500" : "bg-emerald-500",
              )}
            />
          </span>
          <div className="leading-tight">
            <div className="text-[13px] font-semibold text-ink-900">
              {remote ? "Remote Mode" : "Local Mode"}
            </div>
            <div className="text-[11px] text-ink-500">
              {remote
                ? "No authentication — anyone on the network can reach this"
                : "All data stays on your machine"}
            </div>
          </div>
        </div>
        <div className="flex h-9 w-9 items-center justify-center rounded-full bg-brand-600 text-[13px] font-semibold text-white">
          {(project?.name ?? "L").slice(0, 1).toUpperCase()}
        </div>
      </div>
    </header>
  );
}
