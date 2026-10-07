"""End-to-end API tests against a temporary project."""

from __future__ import annotations

import json
from pathlib import Path

import duckdb
import pytest
from fastapi.testclient import TestClient

from localake.app import create_app


@pytest.fixture(scope="module")
def project(tmp_path_factory) -> Path:
    root = tmp_path_factory.mktemp("ecommerce")
    (root / "analytics").mkdir()
    (root / "raw").mkdir()
    con = duckdb.connect()
    con.execute(
        """
        CREATE TABLE orders AS
        SELECT 10000 + i AS order_id,
               TIMESTAMP '2024-01-01' + INTERVAL (i * 7) DAY AS created_at,
               CASE WHEN i % 10 = 0 THEN NULL ELSE 'paid' END AS status,
               (i * 3.5)::DOUBLE AS total_amount
        FROM range(1, 61) t(i)
        """
    )
    con.execute(f"COPY orders TO '{root / 'analytics' / 'orders.parquet'}' (FORMAT PARQUET)")
    con.execute(f"COPY orders TO '{root / 'raw' / 'orders_export.csv'}' (FORMAT CSV, HEADER)")
    (root / "README.md").write_text("# test project\n")
    con.close()
    return root


@pytest.fixture(scope="module")
def client(project: Path):
    with TestClient(create_app(project, watch=False)) as test_client:
        yield test_client


def wait_for(client: TestClient, query_id: str, timeout: float = 10.0) -> dict:
    """Poll the run state until the background task settles."""
    import time

    deadline = time.time() + timeout
    while time.time() < deadline:
        state = client.get(f"/api/query/{query_id}").json()
        if state["status"] != "running":
            return state
        time.sleep(0.02)
    raise AssertionError(f"query {query_id} did not finish")


def test_project_and_tree(client: TestClient) -> None:
    project = client.get("/api/project").json()
    assert project["datasetCount"] == 2
    assert project["engine"] == "duckdb"

    tree = client.get("/api/tree").json()["tree"]
    names = {child["name"] for child in tree["children"]}
    assert {"analytics", "raw", "README.md"} <= names


def test_dataset_schema_reports_null_rate(client: TestClient) -> None:
    body = client.get("/api/datasets/analytics/orders.parquet/schema").json()
    columns = {column["name"]: column for column in body["columns"]}
    assert columns["order_id"]["type"] == "BIGINT"
    assert columns["order_id"]["nullRate"] == pytest.approx(0.0)
    # Every tenth row has a NULL status.
    assert columns["status"]["nullRate"] == pytest.approx(10.0, abs=0.1)
    assert columns["created_at"]["category"] == "temporal"


def test_dataset_stats_and_preview(client: TestClient) -> None:
    detail = client.get("/api/datasets/analytics/orders.parquet").json()
    assert detail["stats"] == {"rows": 60, "columns": 4, "sizeBytes": detail["sizeBytes"]}

    preview = client.get("/api/datasets/analytics/orders.parquet/preview?limit=3").json()
    assert len(preview["rows"]) == 3
    assert [c["name"] for c in preview["columns"]][:2] == ["order_id", "created_at"]


def test_csv_dataset_is_queryable(client: TestClient) -> None:
    body = client.get("/api/datasets/raw/orders_export.csv/schema").json()
    assert [c["name"] for c in body["columns"]] == [
        "order_id", "created_at", "status", "total_amount",
    ]


def test_query_run_page_sort_and_search(client: TestClient) -> None:
    response = client.post(
        "/api/query",
        json={"sql": "SELECT status, count(*) AS n FROM analytics.orders GROUP BY 1 ORDER BY 1", "limit": 100},
    )
    assert response.status_code == 202
    query_id = response.json()["queryId"]
    state = wait_for(client, query_id)
    assert state["status"] == "completed"
    assert state["result"]["rowCount"] == 2
    assert [c["name"] for c in state["result"]["columns"]] == ["status", "n"]

    page = client.get(f"/api/query/{query_id}/rows?limit=10").json()
    assert page["total"] == 2

    sorted_desc = client.get(f"/api/query/{query_id}/rows?sort=n&desc=true").json()
    assert sorted_desc["rows"][0][1] >= sorted_desc["rows"][1][1]

    filtered = client.get(f"/api/query/{query_id}/rows?search=paid").json()
    assert filtered["total"] == 1


def test_query_limit_truncates(client: TestClient) -> None:
    query_id = client.post(
        "/api/query", json={"sql": "SELECT * FROM analytics.orders", "limit": 10}
    ).json()["queryId"]
    state = wait_for(client, query_id)
    assert state["result"]["rowCount"] == 10
    assert state["result"]["truncated"] is True
    assert client.get(f"/api/query/{query_id}/rows?limit=100").json()["total"] == 10


def test_query_failure_reports_a_readable_message(client: TestClient) -> None:
    query_id = client.post(
        "/api/query", json={"sql": "SELECT revenue_usd FROM analytics.orders"}
    ).json()["queryId"]
    state = wait_for(client, query_id)
    assert state["status"] == "failed"
    assert "revenue_usd" in state["error"]


