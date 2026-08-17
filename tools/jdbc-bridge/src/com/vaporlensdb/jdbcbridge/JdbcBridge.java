package com.vaporlensdb.jdbcbridge;

import java.io.BufferedReader;
import java.io.InputStreamReader;
import java.io.Reader;
import java.nio.charset.StandardCharsets;
import java.sql.Clob;
import java.sql.Blob;
import java.sql.Connection;
import java.sql.DatabaseMetaData;
import java.sql.DriverManager;
import java.sql.ResultSet;
import java.sql.ResultSetMetaData;
import java.sql.Statement;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Base64;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Properties;
import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

public final class JdbcBridge {
    private static final int DEFAULT_CONNECT_TIMEOUT_SECONDS = 15;
    private static final int DEFAULT_QUERY_TIMEOUT_SECONDS = 60;
    private static final int MAX_INTERACTIVE_RESULT_ROWS = 50_000;
    private static final int MAX_STREAM_CHUNK_SIZE = 2_000;
    private static final Pattern STREAM_SQL_PATTERN = Pattern.compile("\\\"sql\\\"\\s*:\\s*\\\"([A-Za-z0-9+/=]+)\\\"");
    private static final Pattern STREAM_CHUNK_SIZE_PATTERN = Pattern.compile("\\\"chunkSize\\\"\\s*:\\s*(\\d+)");
    private static final Pattern STREAM_MAX_ROWS_PATTERN = Pattern.compile("\\\"maxRows\\\"\\s*:\\s*(\\d+)");

    private JdbcBridge() {
    }

    public static void main(String[] args) throws Exception {
        if (args.length < 1) {
            throw new IllegalArgumentException(
                    "usage: JdbcBridge <ping|query|server> <driverClass> <url> <username> <password> [sql|connectTimeoutSeconds queryTimeoutSeconds]");
        }

        String command = args[0];
        if ("server".equals(command)) {
            server();
            return;
        }

        if (args.length < 4) {
            throw new IllegalArgumentException("driver class, URL and username are required");
        }
        String driverClass = args[1];
        String url = args[2];
        String username = args[3];
        String password = args.length >= 5 ? args[4] : "";
        int connectTimeoutSeconds = args.length >= 6 ? parsePositiveInt(args[5], DEFAULT_CONNECT_TIMEOUT_SECONDS)
                : DEFAULT_CONNECT_TIMEOUT_SECONDS;
        int queryTimeoutSeconds = args.length >= 7 ? parsePositiveInt(args[6], DEFAULT_QUERY_TIMEOUT_SECONDS)
                : DEFAULT_QUERY_TIMEOUT_SECONDS;

        Class.forName(driverClass);
        DriverManager.setLoginTimeout(connectTimeoutSeconds);

        Properties properties = new Properties();
        if (!username.isEmpty()) {
            properties.setProperty("user", username);
        }
        if (!password.isEmpty()) {
            properties.setProperty("password", password);
        }

        try (Connection connection = DriverManager.getConnection(url, properties)) {
            switch (command) {
                case "ping" -> System.out.println(ping(connection));
                case "query" -> {
                    if (args.length < 8) {
                        throw new IllegalArgumentException("query command requires SQL");
                    }
                    System.out.println(query(connection, args[7], queryTimeoutSeconds));
                }
                default -> throw new IllegalArgumentException("unsupported command: " + command);
            }
        }
    }

    private static void server() throws Exception {
        BufferedReader reader = new BufferedReader(new InputStreamReader(System.in, StandardCharsets.UTF_8));
        String line = reader.readLine();
        if (line == null) {
            return;
        }

        String[] init = line.split("\\t", 8);
        if (init.length != 8 || !"INIT".equals(init[0]) || !"0".equals(init[1])) {
            throw new IllegalArgumentException("JDBC bridge requires an INIT request");
        }

        String driverClass = decode(init[2]);
        String url = decode(init[3]);
        String username = decode(init[4]);
        String password = decode(init[5]);
        int connectTimeoutSeconds = parsePositiveInt(init[6], DEFAULT_CONNECT_TIMEOUT_SECONDS);
        int queryTimeoutSeconds = parsePositiveInt(init[7], DEFAULT_QUERY_TIMEOUT_SECONDS);

        Class.forName(driverClass);
        DriverManager.setLoginTimeout(connectTimeoutSeconds);
        Properties properties = new Properties();
        if (!username.isEmpty()) {
            properties.setProperty("user", username);
        }
        if (!password.isEmpty()) {
            properties.setProperty("password", password);
        }

        try (Connection connection = DriverManager.getConnection(url, properties)) {
            respondOk("0", "{\"ok\":true}");
            serveRequests(reader, connection, queryTimeoutSeconds);
        }
    }

