import { useCallback } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { api, ApiError } from "../lib/api";
import { useWorkspace, type Tab } from "../store/workspace";

export function useQueryRunner(tab: Tab | undefined) {
  const updateTab = useWorkspace((state) => state.updateTab);
  const setResultsTab = useWorkspace((state) => state.setResultsTab);
  const queryClient = useQueryClient();

  const runSql = useCallback(
    async (sql: string) => {
      if (!tab || tab.kind !== "sql" || !sql.trim() || tab.status === "running") return;
      updateTab(tab.id, {
        status: "running", error: undefined, startedAt: Date.now(), queryId: tab.id,
      });
      setResultsTab("results");
      queryClient.removeQueries({ queryKey: ["rows", tab.id] });
      try {
        await api.run({ sql, queryId: tab.id, tabId: tab.id, name: tab.name, limit: tab.limit });
      } catch (error) {
        updateTab(tab.id, {
          status: "failed",
          error: error instanceof ApiError ? error.message : "Could not reach the Localake server",
        });
      }
    },
    [tab, updateTab, setResultsTab, queryClient],
  );

  /** Run the whole tab. */
  const run = useCallback(() => runSql(tab?.sql ?? ""), [runSql, tab?.sql]);

  const cancel = useCallback(async () => {
    if (!tab?.queryId) return;
    try {
      await api.cancel(tab.queryId);
    } catch {
      // The query may have finished between the click and the request.
    }
  }, [tab]);

  return { run, runSql, cancel, running: tab?.status === "running" };
}
