import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "./lib/api";
import { Spinner } from "./components/ui";
import { CommandPalette } from "./features/shell/CommandPalette";
import { Sidebar } from "./features/shell/Sidebar";
import { StatusBar } from "./features/shell/StatusBar";
import { TopBar } from "./features/shell/TopBar";
import { SectionRouter } from "./features/shell/SectionRouter";
import { useWorkspaceEvents } from "./hooks/useWorkspaceEvents";
import { ensureActiveTab, seedFirstTab, useWorkspace } from "./store/workspace";

export default function App() {
  const section = useWorkspace((state) => state.section);
  const setDefaultRowLimit = useWorkspace((state) => state.setDefaultRowLimit);
  useWorkspaceEvents();
  useEffect(ensureActiveTab, []);

  const { isLoading, error } = useQuery({ queryKey: ["project"], queryFn: api.project });
  const { data: datasets } = useQuery({ queryKey: ["datasets"], queryFn: () => api.datasets() });
  const { data: settings } = useQuery({ queryKey: ["settings"], queryFn: api.settings });

  // New query tabs inherit the project's "Default row limit" setting.
  useEffect(() => {
    if (settings) setDefaultRowLimit(settings.workspace.defaultRowLimit);
  }, [settings, setDefaultRowLimit]);

  useEffect(() => {
    if (!datasets) return;
    seedFirstTab(
      datasets.datasets
        .filter((dataset) => !dataset.error)
        .map((dataset) => ({ qualifiedName: dataset.qualifiedName, sizeBytes: dataset.sizeBytes })),
    );
  }, [datasets]);

  if (isLoading) {
    return (
      <div className="flex h-full items-center justify-center gap-3 text-[13px] text-ink-500">
        <Spinner size={16} />
        Opening project…
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 px-6 text-center">
        <div className="text-[15px] font-semibold text-ink-900">Localake is not running</div>
        <p className="max-w-md text-[13px] leading-relaxed text-ink-500">
          The workspace could not reach the local server. Start it with{" "}
          <code className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-[12px]">
            localake ~/Data/your-project
          </code>
          .
        </p>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      <TopBar />
      <div className="flex min-h-0 flex-1">
        <Sidebar />
        <SectionRouter section={section} />
      </div>
      <StatusBar />
      <CommandPalette />
    </div>
  );
}
