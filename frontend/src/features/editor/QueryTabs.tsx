import clsx from "clsx";
import { FileText, Plus, Table2, X } from "lucide-react";
import { useWorkspace } from "../../store/workspace";

export function QueryTabs() {
  const tabs = useWorkspace((state) => state.tabs);
  const activeTabId = useWorkspace((state) => state.activeTabId);
  const setActiveTab = useWorkspace((state) => state.setActiveTab);
  const closeTab = useWorkspace((state) => state.closeTab);
  const addSqlTab = useWorkspace((state) => state.addSqlTab);

  return (
    <div role="tablist" className="flex flex-none items-center gap-1.5 overflow-x-auto pb-2">
      {tabs.map((tab) => {
        const active = tab.id === activeTabId;
        const Icon = tab.kind === "dataset" ? Table2 : FileText;
        return (
          <div
            key={tab.id}
            role="tab"
            tabIndex={active ? 0 : -1}
            aria-selected={active}
            onClick={() => setActiveTab(tab.id)}
            onKeyDown={(event) => {
              // Tabs must be operable without a mouse: activate, close, and
              // step between them the way an editor's tab strip does.
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                setActiveTab(tab.id);
              } else if (event.key === "Delete" || event.key === "Backspace") {
                event.preventDefault();
                closeTab(tab.id);
              } else if (event.key === "ArrowRight" || event.key === "ArrowLeft") {
                event.preventDefault();
                const step = event.key === "ArrowRight" ? 1 : -1;
                const next = tabs[(tabs.indexOf(tab) + step + tabs.length) % tabs.length];
                if (next) setActiveTab(next.id);
              }
            }}
            onAuxClick={(event) => {
              if (event.button === 1) closeTab(tab.id);
            }}
            className={clsx(
              "group flex h-9 flex-none cursor-default items-center gap-2 rounded-t-lg px-3.5 text-[13px] transition-colors",
              "focus-visible:outline-2 focus-visible:outline-brand-500",
              active
                ? "border border-b-white border-line bg-white font-medium text-ink-900 shadow-[0_-1px_2px_rgb(15_23_42/0.03)]"
                : "text-ink-500 hover:bg-white/70 hover:text-ink-800",
            )}
          >
            <Icon
              size={14}
              className={clsx("flex-none", active ? "text-brand-600" : "text-ink-400")}
            />
            <span className="max-w-[160px] truncate">{tab.name}</span>
            <button
              onClick={(event) => {
                event.stopPropagation();
                closeTab(tab.id);
              }}
              aria-label={`Close ${tab.name}`}
              className={clsx(
                "-mr-1 rounded p-0.5 text-ink-400 transition-colors hover:bg-slate-200 hover:text-ink-700",
                active ? "opacity-100" : "opacity-0 group-hover:opacity-100",
              )}
            >
              <X size={13} />
            </button>
          </div>
        );
      })}
      <button
        onClick={() => addSqlTab()}
        aria-label="New query tab"
        className="flex h-9 w-9 flex-none items-center justify-center rounded-lg text-ink-400 transition-colors hover:bg-white hover:text-ink-700"
      >
        <Plus size={16} />
      </button>
    </div>
  );
}
