import { useCallback, useEffect, useRef, useState } from "react";
import { Panel, PanelGroup, PanelResizeHandle } from "react-resizable-panels";
import type { editor as MonacoEditor } from "monaco-editor/esm/vs/editor/editor.api";
import { Card } from "../../components/ui";
import { DataExplorer } from "../explorer/DataExplorer";
import { DatasetView } from "../dataset/DatasetView";
import { EditorToolbar } from "../editor/EditorToolbar";
import { QueryTabs } from "../editor/QueryTabs";
import { SqlEditor } from "../editor/SqlEditor";
import { Inspector } from "../inspector/Inspector";
import { PopularQueries } from "../inspector/PopularQueries";
import { QuickChart } from "../inspector/QuickChart";
import { ResultsPanel } from "../results/ResultsPanel";
import { useQueryRunner } from "../../hooks/useQueryRunner";
import { useWorkspace } from "../../store/workspace";

export function WorkspaceLayout() {
  const tabs = useWorkspace((state) => state.tabs);
  const activeTabId = useWorkspace((state) => state.activeTabId);
  const updateTab = useWorkspace((state) => state.updateTab);
  const tab = tabs.find((entry) => entry.id === activeTabId) ?? tabs[0];
  const editorRef = useRef<MonacoEditor.IStandaloneCodeEditor | null>(null);
  const [hasSelection, setHasSelection] = useState(false);
  const { run, runSql, cancel } = useQueryRunner(tab);

  const onEditorReady = useCallback((instance: MonacoEditor.IStandaloneCodeEditor) => {
    editorRef.current = instance;
    instance.onDidChangeCursorSelection(() => setHasSelection(!!selectedText(instance)));
  }, []);

  useEffect(() => {
    // A query opened from Saved queries or History asks to run itself once.
    if (tab?.pendingRun && tab.sql.trim() && tab.status === "idle") {
      updateTab(tab.id, { pendingRun: false });
      run();
    }
  }, [tab?.id, tab?.pendingRun, tab?.sql, tab?.status, run, updateTab]);

  const runSelection = useCallback(() => {
    const text = editorRef.current ? selectedText(editorRef.current) : "";
    if (text) runSql(text);
  }, [runSql]);

  return (
    <PanelGroup direction="horizontal" autoSaveId="localake.main" className="min-h-0 flex-1 px-3">
      <Panel defaultSize={19} minSize={13} maxSize={32}>
        <DataExplorer />
      </Panel>
      <PanelResizeHandle className="resize-handle" />

      <Panel defaultSize={53} minSize={30}>
        <div className="flex h-full min-h-0 flex-col">
          <QueryTabs />
          {tab?.kind === "dataset" && tab.datasetId ? (
            <DatasetView datasetId={tab.datasetId} />
          ) : tab ? (
            <PanelGroup direction="vertical" autoSaveId="localake.center" className="min-h-0 flex-1">
              <Panel defaultSize={44} minSize={18}>
                <Card className="h-full overflow-hidden">
                  <EditorToolbar
                    tab={tab}
                    onRun={run}
                    onRunSelection={runSelection}
                    onCancel={cancel}
                    hasSelection={hasSelection}
                  />
                  <div className="min-h-0 flex-1">
                    <SqlEditor
                      value={tab.sql}
                      onChange={(sql) => updateTab(tab.id, { sql })}
                      onRun={run}
                      onReady={onEditorReady}
                    />
                  </div>
                </Card>
              </Panel>
              <PanelResizeHandle className="resize-handle" />
              <Panel defaultSize={56} minSize={20}>
                <ResultsPanel tab={tab} />
              </Panel>
            </PanelGroup>
          ) : null}
        </div>
      </Panel>
      <PanelResizeHandle className="resize-handle" />

      <Panel defaultSize={28} minSize={20} maxSize={42}>
        <div className="flex h-full min-h-0 flex-col gap-3">
          <Inspector />
          <QuickChart />
          <PopularQueries />
        </div>
      </Panel>
    </PanelGroup>
  );
}

function selectedText(instance: MonacoEditor.IStandaloneCodeEditor): string {
  const selection = instance.getSelection();
  if (!selection || selection.isEmpty()) return "";
  return instance.getModel()?.getValueInRange(selection).trim() ?? "";
}