    private static void serveRequests(BufferedReader reader, Connection connection, int queryTimeoutSeconds) throws Exception {
        Map<String, Statement> activeStatements = new ConcurrentHashMap<>();
        Set<String> cancelledRequests = ConcurrentHashMap.newKeySet();
        String line;
        while ((line = reader.readLine()) != null) {
            if (line.isEmpty()) {
                continue;
            }
            String[] parts = line.split("\t", 3);
            String command = parts[0];
            String requestId = parts.length >= 2 ? parts[1] : "0";
            try {
                switch (command) {
                    case "PING" -> respondOk(requestId, ping(connection));
                    case "QUERY" -> {
                        if (parts.length < 3) {
                            throw new IllegalArgumentException("QUERY command requires SQL payload");
                        }
                        String sql = decode(parts[2]);
                        respondOk(requestId, query(connection, sql, queryTimeoutSeconds));
                    }
                    case "QUERY_STREAM" -> {
                        if (parts.length < 3) {
                            throw new IllegalArgumentException("QUERY_STREAM command requires SQL payload");
                        }
                        StreamQueryRequest request = streamQueryRequest(decode(parts[2]));
                        String streamRequestId = requestId;
                        executeAsync(streamRequestId, () -> queryStream(
                                connection,
                                request,
                                queryTimeoutSeconds,
                                streamRequestId,
                                activeStatements,
                                cancelledRequests));
                    }
                    case "CANCEL" -> {
                        if (parts.length < 3 || parts[2].isBlank()) {
                            throw new IllegalArgumentException("CANCEL command requires a request id");
                        }
                        String targetRequestId = parts[2];
                        cancelledRequests.add(targetRequestId);
                        Statement activeStatement = activeStatements.get(targetRequestId);
                        if (activeStatement != null) {
                            activeStatement.cancel();
                        }
                    }
                    case "METADATA" -> {
                        if (parts.length < 3) {
                            throw new IllegalArgumentException("METADATA command requires payload");
                        }
                        respondOk(requestId, metadata(connection, decode(parts[2])));
                    }
                    case "CLOSE" -> {
                        respondOk(requestId, "{\"ok\":true}");
                        return;
                    }
                    default -> throw new IllegalArgumentException("unsupported command: " + command);
                }
            } catch (Exception error) {
                respondErr(requestId, error.getMessage() == null ? error.toString() : error.getMessage());
            }
        }
    }

    private static String ping(Connection connection) throws Exception {
        DatabaseMetaData metaData = connection.getMetaData();
        return "{\"ok\":true,\"databaseProductName\":\""
                + json(metaData.getDatabaseProductName()) + "\",\"databaseProductVersion\":\""
                + json(metaData.getDatabaseProductVersion()) + "\"}";
    }

