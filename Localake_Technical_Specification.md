# Localake — Technical Specification

## 1. Product

**Localake** — local-first data workspace для работы с Parquet, DuckDB и Lakehouse-данными.

Основной UX:

> **Open project → explore data → write SQL → inspect → visualize → save**

Приложение должно ощущаться как смесь:

**Databricks + VS Code + modern BI**, но полностью локально.

---

# 2. Основной интерфейс

UI должен соответствовать следующей структуре:

```text
┌──────────────────────────────────────────────────────────────┐
│ Localake │ Project │ Search                 Local Mode       │
├──────────┬──────────────────┬───────────────────────────────┤
│          │                  │                               │
│ Sidebar  │  Data Explorer   │       Inspector              │
│          │                  │                               │
│ Home     │  folders         │ schema                       │
│ Explorer │  datasets        │ profile                      │
│ SQL      │  views           │ lineage                      │
│ Notebook │                  │ preview                      │
│ Charts   ├──────────────────┤                               │
│ Lineage  │ SQL Editor       │                               │
│ Imports  │                  │                               │
│ History  ├──────────────────┤                               │
│ Settings │ Results          │                               │
│          │                  │                               │
└──────────┴──────────────────┴───────────────────────────────┘
```

---

# 3. Frontend

### Stack

- Next.js / React
- TypeScript
- Tailwind CSS
- Monaco Editor
- TanStack Query
- Apache ECharts / Recharts
- React Flow для Lineage

Основной принцип:

**Frontend не работает напрямую с filesystem.**

Он общается с локальным backend.

```text
Browser
   ↓
HTTP / WebSocket
   ↓
Localake API
```

---

# 4. Local Backend

Для MVP:

**Python + FastAPI**

Структура:

```text
backend/
├── api/
├── project/
├── filesystem/
├── catalog/
├── query/
├── profiling/
├── lineage/
├── importers/
└── storage/
```

Запуск:

```bash
localake
```

После запуска:

```text
http://localhost:3000
```

Frontend и backend могут запускаться одной командой.

---

# 5. Data Engine

Основной engine:

**DuckDB**

```text
FastAPI
   ↓
DuckDB
   ↓
Parquet / CSV / JSON
```

DuckDB отвечает за:

- SQL;
- joins;
- aggregations;
- window functions;
- Parquet;
- CSV;
- JSON;
- views;
- temporary tables;
- analytical workloads.

---

# 6. Storage

Главный storage — обычная файловая система.

Пример:

```text
~/Localake/
└── ecommerce/
    ├── raw/
    │   ├── customers/
    │   └── orders/
    │
    ├── analytics/
    │   ├── customers.parquet
    │   └── monthly_sales.parquet
    │
    ├── external/
    ├── queries/
    ├── notebooks/
    └── lakehouse.toml
```

MVP formats:

- Parquet
- CSV
- JSON

Later:

- Delta Lake
- Iceberg
- Excel
- Avro

---

# 7. Project

При создании проекта пользователь указывает директорию.

Например:

```text
~/Data/ecommerce
```

Localake автоматически создаёт:

```text
lakehouse.toml
```

Пример:

```toml
name = "ecommerce"

[data]
root = "./data"

[engine]
type = "duckdb"
```

---

# 8. Data Explorer

Левая центральная панель соответствует UI-концепции.

Показывает:

```text
My Project
│
├── data
│   ├── ecommerce
│   │   ├── orders
│   │   ├── order_items
│   │   ├── customers
│   │   └── products
│
├── analytics
│   ├── monthly_sales
│   └── top_customers
│
├── raw
├── external
└── Files
    ├── README.md
    └── lakehouse.toml
```

Файлы Parquet отображаются как datasets/tables.

---

# 9. Dataset Page

При выборе `orders` справа открывается Inspector.

Tabs:

```text
Schema
Profile
Lineage
Preview
```

### Schema

```text
Column         Type          Nulls
-------------------------------------
order_id       BIGINT        0%
customer_id    BIGINT        0%
created_at     TIMESTAMP     0%
status         VARCHAR       0.1%
total_amount   DOUBLE        0%
currency       VARCHAR       0%
```

---

# 10. Preview

Показать первые N строк:

```text
order_id | customer_id | status | total_amount
------------------------------------------------
10001    | 2938        | paid   | 120.00
10002    | 9211        | paid   | 80.50
```