def test_explain_falls_back_to_an_in_memory_result(client: TestClient) -> None:
    query_id = client.post(
        "/api/query", json={"sql": "EXPLAIN SELECT count(*) FROM analytics.orders"}
    ).json()["queryId"]
    state = wait_for(client, query_id)
    assert state["status"] == "completed"
    assert client.get(f"/api/query/{query_id}/rows").json()["total"] >= 1


def test_export_csv(client: TestClient) -> None:
    query_id = client.post(
        "/api/query", json={"sql": "SELECT 1 AS a, 'x' AS b"}
    ).json()["queryId"]
    wait_for(client, query_id)
    response = client.get(f"/api/query/{query_id}/export?format=csv")
    assert response.status_code == 200
    assert response.text.splitlines() == ["a,b", "1,x"]


def test_export_streams_the_full_result(client: TestClient) -> None:
    """Export must not silently stop at a fixed row cap."""
    n = 100_050  # just past the old 100k truncation point
    query_id = client.post(
        "/api/query", json={"sql": f"SELECT i AS n FROM range(1, {n + 1}) t(i)", "limit": n}
    ).json()["queryId"]
    state = wait_for(client, query_id)
    assert state["status"] == "completed"
    assert state["result"]["rowCount"] == n

    response = client.get(f"/api/query/{query_id}/export?format=csv")
    assert response.status_code == 200
    lines = response.text.splitlines()
    assert len(lines) == n + 1            # header plus every row
    assert lines[0] == "n"
    assert lines[-1] == str(n)
    client.delete(f"/api/query/{query_id}")


def test_dataset_profile(client: TestClient) -> None:
    profile = client.get("/api/datasets/analytics/orders.parquet/profile").json()
    assert profile["stats"]["rows"] == 60
    assert profile["duplicateRate"] == pytest.approx(0.0)
    columns = {column["name"]: column for column in profile["columns"]}
    assert columns["total_amount"]["avg"] == pytest.approx(3.5 * 30.5, rel=0.01)
    assert columns["status"]["nullRate"] == pytest.approx(10.0, abs=0.1)


def test_query_summary_and_plan(client: TestClient) -> None:
    query_id = client.post(
        "/api/query",
        json={"sql": "SELECT status, count(*) AS n FROM analytics.orders GROUP BY 1"},
    ).json()["queryId"]
    wait_for(client, query_id)

    summary = client.get(f"/api/query/{query_id}/summary").json()
    names = [column["name"] for column in summary["columns"]]
    assert {"column_name", "min", "max", "null_percentage"} <= set(names)
    assert len(summary["rows"]) == 2

    plan = client.get(f"/api/query/{query_id}/plan").json()
    assert "AGGREGATE" in plan["plan"].upper()


def test_a_user_view_survives_a_catalog_rescan(client: TestClient) -> None:
    query_id = client.post(
        "/api/query",
        json={"sql": "CREATE OR REPLACE VIEW analytics.recent AS SELECT * FROM analytics.orders LIMIT 5"},
    ).json()["queryId"]
    assert wait_for(client, query_id)["status"] == "completed"

    client.post("/api/tree/refresh")

    check = client.post("/api/query", json={"sql": "SELECT count(*) FROM analytics.recent"}).json()
    state = wait_for(client, check["queryId"])
    assert state["status"] == "completed", state.get("error")


def test_saved_queries_roundtrip(client: TestClient) -> None:
    saved = client.post(
        "/api/queries", json={"name": "Monthly revenue", "sql": "SELECT 1"}
    ).json()
    assert saved["name"] == "Monthly revenue"
    listed = client.get("/api/queries").json()["queries"]
    assert any(item["id"] == saved["id"] for item in listed)
    assert client.delete(f"/api/queries/{saved['id']}").json()["deleted"] is True
    assert client.delete(f"/api/queries/{saved['id']}").status_code == 404


def test_history_records_runs(client: TestClient) -> None:
    entries = client.get("/api/history").json()["entries"]
    assert entries, "expected earlier tests to have populated history"
    assert entries[0]["startedAt"] >= entries[-1]["startedAt"]
    failed = client.get("/api/history?status=failed").json()["entries"]
    assert all(entry["status"] == "failed" for entry in failed)


def test_search_finds_tables_and_columns(client: TestClient) -> None:
    groups = {g["kind"]: g for g in client.get("/api/search?q=total").json()["groups"]}
    assert "columns" in groups
    assert any("total_amount" in item["label"] for item in groups["columns"]["items"])


def test_search_query_results_carry_sql(client: TestClient) -> None:
    """The palette needs the full SQL to open a saved query in a new tab."""
    saved = client.post(
        "/api/queries", json={"name": "Search me", "sql": "SELECT 'findable' AS x"}
    ).json()
    groups = {g["kind"]: g["items"] for g in client.get("/api/search?q=findable").json()["groups"]}
    item = next(i for i in groups["queries"] if i["queryId"] == saved["id"])
    assert item["sql"] == "SELECT 'findable' AS x"
    client.delete(f"/api/queries/{saved['id']}")


def test_completions_expose_columns(client: TestClient) -> None:
    tables = client.get("/api/completions").json()["tables"]
    orders = next(t for t in tables if t["qualifiedName"] == "analytics.orders")
    assert {c["name"] for c in orders["columns"]} == {
        "order_id", "created_at", "status", "total_amount",
    }


