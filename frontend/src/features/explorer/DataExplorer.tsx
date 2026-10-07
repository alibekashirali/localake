import clsx from "clsx";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ChevronDown, ChevronRight, ChevronsDownUp, Copy, FileJson, FileText, Folder,
  FolderOpen, MoreHorizontal, Plus, RefreshCw, Sheet, Table2, TriangleAlert,
} from "lucide-react";
import { api } from "../../lib/api";
import type { TreeNode } from "../../lib/types";
import { Card, CardHeader, IconButton, Spinner } from "../../components/ui";
import { Menu } from "../../components/Menu";
import { useWorkspace } from "../../store/workspace";

const INDENT = 14;

export function DataExplorer() {
  const queryClient = useQueryClient();
  const { data, isLoading } = useQuery({ queryKey: ["tree"], queryFn: api.tree });
  const addSqlTab = useWorkspace((state) => state.addSqlTab);
  const collapseAll = useWorkspace((state) => state.collapseAll);
  const { data: project } = useQuery({ queryKey: ["project"], queryFn: api.project });
  const projectRoot = project?.root;

  const refresh = async () => {
    const next = await api.refreshTree();
    queryClient.setQueryData(["tree"], next);
    queryClient.invalidateQueries({ queryKey: ["datasets"] });
    queryClient.invalidateQueries({ queryKey: ["completions"] });
  };

  return (
    <Card className="h-full">
      <CardHeader
        title="Data Explorer"
        actions={
          <>
            <IconButton label="New query" onClick={() => addSqlTab()}>
              <Plus size={16} />
            </IconButton>
            <IconButton label="Rescan project" onClick={refresh}>
              <RefreshCw size={14} />
            </IconButton>
            <Menu
              items={[
                { label: "Rescan project", icon: <RefreshCw size={14} />, onSelect: refresh },
                {
                  label: "Collapse all",
                  icon: <ChevronsDownUp size={14} />,
                  onSelect: collapseAll,
                },
                "separator",
                {
                  label: "Copy project path",
                  icon: <Copy size={14} />,
                  onSelect: () => navigator.clipboard?.writeText(projectRoot ?? ""),
                },
              ]}
            >
              {({ toggle }) => (
                <IconButton label="Explorer options" onClick={toggle}>
                  <MoreHorizontal size={16} />
                </IconButton>
              )}
            </Menu>
          </>
        }
      />
      <div className="min-h-0 flex-1 overflow-auto px-2 pb-3">
        {isLoading ? (
          <div className="flex justify-center py-6">
            <Spinner />
          </div>
        ) : (
          (data?.tree.children ?? []).map((node) => (
            <TreeRow key={node.id} node={node} depth={0} />
          ))
        )}
      </div>
    </Card>
  );
}

function TreeRow({ node, depth }: { node: TreeNode; depth: number }) {
  const expanded = useWorkspace((state) => state.expanded[node.path] ?? false);
  const toggleExpanded = useWorkspace((state) => state.toggleExpanded);
  const selectedDatasetId = useWorkspace((state) => state.selectedDatasetId);
  const openDatasetTab = useWorkspace((state) => state.openDatasetTab);
  const selectDataset = useWorkspace((state) => state.selectDataset);

  const isFolder = node.kind === "folder";
  const selected = node.kind === "dataset" && selectedDatasetId === node.datasetId;

  const activate = () => {
    if (isFolder) {
      toggleExpanded(node.path);
      return;
    }
    if (node.kind === "dataset" && node.datasetId) {
      selectDataset(node.datasetId);
    }
  };

  return (
    <>
      <div
        role="treeitem"
        aria-expanded={isFolder ? expanded : undefined}
        aria-selected={selected}
        tabIndex={0}
        onClick={activate}
        title={node.error ?? undefined}
        onDoubleClick={() => {
          if (node.kind === "dataset" && node.datasetId) openDatasetTab(node.datasetId, node.name);
        }}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            activate();
          }
        }}
        style={{ paddingLeft: 6 + depth * INDENT }}
        className={clsx(
          "group flex cursor-default items-center gap-2 rounded-lg py-[5px] pr-2 text-[13px] transition-colors",
          selected
            ? "bg-brand-50 font-medium text-brand-700"
            : "text-ink-700 hover:bg-slate-100",
        )}
      >
        {isFolder ? (
          <span className="flex-none text-ink-400">
            {expanded ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
          </span>
        ) : (
          <span className="w-[13px] flex-none" />
        )}
        <NodeIcon node={node} expanded={expanded} selected={selected} />
        <span className={clsx("truncate", node.error && "text-ink-400 line-through decoration-ink-300")}>
          {node.name}
        </span>
        {node.error ? (
          <TriangleAlert size={13} className="ml-auto flex-none text-warn" />
        ) : null}
      </div>
      {isFolder && expanded
        ? (node.children ?? []).map((child) => (
            <TreeRow key={child.id} node={child} depth={depth + 1} />
          ))
        : null}
    </>
  );
}

function NodeIcon({
  node, expanded, selected,
}: { node: TreeNode; expanded: boolean; selected: boolean }) {
  const tint = selected ? "text-brand-600" : "text-ink-400";
  if (node.kind === "folder") {
    const Icon = expanded ? FolderOpen : Folder;
    return <Icon size={15} className={clsx("flex-none", tint)} strokeWidth={1.8} />;
  }
  if (node.kind === "file") {
    return <FileText size={15} className={clsx("flex-none", tint)} strokeWidth={1.8} />;
  }
  // Datasets carry a format hint so Parquet, CSV and JSON stay distinguishable.
  const Icon = node.format === "csv" ? Sheet : node.format === "json" ? FileJson : Table2;
  return (
    <Icon
      size={15}
      className={clsx("flex-none", selected ? "text-brand-600" : "text-ink-500")}
      strokeWidth={1.8}
    />
  );
}
