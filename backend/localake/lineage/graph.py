"""Assemble the lineage graph from the catalog, saved queries and charts."""

from __future__ import annotations

from typing import Any, Iterable

from ..catalog.types import Dataset
from .parser import source_tables, written_table


def _node(node_id: str, kind: str, label: str, **extra: Any) -> dict[str, Any]:
    return {"id": node_id, "kind": kind, "label": label, **extra}


def build_graph(
    datasets: Iterable[Dataset],
    queries: list[dict[str, Any]],
    charts: list[dict[str, Any]],
    views: list[dict[str, str]] | None = None,
) -> dict[str, Any]:
    """A DAG of files → tables → views/queries → charts.

    Edges come from parsing SQL, so anything the parser cannot read simply
    contributes no edges rather than breaking the graph.
    """
    nodes: dict[str, dict[str, Any]] = {}
    edges: list[dict[str, str]] = []
    by_table: dict[str, str] = {}

    def add(node: dict[str, Any]) -> str:
        nodes.setdefault(node["id"], node)
        return node["id"]

    def link(source: str, target: str) -> None:
        if source != target and {"source": source, "target": target} not in edges:
            edges.append({"source": source, "target": target})

    # Files feed the tables that read them.
    for dataset in datasets:
        file_id = f"file:{dataset.id}"
        table_id = f"table:{dataset.display_name}"
        add(_node(file_id, "file", dataset.path.split("/")[-1], format=dataset.format,
                  sizeBytes=dataset.size_bytes, path=dataset.path))
        add(_node(table_id, "table", dataset.display_name, datasetId=dataset.id,
                  format=dataset.format, error=dataset.error))
        link(file_id, table_id)
        by_table[dataset.display_name.lower()] = table_id
        # Unqualified references resolve too, when unambiguous.
        by_table.setdefault(dataset.table_name.lower(), table_id)

    # User-created views sit between their sources and whatever reads them.
    for view in views or []:
        name = f"{view['schema']}.{view['name']}".lower()
        if name in by_table:
            continue
        view_id = add(_node(f"view:{name}", "view", name))
        by_table[name] = view_id
        by_table.setdefault(view["name"].lower(), view_id)
        for source in source_tables(view.get("sql", "")):
            if source in by_table:
                link(by_table[source], view_id)

    def attach(node_id: str, sql: str) -> None:
        for source in source_tables(sql):
            if source in by_table:
                link(by_table[source], node_id)

    for query in queries:
        query_id = add(_node(f"query:{query['id']}", "query",
                             query.get("name") or "Untitled query", sql=query.get("sql", "")))
        attach(query_id, query.get("sql", ""))
        # A query that creates a view also produces one.
        produced = written_table(query.get("sql", ""))
        if produced and produced in by_table:
            link(query_id, by_table[produced])

    for chart in charts:
        chart_id = add(_node(f"chart:{chart['id']}", "chart",
                             chart.get("name") or "Untitled chart",
                             chartType=chart.get("type")))
        attach(chart_id, chart.get("sql", ""))

    return {"nodes": list(nodes.values()), "edges": edges}


def focus(graph: dict[str, Any], node_id: str, depth: int = 2) -> dict[str, Any]:
    """The neighbourhood around one node, upstream and downstream."""
    keep = {node_id}
    for _ in range(max(1, depth)):
        for edge in graph["edges"]:
            if edge["source"] in keep or edge["target"] in keep:
                keep.update((edge["source"], edge["target"]))
    return {
        "nodes": [n for n in graph["nodes"] if n["id"] in keep],
        "edges": [e for e in graph["edges"] if e["source"] in keep and e["target"] in keep],
    }