def test_websocket_receives_query_events(client: TestClient) -> None:
    with client.websocket_connect("/ws") as socket:
        assert socket.receive_json()["type"] == "hello"
        query_id = client.post("/api/query", json={"sql": "SELECT 42 AS answer"}).json()["queryId"]
        seen = []
        for _ in range(4):
            message = socket.receive_json()
            if message["type"] == "ping":
                continue
            seen.append(message["type"])
            if message["type"] in {"query.completed", "query.failed"}:
                assert message["queryId"] == query_id
                break
        assert "query.running" in seen
        assert "query.completed" in seen


def test_websocket_follows_a_project_switch(tmp_path_factory) -> None:
    """A live socket must re-subscribe to the new project's event hub."""
    root_a = tmp_path_factory.mktemp("proj-a")
    root_b = tmp_path_factory.mktemp("proj-b")

    with TestClient(create_app(root_a, watch=False)) as client:
        with client.websocket_connect("/ws") as socket:
            hello_a = socket.receive_json()
            assert hello_a["type"] == "hello"
            assert hello_a["project"] == root_a.name

            client.post("/api/project", json={"path": str(root_b)})

            # The socket wakes, drops the old hub, and greets the new project.
            hello_b = socket.receive_json()
            assert hello_b["type"] == "hello"
            assert hello_b["project"] == root_b.name


def test_unknown_dataset_is_404(client: TestClient) -> None:
    assert client.get("/api/datasets/nope/missing.parquet/schema").status_code == 404


def test_unreadable_file_reports_its_real_reason(tmp_path_factory) -> None:
    """A corrupt file must explain itself, not surface as a missing table."""
    root = tmp_path_factory.mktemp("broken")
    (root / "corrupt.parquet").write_text("this is definitely not parquet")
    (root / "bad.json").write_text("{{{ not json")

    with TestClient(create_app(root, watch=False)) as client:
        datasets = {d["id"]: d for d in client.get("/api/datasets").json()["datasets"]}
        assert "magic bytes" in (datasets["corrupt.parquet"]["error"] or "").lower()

        response = client.get("/api/datasets/corrupt.parquet/schema")
        assert response.status_code == 422
        detail = response.json()["detail"]
        assert "magic bytes" in detail.lower()
        assert "does not exist" not in detail

        assert client.get("/api/datasets/corrupt.parquet/preview").status_code == 422
        assert client.get("/api/datasets/corrupt.parquet/profile").status_code == 422

        # The tree marks them so the explorer can too.
        tree = client.get("/api/tree").json()["tree"]
        errors = {c["name"]: c.get("error") for c in tree["children"] if c["kind"] == "dataset"}
        assert errors["corrupt"] and errors["bad"]


def test_an_empty_project_still_opens(tmp_path_factory) -> None:
    root = tmp_path_factory.mktemp("empty")
    with TestClient(create_app(root, watch=False)) as client:
        assert client.get("/api/health").json()["status"] == "ok"
        assert client.get("/api/project").json()["datasetCount"] == 0
        assert client.get("/api/completions").json()["tables"] == []
        assert client.get("/api/search?q=anything").json()["groups"] == []
        # Scaffolded folders exist but hold nothing yet.
        names = {c["name"] for c in client.get("/api/tree").json()["tree"]["children"]}
        assert {"raw", "analytics", "external"} <= names


def test_project_and_health_report_the_bind_mode(tmp_path_factory) -> None:
    """The UI's Local/Remote badge must reflect the actual server mode."""
    root = tmp_path_factory.mktemp("mode")

    with TestClient(create_app(root, watch=False)) as client:
        assert client.get("/api/project").json()["mode"] == "local"
        assert client.get("/api/health").json()["mode"] == "local"

    with TestClient(create_app(root, watch=False, remote=True)) as client:
        assert client.get("/api/project").json()["mode"] == "remote"
        assert client.get("/api/health").json()["mode"] == "remote"


def test_awkward_identifiers_survive_the_round_trip(tmp_path_factory) -> None:
    duckdb_conn = duckdb.connect()
    root = tmp_path_factory.mktemp("awkward")
    duckdb_conn.execute(
        """CREATE TABLE t AS SELECT i AS "Order ID", i * 1.5 AS "Total $ (USD)",
           'x' || i AS "na me" FROM range(1, 20) t(i)"""
    )
    duckdb_conn.execute(f"COPY t TO '{root / 'Weird Name.parquet'}' (FORMAT PARQUET)")
    duckdb_conn.close()

    with TestClient(create_app(root, watch=False)) as client:
        body = client.get("/api/datasets/Weird Name.parquet/schema").json()
        assert body["dataset"]["qualifiedName"] == "main.weird_name"
        assert [c["name"] for c in body["columns"]] == ["Order ID", "Total $ (USD)", "na me"]

        query_id = client.post(
            "/api/query", json={"sql": 'SELECT "Order ID", "Total $ (USD)" FROM main.weird_name'}
        ).json()["queryId"]
        assert wait_for(client, query_id)["status"] == "completed"
        # Sorting and filtering must quote the identifier too.
        page = client.get(f"/api/query/{query_id}/rows?sort=Total $ (USD)&desc=true").json()
        assert page["rows"][0][0] == 19
        assert client.get(f"/api/query/{query_id}/rows?search=10").json()["total"] >= 1