Preview не должен читать весь dataset.

Использовать:

```sql
LIMIT 100
```

---

# 11. Data Profiling

Вкладка `Profile`:

```text
Rows              12.4M
Columns           18
File Size         2.8 GB

Null Rate         2.3%
Duplicate Rate    0.4%
```

По каждой колонке:

```text
total_amount

Min       1.20
Max       9821.00
Average   124.31
Median    98.20
Unique    83%
Nulls     0%
```

Дополнительно:

- histogram;
- distribution;
- top values.

---

# 12. SQL Editor

Центральная часть экрана.

Использовать Monaco.

Поддержать:

- syntax highlighting;
- autocomplete;
- table autocomplete;
- column autocomplete;
- formatting;
- query execution;
- cancellation;
- multiple query tabs.

Пример:

```sql
SELECT
    date_trunc('month', created_at) AS month,
    count(*) AS orders,
    sum(total_amount) AS revenue,
    avg(total_amount) AS avg_order_value
FROM orders
WHERE created_at >= '2024-01-01'
GROUP BY 1
ORDER BY 1;
```

---

# 13. Query Tabs

Интерфейс поддерживает несколько SQL sessions:

```text
orders     ×
Query 1    ×
+
```

Каждая вкладка имеет:

```text
query_id
name
sql
status
created_at
updated_at
```

---

# 14. Query Execution

При нажатии `Run`:

```text
React
 ↓
POST /api/query
 ↓
FastAPI
 ↓
DuckDB
 ↓
Result
 ↓
WebSocket / response
 ↓
React
```

Показывать:

```text
✓ Query completed
1.2s
12 rows
```

или:

```text
✕ Query failed
Column `revenue_usd` does not exist
```

---

# 15. Results

Под editor расположена панель:

```text
Results | Chart | Summary | Execution
```

### Results

Табличный результат.

Функции:

- sorting;
- filtering;
- copy;
- column resize;
- export;
- pagination/virtualization.

---

# 16. Execution

Вкладка `Execution` показывает:

```text
Execution Time     1.2 sec
Rows Scanned       12.4M
Rows Returned      12

Query Plan

SCAN orders
 ↓
FILTER
 ↓
GROUP BY
 ↓
ORDER BY
```

В будущем здесь можно визуализировать DuckDB query plan.

---

# 17. Quick Chart

На основе результата SQL:

```text
Chart
```

Пользователь выбирает:

```text
Type:
Line chart

X:
month

Y:
revenue
```

Получает график.

---

# 18. Chart сохранение

График можно сохранить:

```text
charts/
├── monthly_revenue.json
├── top_customers.json
└── sales_by_region.json
```

В дальнейшем:

```text
Charts
 ├── Revenue
 ├── Orders
 └── Customers
```

---

# 19. Popular / Recent Queries

В правой нижней панели:

```text
Recent Queries

Monthly revenue
Top customers
Order status breakdown
Average order value
```

Каждый query:

- Run
- Edit
- Duplicate
- Delete

---

# 20. Query History

Отдельный раздел:

```text
History

Today
  Monthly revenue       1.2s
  Top customers         0.8s
  Orders profile        2.3s

Yesterday
  ...
```

Фильтры:

- project;
- date;
- success/failure;
- query name.

---

# 21. Lineage

Раздел:

```text
Lineage
```

Пример:

```text
orders.parquet
       │
       ▼
     orders
       │
       ├───────────┐
       ▼           ▼
monthly_sales   top_customers
       │
       ▼
    chart
```

MVP lineage строится на основе SQL parsing.

---

# 22. Metadata

SQLite не является обязательным компонентом.

MVP:

```text
DuckDB
+
filesystem
+
JSON/TOML
```

Например:

```text
metadata/
├── project.json
├── datasets.json
├── queries.json
└── charts.json
```

Позже можно заменить внутреннее metadata storage на SQLite, когда понадобится более сложное relational state.

---

# 23. Imports

Раздел:

```text
Imports
```

MVP:

```text
CSV
JSON
Parquet
```

UI:

```text
Import data

[ Upload file ]

or

[ Connect folder ]
```

Later:

```text
PostgreSQL
MySQL
S3
MinIO
REST API
```

---

# 24. Local Mode

В верхней части интерфейса:

