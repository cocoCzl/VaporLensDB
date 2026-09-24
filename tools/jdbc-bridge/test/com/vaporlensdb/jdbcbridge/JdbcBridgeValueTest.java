package com.vaporlensdb.jdbcbridge;

import java.math.BigDecimal;
import java.math.BigInteger;
import java.util.List;

/** Dependency-free contract test; runs even without any installed JDBC driver. */
public final class JdbcBridgeValueTest {
    public static void main(String[] args) {
        check(null, "null");
        check(true, "true");
        check((byte) 7, "7");
        check((short) -8, "-8");
        check(42, "42");
        check(9_007_199_254_740_991L, "9007199254740991");
        check(-9_007_199_254_740_991L, "-9007199254740991");
        check(9_007_199_254_740_992L, "\"9007199254740992\"");
        check(9_007_199_254_740_993L, "\"9007199254740993\"");
        check(-9_007_199_254_740_992L, "\"-9007199254740992\"");
        check(-9_007_199_254_740_993L, "\"-9007199254740993\"");
        check(Long.MAX_VALUE, "\"9223372036854775807\"");
        check(Long.MIN_VALUE, "\"-9223372036854775808\"");
        for (String value : new String[] { "9007199254740991", "-9007199254740991", "0" }) {
            check(new BigInteger(value), value);
        }
        for (String value : new String[] { "9007199254740992", "-9007199254740992", "18446744073709551615" }) {
            check(new BigInteger(value), "\"" + value + "\"");
        }
        for (String value : new String[] { "12345678901234567890.123456789012345678", "1.2300", "0.0000", "1E+10000" }) {
            check(new BigDecimal(value), "\"" + value + "\"");
        }
        check(1.5d, "1.5");
        check(1.5f, "1.5");
        check(Double.NaN, "\"NaN\"");
        check(Double.POSITIVE_INFINITY, "\"Infinity\"");
        check(Float.NEGATIVE_INFINITY, "\"-Infinity\"");
        check("quote\"\n", "\"quote\\\"\\n\"");
        checkUtf8AndCellBudget();
        checkStreamChunkBudget();
        checkNonStreamingResultBudget();
        System.out.println("JDBC scalar JSON contract tests passed.");
    }

    private static void check(Object value, String expected) {
        StringBuilder output = new StringBuilder();
        JdbcBridge.appendJsonValue(output, value);
        if (!expected.contentEquals(output)) {
            throw new AssertionError("Expected " + expected + ", got " + output);
        }
    }

    private static void checkUtf8AndCellBudget() {
        if (JdbcBridge.utf8Length("A中😀") != 8) {
            throw new AssertionError("UTF-8 byte estimator must count ASCII, BMP, and surrogate pairs");
        }

        String exact = "x".repeat(JdbcBridge.MAX_INTERACTIVE_CELL_BYTES - 2);
        StringBuilder output = new StringBuilder();
        JdbcBridge.appendBoundedJsonValue(output, exact, JdbcBridge.MAX_INTERACTIVE_CELL_BYTES);
        if (JdbcBridge.utf8Length(output) != JdbcBridge.MAX_INTERACTIVE_CELL_BYTES) {
            throw new AssertionError("exact-limit JDBC cell must be accepted");
        }

        output.setLength(0);
        try {
            JdbcBridge.appendBoundedJsonValue(
                    output,
                    "x".repeat(JdbcBridge.MAX_INTERACTIVE_CELL_BYTES - 1),
                    JdbcBridge.MAX_INTERACTIVE_CELL_BYTES);
            throw new AssertionError("oversized JDBC cell must be rejected");
        } catch (IllegalArgumentException expected) {
            if (output.length() != 0) {
                throw new AssertionError("rejected JDBC cell must not remain in the row buffer");
            }
        }
    }

    private static void checkStreamChunkBudget() {
        JdbcBridge.StreamChunkBuffer rowLimited = new JdbcBridge.StreamChunkBuffer(2, 1024);
        if (rowLimited.add("[1]") != null || rowLimited.add("[2]") != null) {
            throw new AssertionError("row-limited chunk flushed too early");
        }
        List<String> flushed = rowLimited.add("[3]");
        if (flushed == null || flushed.size() != 2 || rowLimited.drain().size() != 1) {
            throw new AssertionError("row-limited chunk did not retain the triggering row");
        }

        JdbcBridge.StreamChunkBuffer byteLimited = new JdbcBridge.StreamChunkBuffer(10, 12);
        if (byteLimited.add("[123]") != null) {
            throw new AssertionError("byte-limited chunk flushed too early");
        }
        flushed = byteLimited.add("[456]");
        if (flushed == null || flushed.size() != 1 || byteLimited.drain().size() != 1) {
            throw new AssertionError("byte-limited chunk did not retain the triggering row");
        }
    }

    private static void checkNonStreamingResultBudget() {
        StringBuilder output = new StringBuilder();
        JdbcBridge.BoundedResultRows rows = new JdbcBridge.BoundedResultRows(output, 13);
        rows.add("[123]");
        rows.add("[456]");
        if (!"[123],[456]".contentEquals(output) || rows.bytes() != 13) {
            throw new AssertionError("exact-limit non-streaming JDBC result must be accepted");
        }
        try {
            rows.add("[7]");
            throw new AssertionError("oversized non-streaming JDBC result must be rejected");
        } catch (IllegalArgumentException expected) {
            if (!"[123],[456]".contentEquals(output)) {
                throw new AssertionError("rejected JDBC row must not remain in the result buffer");
            }
        }
    }
}
