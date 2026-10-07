import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { AlignLeft, ChevronDown, Copy, Play, Save, Share2, Square, TextSelect } from "lucide-react";
import { format as formatSql } from "sql-formatter";
import { Button } from "../../components/ui";
import { Menu } from "../../components/Menu";
import { api } from "../../lib/api";
import { DEFAULT_LIMIT, useWorkspace, type Tab } from "../../store/workspace";

const LIMITS = [100, 1000, 10_000, 100_000, 1_000_000];

interface Props {
  tab: Tab;
  onRun: () => void;
  onRunSelection: () => void;
  onCancel: () => void;
  hasSelection: boolean;
}

export function EditorToolbar({ tab, onRun, onRunSelection, onCancel, hasSelection }: Props) {
  const updateTab = useWorkspace((state) => state.updateTab);
  const queryClient = useQueryClient();
  const [limitOpen, setLimitOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const running = tab.status === "running";

  const applyFormat = () => {
    try {
      updateTab(tab.id, {
        sql: formatSql(tab.sql, { language: "duckdb", keywordCase: "upper", tabWidth: 4 }),
      });
    } catch {
      // Formatting is best-effort: unparseable SQL is left exactly as typed.
    }
  };

  const save = async () => {
    const name = window.prompt("Save query as", tab.name);
    if (!name) return;
    setSaving(true);
    try {
      const saved = await api.saveQuery({ id: tab.savedQueryId, name, sql: tab.sql });
      updateTab(tab.id, { name: saved.name, savedQueryId: saved.id });
      queryClient.invalidateQueries({ queryKey: ["saved-queries"] });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex flex-none items-center gap-2 border-b border-line px-3 py-2.5">
      <div className="flex items-center">
        {running ? (
          <Button variant="danger" icon={<Square size={13} className="fill-current" />} onClick={onCancel}>
            Stop
          </Button>
        ) : (
          <Button
            variant="primary"
            icon={<Play size={14} className="fill-current" />}
            onClick={onRun}
            disabled={!tab.sql.trim()}
            className="rounded-r-none pr-3"
          >
            Run
          </Button>
        )}
        {running ? null : (
          <Menu
            align="left"
            items={[
              { label: "Run all", icon: <Play size={14} />, hint: "⌘↵", onSelect: onRun },
              {
                label: "Run selection",
                icon: <TextSelect size={14} />,
                onSelect: onRunSelection,
                disabled: !hasSelection,
              },
              "separator",
              {
                label: "Copy SQL",
                icon: <Copy size={14} />,
                onSelect: () => navigator.clipboard?.writeText(tab.sql),
              },
            ]}
          >
            {({ toggle }) => (
              <button
                onClick={toggle}
                title="Run options"
                className="flex h-9 items-center rounded-r-lg border-l border-brand-700/30 bg-brand-600 px-2 text-white transition-colors hover:bg-brand-700"
              >
                <ChevronDown size={14} />
              </button>
            )}
          </Menu>
        )}
      </div>

      <div className="relative">
        <button
          onClick={() => setLimitOpen((open) => !open)}
          onBlur={() => window.setTimeout(() => setLimitOpen(false), 120)}
          className="flex h-9 items-center gap-2 rounded-lg border border-line bg-white px-3 text-[13px] font-medium text-ink-700 transition-colors hover:border-line-strong"
        >
          Limit {(tab.limit ?? DEFAULT_LIMIT).toLocaleString()}
          <ChevronDown size={14} className="text-ink-400" />
        </button>
        {limitOpen ? (
          <div className="absolute top-full left-0 z-30 mt-1 w-36 overflow-hidden rounded-lg border border-line bg-white py-1 shadow-[var(--shadow-pop)]">
            {LIMITS.map((limit) => (
              <button
                key={limit}
                onMouseDown={() => {
                  updateTab(tab.id, { limit });
                  setLimitOpen(false);
                }}
                className="block w-full px-3 py-1.5 text-left text-[13px] text-ink-700 hover:bg-slate-100"
              >
                {limit.toLocaleString()} rows
              </button>
            ))}
          </div>
        ) : null}
      </div>

      <div className="ml-auto flex items-center gap-2">
        <Button icon={<Save size={14} />} onClick={save} loading={saving}>
          Save
        </Button>
        <Button
          icon={<Share2 size={14} />}
          onClick={() => navigator.clipboard?.writeText(tab.sql)}
          title="Copy SQL to clipboard"
        >
          Share
        </Button>
        <Button icon={<AlignLeft size={14} />} onClick={applyFormat}>
          Format
        </Button>
      </div>
    </div>
  );
}
