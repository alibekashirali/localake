import Editor, { type OnMount } from "@monaco-editor/react";
import { useQuery } from "@tanstack/react-query";
import { useCallback, useEffect, useRef } from "react";
import { api } from "../../lib/api";
import { Spinner } from "../../components/ui";
import { defineTheme, monaco, registerCompletions, THEME } from "./monaco";

interface Props {
  value: string;
  onChange: (value: string) => void;
  onRun: () => void;
  onReady?: (editor: monaco.editor.IStandaloneCodeEditor) => void;
}

export function SqlEditor({ value, onChange, onRun, onReady }: Props) {
  const runRef = useRef(onRun);
  runRef.current = onRun;

  const { data: completions } = useQuery({
    queryKey: ["completions"],
    queryFn: api.completions,
    staleTime: 60_000,
  });

  useEffect(() => {
    if (completions) registerCompletions(completions.tables);
  }, [completions]);

  const readyRef = useRef(onReady);
  readyRef.current = onReady;

  const handleMount = useCallback<OnMount>((editor) => {
    defineTheme();
    monaco.editor.setTheme(THEME);
    // Cmd/Ctrl+Enter runs; the ref keeps the binding pointing at the live tab.
    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.Enter, () => runRef.current());
    readyRef.current?.(editor);
    editor.focus();
  }, []);

  return (
    <Editor
      language="sql"
      theme={THEME}
      value={value}
      onChange={(next) => onChange(next ?? "")}
      beforeMount={defineTheme}
      onMount={handleMount}
      loading={<Spinner />}
      options={{
        fontSize: 13,
        lineHeight: 22,
        fontFamily: '"SF Mono", ui-monospace, "JetBrains Mono", Menlo, Consolas, monospace',
        minimap: { enabled: false },
        scrollBeyondLastLine: false,
        renderLineHighlight: "line",
        lineNumbersMinChars: 3,
        glyphMargin: false,
        folding: true,
        padding: { top: 12, bottom: 12 },
        automaticLayout: true,
        smoothScrolling: true,
        scrollbar: { verticalScrollbarSize: 10, horizontalScrollbarSize: 10 },
        overviewRulerLanes: 0,
        suggestFontSize: 12,
        tabSize: 2,
        wordWrap: "off",
      }}
    />
  );
}