    private static String query(Connection connection, String sql, int queryTimeoutSeconds) throws Exception {
        long start = System.currentTimeMillis();
        try (Statement statement = connection.createStatement()) {
            statement.setQueryTimeout(queryTimeoutSeconds);
            // Avoid a driver default that prefetches an unbounded result window.
            // The Rust side still applies its own interactive result limit.
            statement.setFetchSize(1_000);
            statement.setMaxRows(MAX_INTERACTIVE_RESULT_ROWS);
            boolean hasResultSet = statement.execute(sql);
            long elapsedMs = System.currentTimeMillis() - start;

            if (!hasResultSet) {
                int updateCount = statement.getUpdateCount();
                return "{\"columns\":[],\"rows\":[],\"rowCount\":0,\"affectedRows\":"
                        + Math.max(updateCount, 0) + ",\"elapsedMs\":" + elapsedMs + "}";
            }

            try (ResultSet resultSet = statement.getResultSet()) {
                ResultSetMetaData metaData = resultSet.getMetaData();
                int columnCount = metaData.getColumnCount();
                StringBuilder output = new StringBuilder();
                long rowCount = 0;

                output.append("{\"columns\":[");
                for (int index = 1; index <= columnCount; index += 1) {
                    if (index > 1) {
                        output.append(',');
                    }
                    output.append("{\"name\":\"")
                            .append(json(metaData.getColumnLabel(index)))
                            .append("\",\"dataType\":\"")
                            .append(json(metaData.getColumnTypeName(index)))
                            .append("\",\"nullable\":")
                            .append(metaData.isNullable(index) != ResultSetMetaData.columnNoNulls)
                            .append('}');
                }
                output.append("],\"rows\":[");

                while (resultSet.next()) {
                    if (rowCount > 0) {
                        output.append(',');
                    }
                    output.append('[');
                    for (int index = 1; index <= columnCount; index += 1) {
                        if (index > 1) {
                            output.append(',');
                        }
                        appendJsonValue(output, resultValue(resultSet, index));
                    }
                    output.append(']');
                    rowCount += 1;
                }

                output.append("],\"rowCount\":")
                        .append(rowCount)
                        .append(",\"affectedRows\":0,\"elapsedMs\":")
                        .append(elapsedMs)
                        .append('}');
                return output.toString();
            }
        }
    }

    private static void queryStream(
            Connection connection,
            StreamQueryRequest request,
            int queryTimeoutSeconds,
            String requestId,
            Map<String, Statement> activeStatements,
            Set<String> cancelledRequests) throws Exception {
        long start = System.currentTimeMillis();
        try (Statement statement = connection.createStatement()) {
            activeStatements.put(requestId, statement);
            if (cancelledRequests.contains(requestId)) {
                throw new java.sql.SQLException("query cancelled");
            }
            statement.setQueryTimeout(queryTimeoutSeconds);
            statement.setFetchSize(request.chunkSize());
            // Ask for one extra row so the final frame reports truncation
            // truthfully, while still bounding the driver-side result window.
            if (request.maxRows() != null && request.maxRows() < Integer.MAX_VALUE) {
                statement.setMaxRows((int) (request.maxRows() + 1));
            }
            boolean hasResultSet = statement.execute(request.sql());
            if (!hasResultSet) {
                respondOk(requestId, "{\"rowCount\":0,\"affectedRows\":" + Math.max(statement.getUpdateCount(), 0)
                        + ",\"elapsedMs\":" + (System.currentTimeMillis() - start)
                        + ",\"truncated\":false,\"maxRows\":" + maxRowsJson(request.maxRows()) + "}");
                return;
            }
            try (ResultSet resultSet = statement.getResultSet()) {
                ResultSetMetaData metaData = resultSet.getMetaData();
                int columnCount = metaData.getColumnCount();
                String columns = columnsJson(metaData, columnCount);
                List<String> rows = new ArrayList<>(request.chunkSize());
                long rowCount = 0;
                boolean truncated = false;
                while (resultSet.next()) {
                    if (request.maxRows() != null && rowCount >= request.maxRows()) {
                        truncated = true;
                        break;
                    }
                    StringBuilder row = new StringBuilder("[");
                    for (int index = 1; index <= columnCount; index += 1) {
                        if (index > 1) row.append(',');
                        appendJsonValue(row, resultValue(resultSet, index));
                    }
                    row.append(']');
                    rows.add(row.toString());
                    rowCount += 1;
                    if (rows.size() == request.chunkSize()) {
                        respond("CHUNK", requestId, "{\"columns\":" + columns + ",\"rows\":[" + String.join(",", rows) + "]}");
                        rows.clear();
                    }
                }
                if (!rows.isEmpty() || rowCount == 0) {
                    respond("CHUNK", requestId, "{\"columns\":" + columns + ",\"rows\":[" + String.join(",", rows) + "]}");
                }
                respondOk(requestId, "{\"rowCount\":" + rowCount + ",\"affectedRows\":0,\"elapsedMs\":"
                        + (System.currentTimeMillis() - start) + ",\"truncated\":" + truncated
                        + ",\"maxRows\":" + maxRowsJson(request.maxRows()) + "}");
            }
        } finally {
            activeStatements.remove(requestId);
            cancelledRequests.remove(requestId);
        }
    }