def test_a_running_query_can_be_cancelled(client: TestClient) -> None:
    """Cancellation must interrupt DuckDB mid-scan, not just forget the result."""
    import time

    slow = "SELECT count(*) FROM range(500000000000) t(i) WHERE i % 7 = 0"
    query_id = client.post("/api/query", json={"sql": slow}).json()["queryId"]

    # Wait until it is genuinely executing before interrupting.
    deadline = time.time() + 5
    while time.time() < deadline:
        if client.get(f"/api/query/{query_id}").json()["status"] == "running":
            break
        time.sleep(0.02)

    started = time.time()
    assert client.post(f"/api/query/{query_id}/cancel").json()["cancelled"] is True
    state = wait_for(client, query_id, timeout=15)
    assert state["status"] == "cancelled"
    # The point of interrupt() is that it returns promptly, not after the scan.
    assert time.time() - started < 10

    # The engine must still be usable afterwards.
    follow_up = client.post("/api/query", json={"sql": "SELECT 1 AS ok"}).json()["queryId"]
    assert wait_for(client, follow_up)["status"] == "completed"


def test_cancelling_an_unknown_query_is_harmless(client: TestClient) -> None:
    assert client.post("/api/query/nope/cancel").json()["cancelled"] is False


def test_a_busy_port_falls_through_to_the_next_one() -> None:
    """A dev server already on the preferred port must not stop Localake."""
    import socket

    from localake.cli import find_free_port

    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as taken:
        taken.bind(("127.0.0.1", 0))
        taken.listen(1)
        busy = taken.getsockname()[1]
        assert find_free_port("127.0.0.1", busy) == busy + 1


def test_a_wildcard_listener_counts_as_busy() -> None:
    """A server on 0.0.0.0:N must block N, not be silently bound alongside."""
    import socket

    from localake.cli import find_free_port

    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as wildcard:
        wildcard.bind(("0.0.0.0", 0))
        wildcard.listen(1)
        busy = wildcard.getsockname()[1]
        assert find_free_port("127.0.0.1", busy) != busy


def test_a_closed_port_is_reusable_immediately() -> None:
    """Restarting must not walk up the port range because of TIME_WAIT."""
    import socket

    from localake.cli import find_free_port

    listener = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    listener.bind(("127.0.0.1", 0))
    listener.listen(1)
    port = listener.getsockname()[1]
    # Connect then close both ends, which is what leaves a socket in TIME_WAIT.
    client = socket.create_connection(("127.0.0.1", port))
    served, _ = listener.accept()
    client.close()
    served.close()
    listener.close()

    assert find_free_port("127.0.0.1", port) == port


def test_saved_charts_reexecute_their_query(client: TestClient) -> None:
    """A chart stores its SQL, so the gallery always renders current data."""
    chart = client.post(
        "/api/charts",
        json={
            "name": "Orders by status",
            "sql": "SELECT status, count(*) AS n FROM analytics.orders GROUP BY 1 ORDER BY 1",
            "type": "bar",
            "x": "status",
            "y": ["n"],
        },
    ).json()
    assert chart["name"] == "Orders by status"
    assert client.get("/api/charts").json()["charts"][0]["id"] == chart["id"]

    body = client.get(f"/api/charts/{chart['id']}/data").json()
    assert [c["name"] for c in body["columns"]] == ["status", "n"]
    assert len(body["rows"]) == 2
    assert body["chart"]["x"] == "status"

    assert client.delete(f"/api/charts/{chart['id']}").json()["deleted"] is True
    assert client.get(f"/api/charts/{chart['id']}/data").status_code == 404


def test_a_chart_over_a_vanished_table_explains_itself(client: TestClient) -> None:
    chart = client.post(
        "/api/charts",
        json={"name": "Gone", "sql": "SELECT a, b FROM no_such_table", "x": "a", "y": ["b"]},
    ).json()
    response = client.get(f"/api/charts/{chart['id']}/data")
    assert response.status_code == 422
    assert "no_such_table" in response.json()["detail"]
    client.delete(f"/api/charts/{chart['id']}")


def test_a_chart_needs_a_y_series(client: TestClient) -> None:
    assert client.post(
        "/api/charts", json={"name": "Bad", "sql": "SELECT 1", "x": "a", "y": []}
    ).status_code == 422


