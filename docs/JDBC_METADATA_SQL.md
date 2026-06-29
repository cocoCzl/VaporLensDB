# JDBC Metadata SQL

JDBC driver settings include a "metadata SQL" field. This field is an override
for JDBC object browsing metadata. Leave it empty when standard
`DatabaseMetaData` works well. Fill it only when a database needs dialect SQL
for schemas, tables, columns, indexes, foreign keys, routines, or DDL/source.

PostgreSQL and MySQL JDBC templates usually work without metadata SQL because
the bridge can use standard JDBC metadata. The examples below are useful when a
custom template needs deterministic SQL, better aliases, or extra object types.

## Format

The value must be a strict JSON object. Each property is one SQL statement:

```json
{
  "databases": "SELECT ... AS name",
  "schemas": "SELECT ... AS name, ... AS database_name",
  "tables": "SELECT ... AS schema_name, ... AS name, ... AS table_type",
  "views": "SELECT ... AS schema_name, ... AS name, ... AS table_type",
  "columns": "SELECT ... AS schema_name, ... AS table_name, ... AS name",
  "indexes": "SELECT ... AS schema_name, ... AS table_name, ... AS name",
  "foreignKeys": "SELECT ... AS schema_name, ... AS table_name, ... AS name",
  "functions": "SELECT ... AS name",
  "schemaObjects": "SELECT ... AS schema_name, ... AS name, ... AS kind",
  "tableDdl": "SELECT ... AS ddl",
  "objectDdl": "SELECT ... AS ddl"
}
```

All keys are optional, but the Object Tree needs at least `databases`,
`schemas`, `tables`, `views`, `columns`, `indexes`, and `foreignKeys` for full
table browsing. `functions`, `schemaObjects`, `tableDdl`, and `objectDdl`
enable richer routine/object folders and DDL/source panels.

Supported placeholders:

- `{database}`: database/catalog selected by the tree.
- `{schema}`: schema name, or MySQL database name.
- `{table}`: table or view name.
- `{kind}`: object kind, such as `table`, `view`, `function`, `procedure`,
  `sequence`, `trigger`, or `event`.
- `{name}`: object name for `objectDdl`.

Placeholders are replaced as SQL string literal content with single quotes
escaped. Put them inside quotes in SQL, for example `WHERE table_schema =
'{schema}'`.

## Result Columns

Use these aliases so VaporLensDB can map SQL results into metadata models:

| Operation | Required aliases | Optional aliases |
| --- | --- | --- |
| `databases` | `name` | `database`, `database_name` |
| `schemas` | `name` | `database`, `database_name` |
| `tables`, `views` | `schema_name`, `name`, `table_type` | `row_count` |
| `columns` | `schema_name`, `table_name`, `name`, `ordinal_position`, `data_type` | `nullable`, `default_value`, `character_maximum_length`, `numeric_precision`, `numeric_scale`, `is_primary_key` |
| `indexes` | `schema_name`, `table_name`, `name` | `column_names`, `is_unique`, `definition` |
| `foreignKeys` | `schema_name`, `table_name`, `name`, `referenced_table` | `column_names`, `referenced_schema`, `referenced_columns` |
| `functions` | `name` | `function`, `function_name` |
| `schemaObjects` | `schema_name`, `name`, `kind` | `object_type`, `status` |
| `tableDdl`, `objectDdl` | `ddl` | `definition`, `source` |

Avoid reserved or ambiguous aliases such as bare `schema`, `columns`, and
`unique`; use `schema_name`, `column_names`, and `is_unique` instead.
Boolean-like values may be returned as booleans, `1`/`0`, `true`/`false`, or
`yes`/`no`.

## Oracle

The built-in Oracle template uses SQL against `ALL_*` views, not `DBA_*` views,
so normal object visibility rules apply. `DBMS_METADATA.GET_DDL` may require
additional privileges depending on the Oracle environment.