    private static void executeAsync(String requestId, JdbcRequest request) {
        Thread worker = new Thread(() -> {
            try {
                request.run();
            } catch (Exception error) {
                respondErr(requestId, error.getMessage() == null ? error.toString() : error.getMessage());
            }
        }, "vaporlensdb-jdbc-query-" + requestId);
        worker.setDaemon(true);
        worker.start();
    }

    @FunctionalInterface
    private interface JdbcRequest {
        void run() throws Exception;
    }

    private static StreamQueryRequest streamQueryRequest(String payload) {
        String encodedSql = requiredJsonString(payload, STREAM_SQL_PATTERN, "sql");
        int chunkSize = parsePositiveInt(requiredJsonString(payload, STREAM_CHUNK_SIZE_PATTERN, "chunkSize"), 1);
        chunkSize = Math.min(chunkSize, MAX_STREAM_CHUNK_SIZE);
        Long maxRows = optionalPositiveLong(payload, STREAM_MAX_ROWS_PATTERN);
        return new StreamQueryRequest(decode(encodedSql), chunkSize, maxRows);
    }

    private static String requiredJsonString(String payload, Pattern pattern, String field) {
        Matcher matcher = pattern.matcher(payload);
        if (!matcher.find()) {
            throw new IllegalArgumentException("QUERY_STREAM payload requires " + field);
        }
        return matcher.group(1);
    }

    private static Long optionalPositiveLong(String payload, Pattern pattern) {
        Matcher matcher = pattern.matcher(payload);
        if (!matcher.find()) {
            return null;
        }
        try {
            long value = Long.parseLong(matcher.group(1));
            if (value < 1) {
                throw new IllegalArgumentException("QUERY_STREAM maxRows must be positive");
            }
            return value;
        } catch (NumberFormatException error) {
            throw new IllegalArgumentException("QUERY_STREAM maxRows is invalid", error);
        }
    }

    private static String maxRowsJson(Long maxRows) {
        return maxRows == null ? "null" : maxRows.toString();
    }

    private record StreamQueryRequest(String sql, int chunkSize, Long maxRows) {
    }

    private static String columnsJson(ResultSetMetaData metaData, int columnCount) throws Exception {
        StringBuilder columns = new StringBuilder("[");
        for (int index = 1; index <= columnCount; index += 1) {
            if (index > 1) columns.append(',');
            columns.append("{\"name\":\"").append(json(metaData.getColumnLabel(index)))
                    .append("\",\"dataType\":\"").append(json(metaData.getColumnTypeName(index)))
                    .append("\",\"nullable\":").append(metaData.isNullable(index) != ResultSetMetaData.columnNoNulls).append('}');
        }
        return columns.append(']').toString();
    }

    private static String metadata(Connection connection, String payload) throws Exception {
        String[] parts = payload.split("\t", -1);
        String operation = parts.length > 0 ? parts[0] : "";
        String schema = parts.length > 1 && !parts[1].isEmpty() ? parts[1] : null;
        String table = parts.length > 2 && !parts[2].isEmpty() ? parts[2] : null;
        DatabaseMetaData metaData = connection.getMetaData();
        String product = safe(metaData.getDatabaseProductName()).toLowerCase();
        String catalog = catalogFor(product, schema);
        String schemaPattern = schemaPatternFor(product, schema);

        return switch (operation) {
            case "databases" -> databases(metaData, product);
            case "schemas" -> schemas(metaData, product);
            case "tables" -> tables(metaData, catalog, schemaPattern, new String[] { "TABLE" }, "table");
            case "views" -> tables(metaData, catalog, schemaPattern, new String[] { "VIEW" }, "view");
            case "columns" -> columns(metaData, catalog, schemaPattern, table);
            case "indexes" -> indexes(metaData, catalog, schemaPattern, table);
            case "foreignKeys" -> foreignKeys(metaData, catalog, schemaPattern, table);
            default -> throw new IllegalArgumentException("unsupported metadata operation: " + operation);
        };
    }

    private static String databases(DatabaseMetaData metaData, String product) throws Exception {
        List<List<Object>> rows = new ArrayList<>();
        try (ResultSet resultSet = metaData.getCatalogs()) {
            while (resultSet.next()) {
                rows.add(row(resultSet.getString("TABLE_CAT")));
            }
        }
        if (rows.isEmpty()) {
            String user = safe(metaData.getUserName());
            rows.add(row(product.contains("sqlite") ? "main" : user));
        }
        return result(new String[] { "name" }, rows);
    }