def test_lineage_connects_files_tables_queries_and_charts(client: TestClient) -> None:
    saved = client.post(
        "/api/queries",
        json={
            "name": "Paid orders by month",
            "sql": "SELECT date_trunc('month', created_at) AS m, count(*) AS n "
            "FROM analytics.orders WHERE status = 'paid' GROUP BY 1",
        },
    ).json()
    chart = client.post(
        "/api/charts",
        json={
            "name": "Paid by month",
            "sql": "SELECT date_trunc('month', created_at) AS m, count(*) AS n "
            "FROM analytics.orders GROUP BY 1",
            "x": "m",
            "y": ["n"],
        },
    ).json()

    graph = client.get("/api/lineage").json()
    nodes = {n["id"] for n in graph["nodes"]}
    edges = {(e["source"], e["target"]) for e in graph["edges"]}

    assert "file:analytics/orders.parquet" in nodes
    assert "table:analytics.orders" in nodes
    # The file feeds the table, and the table feeds both consumers.
    assert ("file:analytics/orders.parquet", "table:analytics.orders") in edges
    assert ("table:analytics.orders", f"query:{saved['id']}") in edges
    assert ("table:analytics.orders", f"chart:{chart['id']}") in edges

    # A focused view keeps the neighbourhood and drops the rest.
    focused = client.get("/api/lineage/analytics/orders.parquet").json()
    focused_ids = {n["id"] for n in focused["nodes"]}
    assert "table:analytics.orders" in focused_ids
    assert "table:raw.orders_export" not in focused_ids

    client.delete(f"/api/queries/{saved['id']}")
    client.delete(f"/api/charts/{chart['id']}")


def test_lineage_reads_joins_as_two_sources(client: TestClient) -> None:
    saved = client.post(
        "/api/queries",
        json={
            "name": "Joined",
            "sql": "SELECT o.status FROM analytics.orders o "
            "JOIN raw.orders_export e ON o.order_id = e.order_id",
        },
    ).json()
    edges = {(e["source"], e["target"]) for e in client.get("/api/lineage").json()["edges"]}
    assert ("table:analytics.orders", f"query:{saved['id']}") in edges
    assert ("table:raw.orders_export", f"query:{saved['id']}") in edges
    client.delete(f"/api/queries/{saved['id']}")


def test_lineage_includes_views_made_in_the_editor(client: TestClient) -> None:
    query_id = client.post(
        "/api/query",
        json={
            "sql": "CREATE OR REPLACE VIEW analytics.paid_only AS "
            "SELECT * FROM analytics.orders WHERE status = 'paid'"
        },
    ).json()["queryId"]
    assert wait_for(client, query_id)["status"] == "completed"

    edges = {(e["source"], e["target"]) for e in client.get("/api/lineage").json()["edges"]}
    assert ("table:analytics.orders", "view:analytics.paid_only") in edges


def test_lineage_survives_unparseable_sql(client: TestClient) -> None:
    saved = client.post(
        "/api/queries", json={"name": "Nonsense", "sql": "this is not sql ((("}
    ).json()
    graph = client.get("/api/lineage").json()
    # The node still exists; it simply has no incoming edges.
    assert any(n["id"] == f"query:{saved['id']}" for n in graph["nodes"])
    client.delete(f"/api/queries/{saved['id']}")


def test_catalog_listing_can_include_cheap_stats(client: TestClient) -> None:
    """Row counts for the catalog table must not cost a scan per dataset."""
    listed = {d["id"]: d for d in client.get("/api/datasets?stats=true").json()["datasets"]}

    parquet = listed["analytics/orders.parquet"]["stats"]
    assert parquet["rows"] == 60           # straight from the Parquet footer
    assert parquet["columns"] == 4

    # CSV has no footer, so rows stay unknown rather than triggering a count.
    csv = listed["raw/orders_export.csv"]["stats"]
    assert csv["rows"] is None
    assert csv["columns"] == 4
    assert csv["sizeBytes"] > 0

    # Without the flag the payload is unchanged.
    assert "stats" not in client.get("/api/datasets").json()["datasets"][0]


def test_spill_files_stay_inside_the_project(tmp_path, monkeypatch) -> None:
    """DuckDB's default temp path is relative, so it would follow the cwd."""
    from localake.project import open_project
    from localake.query import Engine

    project_dir = tmp_path / "proj"
    project_dir.mkdir()
    elsewhere = tmp_path / "somewhere-else"
    elsewhere.mkdir()
    monkeypatch.chdir(elsewhere)

    project = open_project(project_dir)
    engine = Engine(project)
    try:
        rows, _ = engine.sql("SELECT current_setting('temp_directory')")
        configured = Path(rows[0][0])
        assert configured == project.meta_dir / "tmp"
        assert configured.is_dir()
        # Never the working directory the command was launched from.
        assert elsewhere not in configured.parents
    finally:
        engine.close()


def test_histogram_bins_are_evenly_spaced(client: TestClient) -> None:
    """DuckDB's CAST to INTEGER rounds, which silently halves the first bin."""
    body = client.get(
        "/api/datasets/analytics/orders.parquet/distribution?column=order_id"
    ).json()
    assert body["kind"] == "histogram"
    counts = [b["count"] for b in body["bins"]]
    assert sum(counts) == 60
    # 60 sequential ids over 12 bins: every bin holds exactly five.
    assert counts == [5] * 12, counts
    assert body["bins"][0]["from"] < body["bins"][-1]["to"]


def test_low_cardinality_columns_get_top_values(client: TestClient) -> None:
    body = client.get(
        "/api/datasets/analytics/orders.parquet/distribution?column=status"
    ).json()
    assert body["kind"] == "topValues"
    values = {v["value"]: v["count"] for v in body["values"]}
    assert values["paid"] == 54
    assert values[None] == 6      # NULLs are part of the picture, not hidden


def test_distribution_rejects_an_unknown_column(client: TestClient) -> None:
    response = client.get(
        "/api/datasets/analytics/orders.parquet/distribution?column=nope"
    )
    assert response.status_code == 422
    assert "nope" in response.json()["detail"]


