#!/usr/bin/env python3
"""Generate a demo ecommerce project matching the reference UI mockup.

    python scripts/make_sample_project.py ~/Data/ecommerce
"""

from __future__ import annotations

import sys
from pathlib import Path

import duckdb

SEED = 20240101


def build(root: Path, *, orders: int = 24_000) -> None:
    root.mkdir(parents=True, exist_ok=True)
    for folder in ("raw", "analytics", "external", "views"):
        (root / folder).mkdir(exist_ok=True)

    con = duckdb.connect()
    con.execute(f"SELECT setseed({(SEED % 1000) / 1000})")

    con.execute(
        """
        CREATE TABLE customers AS
        SELECT
            2000 + i                                        AS customer_id,
            'customer_' || i                                AS name,
            'user' || i || '@example.com'                    AS email,
            ['US','DE','FR','GB','JP','BR'][1 + (i % 6)]     AS country,
            DATE '2022-01-01' + INTERVAL (i % 900) DAY       AS signed_up_at,
            (i % 7) = 0                                      AS is_business
        FROM range(1, 4001) t(i)
        """
    )
    con.execute(
        """
        CREATE TABLE products AS
        SELECT
            100 + i                                                  AS product_id,
            'product_' || i                                          AS name,
            ['apparel','home','electronics','beauty','sports'][1 + (i % 5)] AS category,
            round(5 + random() * 400, 2)                             AS unit_price
        FROM range(1, 301) t(i)
        """
    )
    con.execute(
        f"""
        CREATE TABLE orders AS
        SELECT
            10000 + i                                                 AS order_id,
            2000 + (1 + CAST(random() * 3999 AS BIGINT))              AS customer_id,
            TIMESTAMP '2024-01-01 00:00:00'
                + INTERVAL (CAST(random() * 365 * 24 * 60 AS BIGINT)) MINUTE AS created_at,
            CASE WHEN random() < 0.86 THEN 'paid'
                 WHEN random() < 0.6  THEN 'refunded'
                 ELSE 'cancelled' END                                 AS status,
            round(12 + random() * 480, 2)                             AS total_amount,
            'USD'                                                     AS currency,
            CASE WHEN random() < 0.002 THEN NULL
                 ELSE ['card','paypal','bank_transfer'][1 + CAST(floor(random() * 3) AS BIGINT)]
            END                                                       AS payment_method,
            TIMESTAMP '2024-01-01 00:00:00'
                + INTERVAL (CAST(random() * 365 * 24 * 60 AS BIGINT)) MINUTE AS updated_at
        FROM range(1, {orders + 1}) t(i)
        """
    )
    # A small share of rows has no status, so the Schema tab shows a non-zero rate.
    con.execute("UPDATE orders SET status = NULL WHERE order_id % 997 = 0")
    con.execute(
        """
        CREATE TABLE order_items AS
        SELECT
            row_number() OVER ()                              AS order_item_id,
            o.order_id                                        AS order_id,
            100 + (1 + CAST(random() * 299 AS BIGINT))        AS product_id,
            1 + CAST(floor(random() * 3) AS BIGINT)           AS quantity,
            round(5 + random() * 200, 2)                      AS unit_price
        FROM orders o, range(1, 3) t(i)
        WHERE random() < 0.75
        """
    )
    con.execute(
        """
        CREATE TABLE payments AS
        SELECT
            row_number() OVER ()                              AS payment_id,
            order_id,
            total_amount                                      AS amount,
            payment_method                                    AS method,
            created_at                                        AS paid_at
        FROM orders
        WHERE status = 'paid'
        """
    )
    con.execute(
        """
        CREATE TABLE monthly_sales AS
        SELECT
            date_trunc('month', created_at)  AS month,
            count(*)                         AS orders,
            sum(total_amount)                AS revenue,
            avg(total_amount)                AS avg_order_value
        FROM orders
        WHERE status = 'paid'
        GROUP BY 1 ORDER BY 1
        """
    )
    con.execute(
        """
        CREATE TABLE top_customers AS
        SELECT
            c.customer_id, c.name, c.country,
            count(*)          AS orders,
            sum(o.total_amount) AS revenue
        FROM orders o JOIN customers c USING (customer_id)
        WHERE o.status = 'paid'
        GROUP BY 1, 2, 3
        ORDER BY revenue DESC
        LIMIT 500
        """
    )

    analytics = ("customers", "orders", "order_items", "products", "payments")
    for table in analytics:
        con.execute(f"COPY {table} TO '{root / 'analytics' / f'{table}.parquet'}' (FORMAT PARQUET)")
    for table in ("monthly_sales", "top_customers"):
        con.execute(f"COPY {table} TO '{root / 'views' / f'{table}.parquet'}' (FORMAT PARQUET)")

    # raw/ keeps the un-modelled drops: a CSV and a JSON, to exercise both readers.
    con.execute(f"COPY customers TO '{root / 'raw' / 'customers_export.csv'}' (FORMAT CSV, HEADER)")
    con.execute(
        f"COPY (SELECT * FROM products LIMIT 120) TO '{root / 'raw' / 'products_feed.json'}' (FORMAT JSON)"
    )

    # external/ holds a Hive-partitioned directory so the scanner's
    # directory-as-one-dataset path is covered too.
    events = root / "external" / "web_events"
    con.execute(
        """
        CREATE TABLE web_events AS
        SELECT
            row_number() OVER ()                                     AS event_id,
            2000 + CAST(random() * 3999 AS BIGINT)                   AS customer_id,
            ['view','add_to_cart','checkout'][1 + CAST(floor(random() * 3) AS BIGINT)] AS event_type,
            DATE '2024-06-01' + INTERVAL (CAST(random() * 2 AS BIGINT)) DAY        AS day
        FROM range(1, 6001)
        """
    )
    con.execute(
        f"COPY web_events TO '{events}' (FORMAT PARQUET, PARTITION_BY (day), OVERWRITE_OR_IGNORE)"
    )

    (root / "README.md").write_text(
        "# ecommerce\n\nSample Localake project.\n\n"
        "- `analytics/` — modelled Parquet tables\n"
        "- `raw/` — untouched CSV and JSON drops\n"
        "- `views/` — derived aggregates\n"
        "- `external/` — Hive-partitioned event data\n"
    )
    con.close()

    total = sum(f.stat().st_size for f in root.rglob("*") if f.is_file())
    print(f"created {root}  ({total / 1e6:.1f} MB)")


if __name__ == "__main__":
    target = Path(sys.argv[1] if len(sys.argv) > 1 else "~/Data/ecommerce").expanduser()
    # Determinism comes from DuckDB's own setseed() above; Python's `random`
    # module has nothing to do with the generated SQL.
    build(target)