```json
{
  "databases": "SELECT COALESCE(SYS_CONTEXT('USERENV', 'CON_NAME'), SYS_CONTEXT('USERENV', 'SERVICE_NAME'), SYS_CONTEXT('USERENV', 'DB_NAME')) AS name FROM dual",
  "schemas": "SELECT username AS name, COALESCE(SYS_CONTEXT('USERENV', 'CON_NAME'), SYS_CONTEXT('USERENV', 'SERVICE_NAME'), SYS_CONTEXT('USERENV', 'DB_NAME')) AS database FROM all_users ORDER BY CASE WHEN username = SYS_CONTEXT('USERENV', 'CURRENT_SCHEMA') THEN 0 WHEN username = USER THEN 1 ELSE 2 END, username",
  "tables": "SELECT owner AS schema_name, table_name AS name, 'table' AS table_type, num_rows AS row_count FROM all_tables WHERE owner = UPPER('{schema}') AND nested = 'NO' ORDER BY table_name",
  "views": "SELECT owner AS schema_name, view_name AS name, 'view' AS table_type, CAST(NULL AS NUMBER) AS row_count FROM all_views WHERE owner = UPPER('{schema}') ORDER BY view_name",
  "columns": "SELECT c.owner AS schema_name, c.table_name AS table_name, c.column_name AS name, c.column_id AS ordinal_position, c.data_type AS data_type, CASE WHEN c.nullable = 'Y' THEN 1 ELSE 0 END AS nullable, c.data_default AS default_value, c.char_length AS character_maximum_length, c.data_precision AS numeric_precision, c.data_scale AS numeric_scale, CASE WHEN pk.column_name IS NOT NULL THEN 1 ELSE 0 END AS is_primary_key FROM all_tab_columns c LEFT JOIN (SELECT acc.owner, acc.table_name, acc.column_name FROM all_constraints ac JOIN all_cons_columns acc ON acc.owner = ac.owner AND acc.constraint_name = ac.constraint_name AND acc.table_name = ac.table_name WHERE ac.constraint_type = 'P') pk ON pk.owner = c.owner AND pk.table_name = c.table_name AND pk.column_name = c.column_name WHERE c.owner = UPPER('{schema}') AND c.table_name = UPPER('{table}') ORDER BY c.column_id",
  "indexes": "SELECT i.owner AS schema_name, i.table_name AS table_name, i.index_name AS name, LISTAGG(ic.column_name, ', ') WITHIN GROUP (ORDER BY ic.column_position) AS column_names, CASE WHEN i.uniqueness = 'UNIQUE' THEN 1 ELSE 0 END AS is_unique, i.index_type AS definition FROM all_indexes i LEFT JOIN all_ind_columns ic ON ic.index_owner = i.owner AND ic.index_name = i.index_name WHERE i.owner = UPPER('{schema}') AND i.table_name = UPPER('{table}') GROUP BY i.owner, i.table_name, i.index_name, i.uniqueness, i.index_type ORDER BY i.index_name",
  "foreignKeys": "SELECT ac.owner AS schema_name, ac.table_name AS table_name, ac.constraint_name AS name, LISTAGG(acc.column_name, ', ') WITHIN GROUP (ORDER BY acc.position) AS column_names, rc.owner AS referenced_schema, rcc.table_name AS referenced_table, LISTAGG(rcc.column_name, ', ') WITHIN GROUP (ORDER BY rcc.position) AS referenced_columns FROM all_constraints ac JOIN all_cons_columns acc ON acc.owner = ac.owner AND acc.constraint_name = ac.constraint_name AND acc.table_name = ac.table_name JOIN all_constraints rc ON rc.owner = ac.r_owner AND rc.constraint_name = ac.r_constraint_name JOIN all_cons_columns rcc ON rcc.owner = rc.owner AND rcc.constraint_name = rc.constraint_name AND rcc.position = acc.position WHERE ac.constraint_type = 'R' AND ac.owner = UPPER('{schema}') AND ac.table_name = UPPER('{table}') GROUP BY ac.owner, ac.table_name, ac.constraint_name, rc.owner, rcc.table_name ORDER BY ac.constraint_name",
  "functions": "SELECT owner AS schema_name, object_name AS name FROM all_objects WHERE owner = UPPER('{schema}') AND object_type = 'FUNCTION' ORDER BY object_name",
  "schemaObjects": "SELECT owner AS schema_name, object_name AS name, CASE object_type WHEN 'TABLE' THEN 'table' WHEN 'VIEW' THEN 'view' WHEN 'MATERIALIZED VIEW' THEN 'materializedView' WHEN 'INDEX' THEN 'index' WHEN 'PROCEDURE' THEN 'procedure' WHEN 'FUNCTION' THEN 'function' WHEN 'PACKAGE' THEN 'package' WHEN 'SEQUENCE' THEN 'sequence' WHEN 'TRIGGER' THEN 'trigger' WHEN 'SYNONYM' THEN 'synonym' ELSE LOWER(object_type) END AS kind, object_type, status FROM all_objects WHERE owner = UPPER('{schema}') AND object_type = CASE '{kind}' WHEN 'table' THEN 'TABLE' WHEN 'view' THEN 'VIEW' WHEN 'materializedView' THEN 'MATERIALIZED VIEW' WHEN 'index' THEN 'INDEX' WHEN 'procedure' THEN 'PROCEDURE' WHEN 'function' THEN 'FUNCTION' WHEN 'package' THEN 'PACKAGE' WHEN 'sequence' THEN 'SEQUENCE' WHEN 'trigger' THEN 'TRIGGER' WHEN 'synonym' THEN 'SYNONYM' ELSE UPPER('{kind}') END ORDER BY object_name",
  "tableDdl": "SELECT DBMS_METADATA.GET_DDL(CASE WHEN o.object_type = 'MATERIALIZED VIEW' THEN 'MATERIALIZED_VIEW' ELSE o.object_type END, UPPER('{table}'), UPPER('{schema}')) AS ddl FROM all_objects o WHERE o.owner = UPPER('{schema}') AND o.object_name = UPPER('{table}') AND o.object_type IN ('TABLE', 'VIEW', 'MATERIALIZED VIEW') FETCH FIRST 1 ROW ONLY",
  "objectDdl": "SELECT DBMS_METADATA.GET_DDL(CASE '{kind}' WHEN 'table' THEN 'TABLE' WHEN 'view' THEN 'VIEW' WHEN 'materializedView' THEN 'MATERIALIZED_VIEW' WHEN 'index' THEN 'INDEX' WHEN 'sequence' THEN 'SEQUENCE' WHEN 'synonym' THEN 'SYNONYM' ELSE UPPER('{kind}') END, UPPER('{name}'), UPPER('{schema}')) AS ddl FROM dual"
}
```