def test_settings_round_trip_and_reach_the_engine(client: TestClient) -> None:
    before = client.get("/api/settings").json()
    assert before["about"]["duckdb"]
    assert before["engine"]["threads"] >= 1
    # The spill directory must already be pinned inside the project.
    assert ".localake" in before["engine"]["tempDirectory"]

    updated = client.put(
        "/api/settings", json={"memoryLimit": "2GB", "threads": 2, "defaultRowLimit": 500}
    ).json()
    assert updated["engine"]["threads"] == 2
    # DuckDB normalises and reports back in binary units: "2GB" -> "1.8 GiB".
    assert updated["engine"]["memoryLimit"] != before["engine"]["memoryLimit"]
    assert "GiB" in updated["engine"]["memoryLimit"]
    assert updated["workspace"]["defaultRowLimit"] == 500

    # Persisted, not just held in memory.
    assert client.get("/api/settings").json()["workspace"]["defaultRowLimit"] == 500

    client.put("/api/settings", json={"threads": before["engine"]["threads"]})


def test_settings_reject_nonsense(client: TestClient) -> None:
    assert client.put("/api/settings", json={"memoryLimit": "plenty"}).status_code == 422
    assert client.put("/api/settings", json={"threads": 0}).status_code == 422
    assert client.put("/api/settings", json={"defaultRowLimit": -5}).status_code == 422


def test_file_access_lockdown_keeps_the_catalog_readable(tmp_path_factory) -> None:
    """Restricting to the project must not break the catalog on the next rescan."""
    root = tmp_path_factory.mktemp("locked")
    (root / "analytics").mkdir()
    parquet = root / "analytics" / "t.parquet"
    con = duckdb.connect()
    con.execute("CREATE TABLE t AS SELECT i AS a FROM range(1, 6) t(i)")
    con.execute(f"COPY t TO '{parquet}' (FORMAT PARQUET)")
    con.close()

    outside = tmp_path_factory.mktemp("outside")
    secret = outside / "secret.csv"
    secret.write_text("a\n1\n2\n")

    with TestClient(create_app(root, watch=False)) as client:
        assert client.get("/api/settings").json()["engine"]["externalAccess"] is True

        updated = client.put("/api/settings", json={"externalAccess": False}).json()
        assert updated["engine"]["externalAccess"] is False

        # A rescan must re-register the same views, not mark them unreadable.
        client.post("/api/tree/refresh")
        datasets = {d["id"]: d for d in client.get("/api/datasets").json()["datasets"]}
        assert datasets["analytics/t.parquet"]["error"] is None

        schema = client.get("/api/datasets/analytics/t.parquet/schema")
        assert schema.status_code == 200
        assert [c["name"] for c in schema.json()["columns"]] == ["a"]

        # Project files stay queryable...
        ok = client.post(
            "/api/query", json={"sql": "SELECT count(*) AS n FROM analytics.t"}
        ).json()["queryId"]
        assert wait_for(client, ok)["status"] == "completed"

        # ...while files outside the project are refused.
        bad = client.post(
            "/api/query",
            json={"sql": f"SELECT * FROM read_csv_auto('{secret}')"},
        ).json()["queryId"]
        assert wait_for(client, bad)["status"] == "failed"

    # A fresh session must re-apply the lockdown: DuckDB resets it per connection.
    with TestClient(create_app(root, watch=False)) as client:
        assert client.get("/api/settings").json()["engine"]["externalAccess"] is False
        assert client.get("/api/datasets/analytics/t.parquet/schema").status_code == 200


def test_execution_reports_what_was_actually_read(client: TestClient) -> None:
    """Rows scanned must count both sides of a join, not just the first."""
    query_id = client.post(
        "/api/query",
        json={
            "sql": "SELECT o.status FROM analytics.orders o "
            "JOIN raw.orders_export e ON o.order_id = e.order_id"
        },
    ).json()["queryId"]
    assert wait_for(client, query_id)["status"] == "completed"

    plan = client.get(f"/api/query/{query_id}/plan").json()
    assert plan["rowsScanned"] == 120        # 60 rows read from each side
    assert [op["name"] for op in plan["operators"]].count("TABLE_SCAN") == 2
    assert any(op["scan"] for op in plan["operators"])


def test_a_constant_query_scans_nothing(client: TestClient) -> None:
    query_id = client.post("/api/query", json={"sql": "SELECT 1 AS one"}).json()["queryId"]
    wait_for(client, query_id)
    plan = client.get(f"/api/query/{query_id}/plan").json()
    # DUMMY_SCAN reads nothing off storage and must not be counted.
    assert plan["rowsScanned"] is None


def test_progress_events_reach_the_socket(client: TestClient) -> None:
    """A long scan over real data should report partial completion."""
    with client.websocket_connect("/ws") as socket:
        assert socket.receive_json()["type"] == "hello"
        client.post(
            "/api/query",
            json={
                "sql": "SELECT count(*) FROM analytics.orders a, analytics.orders b "
                "WHERE a.order_id % 3 = b.order_id % 3",
                "queryId": "progress-probe",
                "tabId": "progress-probe",
            },
        )
        kinds = []
        for _ in range(40):
            message = socket.receive_json()
            if message["type"] == "ping":
                continue
            kinds.append(message["type"])
            if message["type"] == "query.progress":
                assert 0 <= message["percent"] <= 100
            if message["type"] in {"query.completed", "query.failed"}:
                break
        assert "query.running" in kinds
        assert kinds[-1] == "query.completed"


