"""Pull source-table references out of SQL, using sqlglot's DuckDB dialect."""

from __future__ import annotations

import logging

import sqlglot
from sqlglot import exp

log = logging.getLogger(__name__)


def source_tables(sql: str) -> set[str]:
    """Qualified names a statement reads from.

    CTE names and table-function calls (``read_parquet('…')``) are excluded:
    the first are local aliases, the second are files rather than catalog
    tables, and both would otherwise appear as phantom nodes in the graph.
    """
    statement = sql.strip().rstrip(";")
    if not statement:
        return set()

    try:
        trees = sqlglot.parse(statement, dialect="duckdb")
    except Exception:  # sqlglot raises several unrelated parse errors
        log.debug("could not parse SQL for lineage", exc_info=True)
        return set()

    found: set[str] = set()
    for tree in trees:
        if tree is None:
            continue
        local = {cte.alias_or_name.lower() for cte in tree.find_all(exp.CTE)}
        # The target of a CREATE is an output, not an input.
        produced = {id(node) for node in (_create_target(tree),) if node is not None}
        for table in tree.find_all(exp.Table):
            name = table.name
            if not name or name.lower() in local or id(table) in produced:
                continue
            schema = table.db
            found.add(f"{schema}.{name}".lower() if schema else name.lower())
    return found


def _create_target(tree: exp.Expression) -> exp.Table | None:
    """The table a CREATE statement writes to, if this is one."""
    if not isinstance(tree, exp.Create):
        return None
    target = tree.this
    # CREATE ... AS SELECT wraps the name in a Schema node.
    if isinstance(target, exp.Schema):
        target = target.this
    return target if isinstance(target, exp.Table) else None


def written_table(sql: str) -> str | None:
    """The qualified name a statement creates, if it creates one."""
    statement = sql.strip().rstrip(";")
    try:
        tree = sqlglot.parse_one(statement, dialect="duckdb")
    except Exception:
        return None
    target = _create_target(tree)
    if target is None:
        return None
    schema = target.db
    return f"{schema}.{target.name}".lower() if schema else target.name.lower()