    private static String schemas(DatabaseMetaData metaData, String product) throws Exception {
        List<List<Object>> rows = new ArrayList<>();
        if (product.contains("mysql") || product.contains("mariadb")) {
            try (ResultSet resultSet = metaData.getCatalogs()) {
                while (resultSet.next()) {
                    String catalog = resultSet.getString("TABLE_CAT");
                    rows.add(row(catalog, catalog));
                }
            }
        } else if (product.contains("sqlite")) {
            rows.add(row("main", "main"));
        } else {
            try (ResultSet resultSet = metaData.getSchemas()) {
                while (resultSet.next()) {
                    rows.add(row(
                            resultSet.getString("TABLE_SCHEM"),
                            nullableColumn(resultSet, "TABLE_CATALOG")));
                }
            }
        }
        return result(new String[] { "name", "database" }, rows);
    }

    private static String tables(
            DatabaseMetaData metaData,
            String catalog,
            String schemaPattern,
            String[] types,
            String fallbackType) throws Exception {
        List<List<Object>> rows = new ArrayList<>();
        try (ResultSet resultSet = metaData.getTables(catalog, schemaPattern, "%", types)) {
            while (resultSet.next()) {
                String schema = firstNonEmpty(
                        nullableColumn(resultSet, "TABLE_SCHEM"),
                        nullableColumn(resultSet, "TABLE_CAT"),
                        catalog,
                        schemaPattern);
                rows.add(row(
                        schema,
                        resultSet.getString("TABLE_NAME"),
                        firstNonEmpty(nullableColumn(resultSet, "TABLE_TYPE"), fallbackType),
                        null));
            }
        }
        return result(new String[] { "schema_name", "name", "table_type", "row_count" }, rows);
    }

    private static String columns(DatabaseMetaData metaData, String catalog, String schemaPattern, String table)
            throws Exception {
        Set<String> primaryKeys = new LinkedHashSet<>();
        try (ResultSet resultSet = metaData.getPrimaryKeys(catalog, schemaPattern, table)) {
            while (resultSet.next()) {
                primaryKeys.add(resultSet.getString("COLUMN_NAME"));
            }
        }

        List<List<Object>> rows = new ArrayList<>();
        try (ResultSet resultSet = metaData.getColumns(catalog, schemaPattern, table, "%")) {
            while (resultSet.next()) {
                String column = resultSet.getString("COLUMN_NAME");
                rows.add(row(
                        firstNonEmpty(nullableColumn(resultSet, "TABLE_SCHEM"), nullableColumn(resultSet, "TABLE_CAT"),
                                catalog, schemaPattern),
                        resultSet.getString("TABLE_NAME"),
                        column,
                        resultSet.getInt("ORDINAL_POSITION"),
                        resultSet.getString("TYPE_NAME"),
                        resultSet.getInt("NULLABLE") != DatabaseMetaData.columnNoNulls,
                        nullableColumn(resultSet, "COLUMN_DEF"),
                        nullableInt(resultSet, "COLUMN_SIZE"),
                        nullableInt(resultSet, "COLUMN_SIZE"),
                        nullableInt(resultSet, "DECIMAL_DIGITS"),
                        primaryKeys.contains(column)));
            }
        }
        return result(
                new String[] { "schema_name", "table_name", "name", "ordinal_position", "data_type", "nullable",
                        "default_value", "character_maximum_length", "numeric_precision", "numeric_scale",
                        "is_primary_key" },
                rows);
    }

    private static String indexes(DatabaseMetaData metaData, String catalog, String schemaPattern, String table)
            throws Exception {
        Map<String, IndexRow> indexes = new LinkedHashMap<>();
        try (ResultSet resultSet = metaData.getIndexInfo(catalog, schemaPattern, table, false, false)) {
            while (resultSet.next()) {
                String name = nullableColumn(resultSet, "INDEX_NAME");
                String column = nullableColumn(resultSet, "COLUMN_NAME");
                if (name == null || name.isEmpty() || column == null || column.isEmpty()) {
                    continue;
                }
                IndexRow row = indexes.computeIfAbsent(name, key -> new IndexRow(
                        firstNonEmpty(nullableColumn(resultSet, "TABLE_SCHEM"), nullableColumn(resultSet, "TABLE_CAT"),
                                catalog, schemaPattern),
                        nullableColumn(resultSet, "TABLE_NAME"),
                        key,
                        !safeBool(resultSet, "NON_UNIQUE")));
                row.columns.add(column);
            }
        }
        List<List<Object>> rows = new ArrayList<>();
        for (IndexRow index : indexes.values()) {
            rows.add(row(index.schema, index.table, index.name, String.join(", ", index.columns), index.unique, null));
        }
        return result(new String[] { "schema_name", "table_name", "name", "column_names", "is_unique", "definition" },
                rows);
    }

