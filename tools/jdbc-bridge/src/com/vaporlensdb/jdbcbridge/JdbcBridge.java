package com.vaporlensdb.jdbcbridge;

import java.sql.Connection;
import java.sql.DatabaseMetaData;
import java.sql.DriverManager;
import java.sql.ResultSet;
import java.sql.ResultSetMetaData;
import java.sql.Statement;
import java.util.Properties;

public final class JdbcBridge {
    private JdbcBridge() {
    }

    public static void main(String[] args) throws Exception {
        if (args.length < 4) {
            throw new IllegalArgumentException("usage: JdbcBridge <ping|query> <driverClass> <url> <username> <password> [sql]");
        }

        String command = args[0];
        String driverClass = args[1];
        String url = args[2];
        String username = args[3];
        String password = args.length >= 5 ? args[4] : "";

        Class.forName(driverClass);

        Properties properties = new Properties();
        if (!username.isEmpty()) {
            properties.setProperty("user", username);
        }
        if (!password.isEmpty()) {
            properties.setProperty("password", password);
        }

        try (Connection connection = DriverManager.getConnection(url, properties)) {
            switch (command) {
                case "ping" -> ping(connection);
                case "query" -> {
                    if (args.length < 6) {
                        throw new IllegalArgumentException("query command requires SQL");
                    }
                    query(connection, args[5]);
                }
                default -> throw new IllegalArgumentException("unsupported command: " + command);
            }
        }
    }

    private static void ping(Connection connection) throws Exception {
        DatabaseMetaData metaData = connection.getMetaData();
        System.out.println("{\"ok\":true,\"databaseProductName\":\""
                + json(metaData.getDatabaseProductName()) + "\",\"databaseProductVersion\":\""
                + json(metaData.getDatabaseProductVersion()) + "\"}");
    }

    private static void query(Connection connection, String sql) throws Exception {
        long start = System.currentTimeMillis();
        try (Statement statement = connection.createStatement()) {
            boolean hasResultSet = statement.execute(sql);
            long elapsedMs = System.currentTimeMillis() - start;

            if (!hasResultSet) {
                int updateCount = statement.getUpdateCount();
                System.out.println("{\"columns\":[],\"rows\":[],\"rowCount\":0,\"affectedRows\":"
                        + Math.max(updateCount, 0) + ",\"elapsedMs\":" + elapsedMs + "}");
                return;
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
                        Object value = resultSet.getObject(index);
                        appendJsonValue(output, value);
                    }
                    output.append(']');
                    rowCount += 1;
                }

                output.append("],\"rowCount\":")
                        .append(rowCount)
                        .append(",\"affectedRows\":0,\"elapsedMs\":")
                        .append(elapsedMs)
                        .append('}');
                System.out.println(output);
            }
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