## PostgreSQL

PostgreSQL metadata comes from `pg_database`, `information_schema`, and
`pg_catalog`. For JDBC templates, use literal placeholders rather than `$1`
parameters because the metadata SQL is executed as a normal query string.

```json
{
  "databases": "SELECT datname AS name FROM pg_database WHERE datistemplate = false ORDER BY datname",
  "schemas": "SELECT schema_name AS name, current_database() AS database_name FROM information_schema.schemata WHERE schema_name NOT LIKE 'pg_%' AND schema_name <> 'information_schema' ORDER BY schema_name",
  "tables": "SELECT table_schema AS schema_name, table_name AS name, table_type, CAST(NULL AS bigint) AS row_count FROM information_schema.tables WHERE table_schema = '{schema}' AND table_type = 'BASE TABLE' ORDER BY table_name",
  "views": "SELECT table_schema AS schema_name, table_name AS name, 'view' AS table_type, CAST(NULL AS bigint) AS row_count FROM information_schema.views WHERE table_schema = '{schema}' ORDER BY table_name",
  "columns": "SELECT c.table_schema AS schema_name, c.table_name AS table_name, c.column_name AS name, c.ordinal_position, c.data_type, CASE WHEN c.is_nullable = 'YES' THEN 1 ELSE 0 END AS nullable, c.column_default AS default_value, c.character_maximum_length, c.numeric_precision, c.numeric_scale, CASE WHEN kcu.column_name IS NOT NULL THEN 1 ELSE 0 END AS is_primary_key FROM information_schema.columns c LEFT JOIN information_schema.table_constraints tc ON tc.table_schema = c.table_schema AND tc.table_name = c.table_name AND tc.constraint_type = 'PRIMARY KEY' LEFT JOIN information_schema.key_column_usage kcu ON kcu.constraint_name = tc.constraint_name AND kcu.table_schema = tc.table_schema AND kcu.table_name = tc.table_name AND kcu.column_name = c.column_name WHERE c.table_schema = '{schema}' AND c.table_name = '{table}' ORDER BY c.ordinal_position",
  "indexes": "SELECT i.schemaname AS schema_name, i.tablename AS table_name, i.indexname AS name, string_agg(a.attname::text, ', ' ORDER BY key_order.ordinality) AS column_names, pgidx.indisunique AS is_unique, i.indexdef AS definition FROM pg_indexes i JOIN pg_class tbl ON tbl.relname = i.tablename JOIN pg_namespace ns ON ns.oid = tbl.relnamespace AND ns.nspname = i.schemaname JOIN pg_class idx ON idx.relname = i.indexname AND idx.relnamespace = ns.oid JOIN pg_index pgidx ON pgidx.indexrelid = idx.oid LEFT JOIN LATERAL unnest(pgidx.indkey) WITH ORDINALITY AS key_order(attnum, ordinality) ON true LEFT JOIN pg_attribute a ON a.attrelid = tbl.oid AND a.attnum = key_order.attnum WHERE i.schemaname = '{schema}' AND i.tablename = '{table}' GROUP BY i.schemaname, i.tablename, i.indexname, i.indexdef, pgidx.indisunique ORDER BY i.indexname",
  "foreignKeys": "SELECT tc.table_schema AS schema_name, tc.table_name AS table_name, tc.constraint_name AS name, string_agg(kcu.column_name::text, ', ' ORDER BY kcu.ordinal_position) AS column_names, ccu.table_schema AS referenced_schema, ccu.table_name AS referenced_table, string_agg(ccu.column_name::text, ', ' ORDER BY kcu.ordinal_position) AS referenced_columns FROM information_schema.table_constraints tc JOIN information_schema.key_column_usage kcu ON tc.constraint_name = kcu.constraint_name AND tc.table_schema = kcu.table_schema AND tc.table_name = kcu.table_name JOIN information_schema.constraint_column_usage ccu ON ccu.constraint_name = tc.constraint_name AND ccu.table_schema = tc.table_schema WHERE tc.constraint_type = 'FOREIGN KEY' AND tc.table_schema = '{schema}' AND tc.table_name = '{table}' GROUP BY tc.table_schema, tc.table_name, tc.constraint_name, ccu.table_schema, ccu.table_name ORDER BY tc.constraint_name",
  "functions": "SELECT routine_schema AS schema_name, routine_name AS name FROM information_schema.routines WHERE routine_schema = '{schema}' ORDER BY routine_name",
  "schemaObjects": "SELECT n.nspname AS schema_name, c.relname AS name, CASE c.relkind WHEN 'r' THEN 'table' WHEN 'v' THEN 'view' WHEN 'm' THEN 'materializedView' WHEN 'i' THEN 'index' WHEN 'S' THEN 'sequence' ELSE c.relkind::text END AS kind, c.relkind::text AS object_type, NULL AS status FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = '{schema}' AND c.relkind = CASE '{kind}' WHEN 'table' THEN 'r' WHEN 'view' THEN 'v' WHEN 'materializedView' THEN 'm' WHEN 'index' THEN 'i' WHEN 'sequence' THEN 'S' ELSE c.relkind END ORDER BY c.relname"
}
```