    private static String foreignKeys(DatabaseMetaData metaData, String catalog, String schemaPattern, String table)
            throws Exception {
        Map<String, ForeignKeyRow> keys = new LinkedHashMap<>();
        try (ResultSet resultSet = metaData.getImportedKeys(catalog, schemaPattern, table)) {
            while (resultSet.next()) {
                String name = firstNonEmpty(nullableColumn(resultSet, "FK_NAME"),
                        nullableColumn(resultSet, "PK_NAME"), "fk_" + keys.size());
                ForeignKeyRow row = keys.computeIfAbsent(name, key -> new ForeignKeyRow(
                        firstNonEmpty(nullableColumn(resultSet, "FKTABLE_SCHEM"), nullableColumn(resultSet, "FKTABLE_CAT"),
                                catalog, schemaPattern),
                        nullableColumn(resultSet, "FKTABLE_NAME"),
                        key,
                        firstNonEmpty(nullableColumn(resultSet, "PKTABLE_SCHEM"), nullableColumn(resultSet, "PKTABLE_CAT")),
                        nullableColumn(resultSet, "PKTABLE_NAME")));
                row.columns.add(resultSet.getString("FKCOLUMN_NAME"));
                row.referencedColumns.add(resultSet.getString("PKCOLUMN_NAME"));
            }
        }
        List<List<Object>> rows = new ArrayList<>();
        for (ForeignKeyRow key : keys.values()) {
            rows.add(row(key.schema, key.table, key.name, String.join(", ", key.columns),
                    key.referencedSchema, key.referencedTable, String.join(", ", key.referencedColumns)));
        }
        return result(new String[] { "schema_name", "table_name", "name", "column_names", "referenced_schema",
                "referenced_table", "referenced_columns" }, rows);
    }

    private static String catalogFor(String product, String schema) {
        if (product.contains("mysql") || product.contains("mariadb") || product.contains("sqlite")) {
            return schema;
        }
        return null;
    }

    private static String schemaPatternFor(String product, String schema) {
        if (product.contains("mysql") || product.contains("mariadb") || product.contains("sqlite")) {
            return null;
        }
        return schema;
    }

    private static String result(String[] columns, List<List<Object>> rows) {
        StringBuilder output = new StringBuilder();
        output.append("{\"columns\":[");
        for (int index = 0; index < columns.length; index += 1) {
            if (index > 0) {
                output.append(',');
            }
            output.append("{\"name\":\"").append(json(columns[index]))
                    .append("\",\"dataType\":\"text\",\"nullable\":true}");
        }
        output.append("],\"rows\":[");
        for (int rowIndex = 0; rowIndex < rows.size(); rowIndex += 1) {
            if (rowIndex > 0) {
                output.append(',');
            }
            output.append('[');
            List<Object> row = rows.get(rowIndex);
            for (int columnIndex = 0; columnIndex < row.size(); columnIndex += 1) {
                if (columnIndex > 0) {
                    output.append(',');
                }
                appendJsonValue(output, row.get(columnIndex));
            }
            output.append(']');
        }
        output.append("],\"rowCount\":").append(rows.size())
                .append(",\"affectedRows\":0,\"elapsedMs\":0}");
        return output.toString();
    }

    private static List<Object> row(Object... values) {
        return Arrays.asList(values);
    }

    private static String nullableColumn(ResultSet resultSet, String column) {
        try {
            return resultSet.getString(column);
        } catch (Exception ignored) {
            return null;
        }
    }

    private static Integer nullableInt(ResultSet resultSet, String column) {
        try {
            int value = resultSet.getInt(column);
            return resultSet.wasNull() ? null : value;
        } catch (Exception ignored) {
            return null;
        }
    }

