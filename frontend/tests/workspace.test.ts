import { beforeEach, describe, expect, it } from "vitest";
import { ensureActiveTab, seedFirstTab, useWorkspace } from "../src/store/workspace";

/** Reset the singleton store to a known state before each test. */
function resetStore() {
  useWorkspace.setState({
    section: "sql",
    tabs: [
      {
        id: "tab_1",
        kind: "sql",
        name: "Query 1",
        sql: "",
        limit: 1000,
        status: "idle",
        seeded: false,
      },
    ],
    activeTabId: "tab_1",
    selectedDatasetId: null,
    expanded: {},
    inspectorTab: "schema",
    resultsTab: "results",
    searchOpen: false,
    defaultRowLimit: 1000,
  });
}

beforeEach(resetStore);

describe("workspace store", () => {
  it("numbers new query tabs sequentially", () => {
    useWorkspace.getState().addSqlTab();
    const names = useWorkspace.getState().tabs.map((tab) => tab.name);
    expect(names).toEqual(["Query 1", "Query 2"]);
  });

  it("uses defaultRowLimit for new tabs", () => {
    useWorkspace.getState().setDefaultRowLimit(500);
    const id = useWorkspace.getState().addSqlTab();
    const tab = useWorkspace.getState().tabs.find((entry) => entry.id === id);
    expect(tab?.limit).toBe(500);
  });

  it("closing the active tab focuses its neighbour", () => {
    const second = useWorkspace.getState().addSqlTab(); // becomes active
    useWorkspace.getState().closeTab(second);

    const { tabs, activeTabId } = useWorkspace.getState();
    expect(tabs.map((tab) => tab.name)).toEqual(["Query 1"]);
    expect(activeTabId).toBe("tab_1");
  });

  it("reuses an existing dataset tab instead of duplicating it", () => {
    const first = useWorkspace.getState().openDatasetTab("ds/orders", "orders");
    const again = useWorkspace.getState().openDatasetTab("ds/orders", "orders");
    expect(again).toBe(first);
    expect(
      useWorkspace.getState().tabs.filter((tab) => tab.datasetId === "ds/orders"),
    ).toHaveLength(1);
  });

  it("seeds the first empty tab with the biggest table", () => {
    seedFirstTab([
      { qualifiedName: "small.table", sizeBytes: 10 },
      { qualifiedName: "big.table", sizeBytes: 999 },
    ]);
    const tab = useWorkspace.getState().tabs[0];
    expect(tab?.sql).toContain("big.table");
    expect(tab?.seeded).toBe(true);
  });

  it("does not re-seed an already seeded tab", () => {
    useWorkspace.getState().updateTab("tab_1", { seeded: true, sql: "SELECT 1" });
    seedFirstTab([{ qualifiedName: "big.table", sizeBytes: 999 }]);
    expect(useWorkspace.getState().tabs[0]?.sql).toBe("SELECT 1");
  });

  it("ensureActiveTab points activeTabId at an existing tab", () => {
    useWorkspace.setState({ activeTabId: "does-not-exist" });
    ensureActiveTab();
    expect(useWorkspace.getState().activeTabId).toBe("tab_1");
  });
});
