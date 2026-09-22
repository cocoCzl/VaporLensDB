package com.vaporlensdb.jdbcbridge;

import java.math.BigDecimal;
import java.math.BigInteger;

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
        System.out.println("JDBC scalar JSON contract tests passed.");
    }

    private static void check(Object value, String expected) {
        StringBuilder output = new StringBuilder();
        JdbcBridge.appendJsonValue(output, value);
        if (!expected.contentEquals(output)) {
            throw new AssertionError("Expected " + expected + ", got " + output);
        }
    }
}
