package com.vaporlensdb.jdbcbridge;

import java.io.BufferedReader;
import java.io.InputStreamReader;
import java.io.Reader;
import java.nio.charset.StandardCharsets;
import java.sql.Clob;
import java.sql.Connection;
import java.sql.DatabaseMetaData;
import java.sql.DriverManager;
import java.sql.ResultSet;
import java.sql.ResultSetMetaData;
import java.sql.Statement;
import java.util.Base64;
import java.util.Properties;

public final class JdbcBridge {
    private static final int DEFAULT_CONNECT_TIMEOUT_SECONDS = 15;
    private static final int DEFAULT_QUERY_TIMEOUT_SECONDS = 60;

    private JdbcBridge() {
    }

    public static void main(String[] args) throws Exception {
        if (args.length < 4) {
            throw new IllegalArgumentException(
                    "usage: JdbcBridge <ping|query|server> <driverClass> <url> <username> <password> [sql|connectTimeoutSeconds queryTimeoutSeconds]");
        }

        String command = args[0];
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
                case "server" -> server(connection, queryTimeoutSeconds);
                default -> throw new IllegalArgumentException("unsupported command: " + command);
            }
        }
    }

    private static void server(Connection connection, int queryTimeoutSeconds) throws Exception {
        BufferedReader reader = new BufferedReader(new InputStreamReader(System.in, StandardCharsets.UTF_8));
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

    private static void respondOk(String requestId, String payload) {
        respond("OK", requestId, payload);
    }

    private static void respondErr(String requestId, String message) {
        respond("ERR", requestId, message);
    }

    private static void respond(String status, String requestId, String payload) {
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
        return resultSet.getString(index);
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
