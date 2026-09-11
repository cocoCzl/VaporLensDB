//! Redaction for untrusted driver, process, and network error text.
//!
//! This is deliberately narrow: it removes credential-bearing URL userinfo
//! and contextual secret fields while retaining the driver, host, error code,
//! and transport information needed to diagnose a failure.

use std::sync::OnceLock;

use regex::Regex;

/// Produces text that is safe to show, persist, log, or include in diagnostics.
///
/// When a driver echoes the exact SQL it was executing, pass that statement so
/// it cannot bypass the diagnostics SQL-text policy through an error message.
pub fn sanitize_diagnostic_error(message: &str, executed_sql: Option<&str>) -> String {
    let mut sanitized = message.to_string();

    if let Some(sql) = executed_sql.filter(|sql| !sql.is_empty()) {
        sanitized = sanitized.replace(sql, "[REDACTED SQL]");
    }

    sanitized = uri_userinfo_pattern()
        .replace_all(&sanitized, "$1:[REDACTED]@")
        .into_owned();
    sanitized = secret_assignment_pattern()
        .replace_all(&sanitized, "${1}[REDACTED]")
        .into_owned();
    sanitized = authorization_pattern()
        .replace_all(&sanitized, "${1}[REDACTED]")
        .into_owned();
    bearer_pattern()
        .replace_all(&sanitized, "Bearer [REDACTED]")
        .into_owned()
}

fn uri_userinfo_pattern() -> &'static Regex {
    static PATTERN: OnceLock<Regex> = OnceLock::new();
    PATTERN.get_or_init(|| {
        Regex::new(r"(?i)\b([a-z][a-z0-9+.-]*://[^/\s:@?#]+):([^@/\s?#]*)@")
            .expect("valid credential-bearing URI pattern")
    })
}

fn secret_assignment_pattern() -> &'static Regex {
    static PATTERN: OnceLock<Regex> = OnceLock::new();
    PATTERN.get_or_init(|| {
        Regex::new(
            r#"(?i)([\"']?\b(?:password|pwd|pass|token|access_token|api_key|secret|sslpassword|passphrase)\b[\"']?\s*(?:=|:)\s*)(?:\"[^\"]*\"|'[^']*'|[^\s&;,\r\n]+)"#,
        )
        .expect("valid secret assignment pattern")
    })
}

fn authorization_pattern() -> &'static Regex {
    static PATTERN: OnceLock<Regex> = OnceLock::new();
    PATTERN.get_or_init(|| {
        Regex::new(r"(?i)(\bauthorization\s*:\s*)(?:bearer\s+)?[^\s,;]+")
            .expect("valid authorization header pattern")
    })
}

fn bearer_pattern() -> &'static Regex {
    static PATTERN: OnceLock<Regex> = OnceLock::new();
    PATTERN.get_or_init(|| {
        Regex::new(r"(?i)\bbearer\s+[A-Za-z0-9._~+/=-]+").expect("valid bearer token pattern")
    })
}

#[cfg(test)]
mod tests {
    use super::sanitize_diagnostic_error;

    const SECRET: &str = "super-secret-test-value";

    fn assert_redacted(message: &str) {
        let sanitized = sanitize_diagnostic_error(message, None);
        assert!(
            !sanitized.contains(SECRET),
            "secret leaked in {sanitized:?}"
        );
    }

    #[test]
    fn redacts_uri_userinfo_without_hiding_host() {
        let sanitized = sanitize_diagnostic_error(
            "connect mysql://test-user:super-secret-test-value@example.invalid:3306/demo failed",
            None,
        );

        assert!(!sanitized.contains(SECRET));
        assert!(sanitized.contains("mysql://test-user:[REDACTED]@example.invalid:3306/demo"));
    }

    #[test]
    fn redacts_jdbc_and_key_value_credentials() {
        assert_redacted(
            "jdbc:mysql://example.invalid/demo?user=alice&password=super-secret-test-value",
        );
        assert_redacted("password=super-secret-test-value; sslpassword: super-secret-test-value");
        assert_redacted("pwd='super-secret-test-value' passphrase: \"super-secret-test-value\"");
    }

    #[test]
    fn redacts_authorization_and_multiline_java_errors() {
        let sanitized = sanitize_diagnostic_error(
            "java.sql.SQLException: jdbc:postgresql://example.invalid/db?password=super-secret-test-value\nAuthorization: Bearer super-secret-test-value\nCaused by: timeout",
            None,
        );

        assert!(!sanitized.contains(SECRET));
        assert!(sanitized.contains("java.sql.SQLException"));
        assert!(sanitized.contains("example.invalid"));
        assert!(sanitized.contains("Caused by: timeout"));
    }

    #[test]
    fn is_idempotent_and_keeps_normal_errors_useful() {
        let once =
            sanitize_diagnostic_error("password=[REDACTED]; SQLSTATE 28000: access denied", None);
        let twice = sanitize_diagnostic_error(&once, None);

        assert_eq!(once, twice);
        assert!(twice.contains("SQLSTATE 28000"));
        assert!(twice.contains("access denied"));
    }

    #[test]
    fn avoids_unrelated_word_matches_and_handles_unicode_malformed_urls() {
        let message = "password_policy and tokenizer failed: 数据库连接失败 jdbc:not-a-url";
        assert_eq!(sanitize_diagnostic_error(message, None), message);
    }

    #[test]
    fn redacts_exact_executed_sql_when_the_driver_echoes_it() {
        let sql = "SELECT * FROM accounts WHERE token = 'super-secret-test-value'";
        let sanitized =
            sanitize_diagnostic_error(&format!("syntax error while executing {sql}"), Some(sql));

        assert!(!sanitized.contains(SECRET));
        assert!(sanitized.contains("syntax error while executing [REDACTED SQL]"));
    }
}