    private static boolean safeBool(ResultSet resultSet, String column) {
        try {
            return resultSet.getBoolean(column);
        } catch (Exception ignored) {
            return false;
        }
    }

    private static String firstNonEmpty(String... values) {
        for (String value : values) {
            if (value != null && !value.isEmpty()) {
                return value;
            }
        }
        return "";
    }

    private static String safe(String value) {
        return value == null ? "" : value;
    }

    private static final class IndexRow {
        final String schema;
        final String table;
        final String name;
        final boolean unique;
        final List<String> columns = new ArrayList<>();

        IndexRow(String schema, String table, String name, boolean unique) {
            this.schema = schema;
            this.table = table;
            this.name = name;
            this.unique = unique;
        }
    }

    private static final class ForeignKeyRow {
        final String schema;
        final String table;
        final String name;
        final String referencedSchema;
        final String referencedTable;
        final List<String> columns = new ArrayList<>();
        final List<String> referencedColumns = new ArrayList<>();

        ForeignKeyRow(String schema, String table, String name, String referencedSchema, String referencedTable) {
            this.schema = schema;
            this.table = table;
            this.name = name;
            this.referencedSchema = referencedSchema;
            this.referencedTable = referencedTable;
        }
    }

    private static void respondOk(String requestId, String payload) {
        respond("OK", requestId, payload);
    }

    private static void respondErr(String requestId, String message) {
        respond("ERR", requestId, message);
    }

    private static synchronized void respond(String status, String requestId, String payload) {
        System.out.println(status + "\t" + requestId + "\t"
                + Base64.getEncoder().encodeToString(payload.getBytes(StandardCharsets.UTF_8)));
        System.out.flush();
    }

    private static String decode(String encoded) {
        return new String(Base64.getDecoder().decode(encoded), StandardCharsets.UTF_8);
    }

    private static int parsePositiveInt(String value, int fallback) {
        try {
            int parsed = Integer.parseInt(value);
            return parsed > 0 ? parsed : fallback;
        } catch (NumberFormatException ignored) {
            return fallback;
        }
    }

    private static void appendJsonValue(StringBuilder output, Object value) {
        if (value == null) {
            output.append("null");
        } else if (value instanceof Number || value instanceof Boolean) {
            output.append(value);
        } else {
            output.append('"').append(json(String.valueOf(value))).append('"');
        }
    }

    private static Object resultValue(ResultSet resultSet, int index) throws Exception {
        Object value = resultSet.getObject(index);
        if (value instanceof Number || value instanceof Boolean || value == null) {
            return value;
        }
        if (value instanceof Clob clob) {
            return readClob(clob);
        }
        if (value instanceof Blob blob) {
            return blobPlaceholder(blob);
        }
        return resultSet.getString(index);
    }

    private static String blobPlaceholder(Blob blob) throws Exception {
        long bytes = blob.length();
        return "BLOB · " + humanReadableBytes(bytes);
    }

    private static String humanReadableBytes(long bytes) {
        if (bytes < 1024) {
            return bytes + " B";
        }
        if (bytes < 1024L * 1024L) {
            return String.format("%.1f KB", bytes / 1024.0);
        }
        return String.format("%.1f MB", bytes / (1024.0 * 1024.0));
    }

    private static String readClob(Clob clob) throws Exception {
        try (Reader reader = clob.getCharacterStream()) {
            StringBuilder value = new StringBuilder();
            char[] buffer = new char[8192];
            int read;
            while ((read = reader.read(buffer)) != -1) {
                value.append(buffer, 0, read);
            }
            return value.toString();
        }
    }

    private static String json(String value) {
        StringBuilder escaped = new StringBuilder(value.length());
        for (int index = 0; index < value.length(); index += 1) {
            char character = value.charAt(index);
            switch (character) {
                case '"' -> escaped.append("\\\"");
                case '\\' -> escaped.append("\\\\");
                case '\b' -> escaped.append("\\b");
                case '\f' -> escaped.append("\\f");
                case '\n' -> escaped.append("\\n");
                case '\r' -> escaped.append("\\r");
                case '\t' -> escaped.append("\\t");
                default -> {
                    if (character < 0x20) {
                        escaped.append(String.format("\\u%04x", (int) character));
                    } else {
                        escaped.append(character);
                    }
                }
            }
        }
        return escaped.toString();
    }
}