def test_charts_are_files_in_the_project(client: TestClient, project: Path) -> None:
    """Saved charts live beside the data so they can be committed with it."""
    chart = client.post(
        "/api/charts",
        json={
            "name": "Revenue by status",
            "sql": "SELECT status, sum(total_amount) AS revenue FROM analytics.orders GROUP BY 1",
            "x": "status",
            "y": ["revenue"],
        },
    ).json()

    written = list((project / "charts").glob("*.json"))
    assert [p.name for p in written] == ["revenue_by_status.json"]
    saved = json.loads(written[0].read_text())
    assert saved["id"] == chart["id"]
    assert saved["kind"] == "localake.chart"

    # The catalog must not mistake it for a JSON dataset...
    client.post("/api/tree/refresh")
    ids = {d["id"] for d in client.get("/api/datasets").json()["datasets"]}
    assert not any(i.startswith("charts/") for i in ids)

    # ...but the file should still be visible in the tree, not silently hidden.
    tree = client.get("/api/tree").json()["tree"]
    folder = next(c for c in tree["children"] if c["name"] == "charts")
    assert [(c["name"], c["kind"]) for c in folder["children"]] == [
        ("revenue_by_status.json", "file")
    ]

    assert client.delete(f"/api/charts/{chart['id']}").json()["deleted"] is True
    assert list((project / "charts").glob("*.json")) == []
    client.post("/api/tree/refresh")


def test_charts_with_the_same_name_do_not_clobber_each_other(tmp_path_factory) -> None:
    """Two charts can share a name; each keeps its own file and its own data."""
    root = tmp_path_factory.mktemp("dupe-charts")
    with TestClient(create_app(root, watch=False)) as client:
        a = client.post(
            "/api/charts", json={"name": "Revenue", "sql": "SELECT 1 AS a", "x": "a", "y": ["a"]}
        ).json()
        b = client.post(
            "/api/charts", json={"name": "Revenue", "sql": "SELECT 2 AS b", "x": "b", "y": ["b"]}
        ).json()

        charts = client.get("/api/charts").json()["charts"]
        assert {c["id"] for c in charts} == {a["id"], b["id"]}

        files = list((root / "charts").glob("*.json"))
        assert len(files) == 2

        # Each file still re-runs its own query, proving nothing was overwritten.
        assert client.get(f"/api/charts/{a['id']}/data").json()["rows"] == [[1]]
        assert client.get(f"/api/charts/{b['id']}/data").json()["rows"] == [[2]]


def test_txt_files_are_not_registered_as_datasets(tmp_path_factory) -> None:
    """Arbitrary text files are notes, not data — only real CSV/TSV are tables."""
    root = tmp_path_factory.mktemp("txt")
    (root / "notes.txt").write_text("just some notes\n")
    (root / "data.csv").write_text("a\n1\n")

    with TestClient(create_app(root, watch=False)) as client:
        ids = {d["id"] for d in client.get("/api/datasets").json()["datasets"]}
        assert "data.csv" in ids
        assert "notes.txt" not in ids

        tree = {c["name"]: c["kind"] for c in client.get("/api/tree").json()["tree"]["children"]}
        assert tree["notes.txt"] == "file"
        assert tree["data"] == "dataset"


def test_import_uploads_a_file_into_the_project(tmp_path_factory) -> None:
    root = tmp_path_factory.mktemp("import")
    with TestClient(create_app(root, watch=False)) as client:
        response = client.post(
            "/api/import?target=raw",
            files={"file": ("orders.csv", b"a,b\n1,2\n", "text/csv")},
        )
        assert response.status_code == 200
        body = response.json()
        assert body["filename"] == "orders.csv"
        assert body["path"] == "raw/orders.csv"
        assert body["dataset"]["qualifiedName"] == "raw.orders"
        assert (root / "raw" / "orders.csv").read_text() == "a,b\n1,2\n"

        # It is immediately queryable through the catalog.
        ids = {d["id"] for d in client.get("/api/datasets").json()["datasets"]}
        assert "raw/orders.csv" in ids


def test_import_refuses_a_target_outside_the_project(tmp_path_factory) -> None:
    root = tmp_path_factory.mktemp("import")
    with TestClient(create_app(root, watch=False)) as client:
        response = client.post(
            "/api/import?target=../outside",
            files={"file": ("x.csv", b"a\n1\n", "text/csv")},
        )
        assert response.status_code == 400


def test_import_of_an_unknown_extension_is_saved_as_a_plain_file(tmp_path_factory) -> None:
    root = tmp_path_factory.mktemp("import")
    with TestClient(create_app(root, watch=False)) as client:
        response = client.post(
            "/api/import?target=raw",
            files={"file": ("notes.txt", b"hello\n", "text/plain")},
        )
        assert response.status_code == 200
        body = response.json()
        assert body["dataset"] is None
        assert (root / "raw" / "notes.txt").read_text() == "hello\n"


