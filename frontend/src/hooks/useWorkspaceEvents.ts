import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { api } from "../lib/api";
import { workspaceSocket } from "../lib/ws";
import { useWorkspace } from "../store/workspace";

/**
 * Bridges server events into the tab store. Mounted once, at the app root.
 *
 * Query results arrive here rather than from the POST that started them, so a
 * long query cannot be lost to a dropped HTTP response or a reload.
 */
export function useWorkspaceEvents(): void {
  const queryClient = useQueryClient();

  // A query whose completion event was missed while the socket was down would
  // otherwise sit in "running" forever; on reconnect, ask the server directly.
  useEffect(() => {
    return workspaceSocket.onOpen(() => {
      const { tabs, updateTab } = useWorkspace.getState();
      for (const tab of tabs) {
        if (tab.status !== "running" || !tab.queryId) continue;
        api
          .queryState(tab.queryId)
          .then((state) => {
            if (state.status === "running") return;
            if (state.status === "completed" && state.result) {
              updateTab(tab.id, {
                status: "completed",
                result: state.result,
                queryId: tab.queryId,
                error: undefined,
                progress: undefined,
              });
              queryClient.invalidateQueries({ queryKey: ["rows", tab.queryId] });
              queryClient.invalidateQueries({ queryKey: ["history"] });
            } else if (state.status === "failed") {
              updateTab(tab.id, { status: "failed", error: state.error, result: undefined });
              queryClient.invalidateQueries({ queryKey: ["history"] });
            } else if (state.status === "cancelled") {
              updateTab(tab.id, { status: "cancelled", result: undefined });
            }
          })
          .catch(() => {});
      }
    });
  }, [queryClient]);

  useEffect(() => {
    return workspaceSocket.subscribe((event) => {
      const { updateTab, tabs } = useWorkspace.getState();
      switch (event.type) {
        case "catalog.updated":
          queryClient.invalidateQueries({ queryKey: ["tree"] });
          queryClient.invalidateQueries({ queryKey: ["datasets"] });
          queryClient.invalidateQueries({ queryKey: ["completions"] });
          break;
        case "query.running":
          if (event.tabId) {
            updateTab(event.tabId, { status: "running", error: undefined, progress: undefined });
          }
          break;
        case "query.progress":
          if (event.tabId) updateTab(event.tabId, { progress: event.percent });
          break;
        case "query.completed":
          if (event.tabId) {
            updateTab(event.tabId, {
              status: "completed",
              result: event.result,
              queryId: event.queryId,
              error: undefined,
              progress: undefined,
            });
            queryClient.invalidateQueries({ queryKey: ["rows", event.queryId] });
            queryClient.invalidateQueries({ queryKey: ["history"] });
          }
          break;
        case "query.failed":
          if (event.tabId) {
            updateTab(event.tabId, { status: "failed", error: event.error, result: undefined });
            queryClient.invalidateQueries({ queryKey: ["history"] });
          }
          break;
        case "query.cancelled":
          if (event.tabId) updateTab(event.tabId, { status: "cancelled", result: undefined });
          break;
        default:
          break;
      }
      void tabs;
    });
  }, [queryClient]);
}