Use the native PostgreSQL driver path for generated DDL. A JDBC metadata SQL
template can add `tableDdl` or `objectDdl`, but the query must return a column
aliased as `ddl`, `definition`, or `source`.

## MySQL

MySQL uses databases as schemas in the Object Tree. In these templates,
`{schema}` is the MySQL database name.

```json
{
  "databases": "SELECT schema_name AS name FROM information_schema.schemata ORDER BY schema_name",
  "schemas": "SELECT schema_name AS name, schema_name AS database_name FROM information_schema.schemata ORDER BY schema_name",
  "tables": "SELECT table_schema AS schema_name, table_name AS name, table_type, table_rows AS row_count FROM information_schema.tables WHERE table_schema = '{schema}' AND table_type = 'BASE TABLE' ORDER BY table_name",
  "views": "SELECT table_schema AS schema_name, table_name AS name, table_type, table_rows AS row_count FROM information_schema.tables WHERE table_schema = '{schema}' AND table_type = 'VIEW' ORDER BY table_name",
  "columns": "SELECT table_schema AS schema_name, table_name AS table_name, column_name AS name, ordinal_position, column_type AS data_type, CASE WHEN is_nullable = 'YES' THEN 1 ELSE 0 END AS nullable, column_default AS default_value, character_maximum_length, numeric_precision, numeric_scale, CASE WHEN column_key = 'PRI' THEN 1 ELSE 0 END AS is_primary_key FROM information_schema.columns WHERE table_schema = '{schema}' AND table_name = '{table}' ORDER BY ordinal_position",
  "indexes": "SELECT table_schema AS schema_name, table_name AS table_name, index_name AS name, GROUP_CONCAT(column_name ORDER BY seq_in_index SEPARATOR ', ') AS column_names, CASE WHEN MIN(non_unique) = 0 THEN 1 ELSE 0 END AS is_unique, NULL AS definition FROM information_schema.statistics WHERE table_schema = '{schema}' AND table_name = '{table}' GROUP BY table_schema, table_name, index_name ORDER BY index_name",
  "foreignKeys": "SELECT table_schema AS schema_name, table_name AS table_name, constraint_name AS name, GROUP_CONCAT(column_name ORDER BY ordinal_position SEPARATOR ', ') AS column_names, referenced_table_schema AS referenced_schema, referenced_table_name AS referenced_table, GROUP_CONCAT(referenced_column_name ORDER BY ordinal_position SEPARATOR ', ') AS referenced_columns FROM information_schema.key_column_usage WHERE table_schema = '{schema}' AND table_name = '{table}' AND referenced_table_name IS NOT NULL GROUP BY table_schema, table_name, constraint_name, referenced_table_schema, referenced_table_name ORDER BY constraint_name",
  "functions": "SELECT routine_schema AS schema_name, routine_name AS name FROM information_schema.routines WHERE routine_schema = '{schema}' ORDER BY routine_name",
  "schemaObjects": "SELECT table_schema AS schema_name, table_name AS name, CASE table_type WHEN 'BASE TABLE' THEN 'table' WHEN 'VIEW' THEN 'view' ELSE LOWER(table_type) END AS kind, table_type AS object_type, NULL AS status FROM information_schema.tables WHERE table_schema = '{schema}' AND CASE '{kind}' WHEN 'table' THEN table_type = 'BASE TABLE' WHEN 'view' THEN table_type = 'VIEW' ELSE false END UNION ALL SELECT routine_schema AS schema_name, routine_name AS name, LOWER(routine_type) AS kind, routine_type AS object_type, NULL AS status FROM information_schema.routines WHERE routine_schema = '{schema}' AND LOWER(routine_type) = LOWER('{kind}') ORDER BY name"
}
```

For MySQL `SHOW CREATE TABLE`, the JDBC result column is usually named
`Create Table`, not `ddl`. Add `tableDdl` or `objectDdl` only after confirming
the query returns a column that VaporLensDB can map to `ddl`, `definition`, or
`source`. For reliable DDL in the built-in MySQL path, use the native MySQL
driver.

## Adding Another Database

1. Start without metadata SQL and test standard JDBC metadata first.
2. Add only the keys needed to fix missing or incorrect browsing behavior.
3. Alias every selected column to the names in "Result Columns".
4. Keep SQL read-only and avoid private endpoints, credentials, or local file
   paths in committed templates.
5. Validate connection, query execution, Object Tree loading, columns,
   indexes, and foreign keys against a real database before publishing a
   template.
