import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronDown, Check, FolderOpen, LayoutGrid, RefreshCw } from "lucide-react";
import { api, ApiError } from "../../lib/api";
import { Menu, type MenuItem } from "../../components/Menu";
import { useWorkspace } from "../../store/workspace";

/** Switches the running server between project directories. */
export function ProjectMenu() {
  const queryClient = useQueryClient();
  const selectDataset = useWorkspace((state) => state.selectDataset);
  const { data: project } = useQuery({ queryKey: ["project"], queryFn: api.project });
  const { data: recent } = useQuery({ queryKey: ["recent-projects"], queryFn: api.recentProjects });

  const open = useMutation({
    mutationFn: api.openProject,
    onSuccess: () => {
      // Everything on screen belonged to the previous project.
      selectDataset(null);
      queryClient.invalidateQueries();
    },
    onError: (error) =>
      window.alert(error instanceof ApiError ? error.message : "Could not open that folder"),
  });

  const choose = () => {
    const path = window.prompt(
      "Open a project folder\n\nEnter the full path to a directory of data files.",
      project?.root ?? "",
    );
    if (path?.trim()) open.mutate(path.trim());
  };

  const items: (MenuItem | "separator")[] = [];
  for (const entry of recent?.recent ?? []) {
    items.push({
      label: entry.name,
      hint: entry.path === project?.root ? undefined : entry.exists ? undefined : "missing",
      icon: entry.path === project?.root ? <Check size={14} className="text-brand-600" /> : null,
      disabled: !entry.exists || entry.path === project?.root,
      onSelect: () => open.mutate(entry.path),
    });
  }
  if (items.length) items.push("separator");
  items.push({ label: "Open folder…", icon: <FolderOpen size={14} />, onSelect: choose });
  items.push({
    label: "Rescan project",
    icon: <RefreshCw size={14} />,
    onSelect: async () => {
      await api.refreshTree();
      queryClient.invalidateQueries();
    },
  });

  return (
    <Menu items={items} align="left">
      {({ toggle }) => (
        <button
          onClick={toggle}
          title={project?.root}
          className="flex items-center gap-2 rounded-lg px-2 py-1.5 transition-colors hover:bg-slate-100"
        >
          <LayoutGrid size={16} className="text-ink-500" />
          <span className="text-[14px] font-semibold text-ink-900">{project?.name ?? "…"}</span>
          <ChevronDown size={15} className="text-ink-400" />
        </button>
      )}
    </Menu>
  );
}