def test_notebooks_roundtrip_and_cells_run(tmp_path_factory) -> None:
    root = tmp_path_factory.mktemp("notebooks")
    with TestClient(create_app(root, watch=False)) as client:
        saved = client.post(
            "/api/notebooks",
            json={
                "name": "Probe",
                "cells": [
                    {"sql": "CREATE OR REPLACE VIEW nb_probe AS SELECT 7 AS x"},
                    {"sql": "SELECT x FROM nb_probe"},
                ],
            },
        ).json()
        assert saved["name"] == "Probe"
        assert [c["sql"] for c in saved["cells"]] == [
            "CREATE OR REPLACE VIEW nb_probe AS SELECT 7 AS x",
            "SELECT x FROM nb_probe",
        ]
        assert all(c["id"] for c in saved["cells"])

        listed = client.get("/api/notebooks").json()["notebooks"]
        assert any(n["id"] == saved["id"] for n in listed)

        # DDL cells report a status message, not a result grid.
        ddl = client.post(
            "/api/notebooks/run",
            json={"sql": "CREATE OR REPLACE VIEW nb_probe AS SELECT 7 AS x"},
        ).json()
        assert ddl["columns"] == []
        assert ddl["message"]

        # Cells share the same DuckDB session, in order.
        select = client.post(
            "/api/notebooks/run", json={"sql": "SELECT x FROM nb_probe"}
        ).json()
        assert [c["name"] for c in select["columns"]] == ["x"]
        assert select["rows"] == [[7]]

        assert client.delete(f"/api/notebooks/{saved['id']}").json()["deleted"] is True
        assert client.delete(f"/api/notebooks/{saved['id']}").status_code == 404


def test_notebook_files_are_not_scanned_as_datasets(tmp_path_factory) -> None:
    root = tmp_path_factory.mktemp("notebooks")
    with TestClient(create_app(root, watch=False)) as client:
        saved = client.post(
            "/api/notebooks",
            json={"name": "Notes", "cells": [{"sql": "SELECT 1"}]},
        ).json()

        client.post("/api/tree/refresh")
        ids = {d["id"] for d in client.get("/api/datasets").json()["datasets"]}
        assert not any(i.startswith("notebooks/") for i in ids)

        tree = client.get("/api/tree").json()["tree"]
        folder = next((c for c in tree["children"] if c["name"] == "notebooks"), None)
        assert folder is not None
        assert all(c["kind"] == "file" for c in folder["children"])

        client.delete(f"/api/notebooks/{saved['id']}")


def test_run_cell_rejects_bad_sql(tmp_path_factory) -> None:
    root = tmp_path_factory.mktemp("notebooks")
    with TestClient(create_app(root, watch=False)) as client:
        response = client.post(
            "/api/notebooks/run", json={"sql": "SELECT nope FROM nowhere"}
        )
        assert response.status_code == 422
        assert "nowhere" in response.json()["detail"]


def test_a_real_json_dataset_is_still_scanned(client: TestClient, project: Path) -> None:
    """Only Localake's own documents are skipped, not the user's JSON data."""
    (project / "raw" / "feed.json").write_text('{"a": 1}\n{"a": 2}\n')
    client.post("/api/tree/refresh")
    ids = {d["id"] for d in client.get("/api/datasets").json()["datasets"]}
    assert "raw/feed.json" in ids
    (project / "raw" / "feed.json").unlink()
    client.post("/api/tree/refresh")


def test_history_filters_by_text_and_window(client: TestClient) -> None:
    client.post("/api/query", json={"sql": "SELECT 'needle-marker' AS tag"})
    import time as _time

    _time.sleep(0.3)

    matched = client.get("/api/history?q=needle-marker").json()["entries"]
    assert matched and all("needle-marker" in e["sql"] for e in matched)

    assert client.get("/api/history?q=no-such-text-anywhere").json()["entries"] == []

    # Everything in this run happened today, so the window keeps it all.
    today = client.get("/api/history?since=today").json()["entries"]
    assert len(today) >= len(matched)

    # Filters compose.
    both = client.get("/api/history?q=needle-marker&status=completed").json()["entries"]
    assert all(e["status"] == "completed" for e in both)


def test_history_log_stays_bounded(tmp_path) -> None:
    """The on-disk log must not grow forever, and the newest entries survive."""
    from localake.storage import HistoryLog

    log = HistoryLog(tmp_path / "history.jsonl", max_entries=10)
    for i in range(25):
        log.append({"id": i, "sql": f"SELECT {i}"})

    entries = log.recent(limit=100)
    assert [entry["id"] for entry in entries] == list(range(24, 14, -1))
    # The file itself is trimmed back to the cap.
    assert log.path.read_text().count("\n") == 10

    log.clear()
    assert not log.path.exists()


def test_search_covers_files_and_projects(client: TestClient) -> None:
    groups = {g["kind"]: g["items"] for g in client.get("/api/search?q=readme").json()["groups"]}
    assert "files" in groups
    assert any(item["label"] == "README.md" for item in groups["files"])

    # Datasets must not leak into the Files group.
    labels = [item["label"] for item in groups["files"]]
    assert "orders.parquet" not in labels