```text
🟢 Local Mode

All data stays on your machine
```

По умолчанию:

**никаких облачных запросов.**

---

# 25. Search

Глобальный поиск:

```text
Search tables, columns, queries...
```

Ищет:

```text
Tables
Columns
Queries
Charts
Files
Projects
```

Пример:

```text
Search: revenue

Tables
orders.total_amount

Queries
Monthly revenue

Charts
Monthly Revenue
```

---

# 26. Architecture

Итоговая архитектура:

```text
                    Browser
                       │
                React / Next.js
                       │
                HTTP / WebSocket
                       │
              ┌────────▼────────┐
              │  Localake API   │
              │    FastAPI      │
              └────────┬────────┘
                       │
         ┌─────────────┼─────────────┐
         │             │             │
      Catalog       Query        Profiling
         │             │             │
         └─────────────┼─────────────┘
                       │
                    DuckDB
                       │
         ┌─────────────┼─────────────┐
         │             │             │
      Parquet         CSV          JSON
         │
    Local Filesystem
```

---

# 27. Backend API

Основные endpoints:

```text
GET  /api/project
POST /api/project

GET  /api/datasets
GET  /api/datasets/:id
GET  /api/datasets/:id/schema
GET  /api/datasets/:id/profile
GET  /api/datasets/:id/preview

POST /api/query
POST /api/query/cancel

GET  /api/queries
POST /api/queries
DELETE /api/queries/:id

GET  /api/lineage/:dataset

POST /api/charts
GET  /api/charts

POST /api/import
```

---

# 28. WebSocket

WebSocket использовать для:

- running query;
- query progress;
- logs;
- schema scanning;
- long-running profiling.

Пример:

```text
Browser
   │
   │ WebSocket
   ▼
Query running...
   ↓
DuckDB
   ↓
12.4M rows scanned
   ↓
Completed
```

---

# 29. MVP

Первую версию нужно сильно урезать.

### MVP v0.1

```text
Project
   ↓
Folder
   ↓
Parquet
   ↓
Data Explorer
   ↓
SQL Editor
   ↓
DuckDB
   ↓
Results
```

### v0.2

Добавить:

```text
Schema
Profile
Preview
Query History
Charts
```

### v0.3

Добавить:

```text
Lineage
Imports
Saved Queries
Execution Plan
```

### v0.4

Добавить:

```text
Delta Lake
Iceberg
Time Travel
```

### v0.5

Добавить:

```text
AI Copilot
```

---

# 30. AI Copilot

AI должен встроиться прямо в текущий UI.

Например:

```text
┌─────────────────────────────┐
│ Ask Localake                │
│                             │
│ Show revenue by month       │
│                             │
│        [ Generate ]         │
└─────────────────────────────┘
```

AI:

```text
User
 ↓
Schema
 ↓
LLM
 ↓
SQL
 ↓
DuckDB
 ↓
Result
 ↓
Chart
```

Главная фишка:

> AI не просто пишет SQL, а **видит локальную schema → выполняет SQL → анализирует результат → строит visualization.**

---

# 31. Файловая структура

```text
localake/
│
├── frontend/
│   ├── app/
│   ├── components/
│   ├── editor/
│   ├── explorer/
│   ├── charts/
│   └── lineage/
│
├── backend/
│   ├── api/
│   ├── duckdb/
│   ├── catalog/
│   ├── profiling/
│   ├── lineage/
│   └── importers/
│
├── projects/
└── tests/
```

---

# 32. Главный принцип продукта

Не пытаться сразу реализовать «локальный Databricks».

Первый продукт должен решать одну конкретную задачу:

> **“У меня есть папка с данными. Я открываю Localake и через 10 секунд уже анализирую их.”**

Ядро:

```text
Beautiful UI
      +
DuckDB
      +
Parquet
      +
Local filesystem
```

Всё остальное — слои поверх этого ядра.

---

# 33. Ключевые продуктовые экраны

Основная дизайн-система строится вокруг 5 зон:

1. **Left Sidebar** — навигация.
2. **Data Explorer** — datasets, folders, files.
3. **SQL Workspace** — editor + tabs + actions.
4. **Inspector** — schema/profile/lineage/preview.
5. **Results Workspace** — table/chart/summary/execution.

Это должно создавать ощущение единого **Local Data Workspace**, а не набора независимых инструментов.
