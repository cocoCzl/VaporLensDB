/// Mask comments and quoted regions while preserving UTF-8 byte offsets.
pub fn mask_sql(sql: &str) -> String {
    let bytes = sql.as_bytes();
    let mut output = bytes.to_vec();
    let mut i = 0;
    while i < bytes.len() {
        let start = i;
        if bytes[i..].starts_with(b"--") {
            while i < bytes.len() && !matches!(bytes[i], b'\n' | b'\r') {
                i += 1;
            }
        } else if bytes[i..].starts_with(b"/*") {
            i += 2;
            let mut depth = 1;
            while i < bytes.len() && depth > 0 {
                if bytes[i..].starts_with(b"/*") {
                    depth += 1;
                    i += 2;
                } else if bytes[i..].starts_with(b"*/") {
                    depth -= 1;
                    i += 2;
                } else {
                    i += 1;
                }
            }
        } else if matches!(bytes[i], b'\'' | b'"' | b'`' | b'[') {
            let quote = bytes[i];
            let end = if quote == b'[' { b']' } else { quote };
            let escaped = quote == b'\''
                && i > 0
                && matches!(bytes[i - 1], b'e' | b'E')
                && (i < 2 || !identifier_byte(bytes[i - 2]));
            i += 1;
            while i < bytes.len() {
                if escaped && bytes[i] == b'\\' {
                    i = (i + 2).min(bytes.len());
                } else if bytes[i] == end {
                    i += 1;
                    if i < bytes.len() && bytes[i] == end {
                        i += 1;
                    } else {
                        break;
                    }
                } else {
                    i += 1;
                }
            }
        } else if let Some(length) = dollar_delimiter(bytes, i) {
            let delimiter = &bytes[i..i + length];
            i += length;
            while i < bytes.len() && !bytes[i..].starts_with(delimiter) {
                i += 1;
            }
            i = (i + length).min(bytes.len());
        } else {
            i += 1;
            continue;
        }
        for byte in &mut output[start..i] {
            if !matches!(*byte, b'\n' | b'\r') {
                *byte = b' ';
            }
        }
    }
    String::from_utf8(output).expect("mask preserves UTF-8")
}

fn identifier_byte(byte: u8) -> bool {
    byte.is_ascii_alphanumeric() || matches!(byte, b'_' | b'$') || byte >= 128
}

fn dollar_delimiter(bytes: &[u8], i: usize) -> Option<usize> {
    if bytes[i] != b'$' || (i > 0 && identifier_byte(bytes[i - 1])) {
        return None;
    }
    let mut end = i + 1;
    if bytes.get(end) == Some(&b'$') {
        return Some(2);
    }
    let first = *bytes.get(end)?;
    if !(first.is_ascii_alphabetic() || first == b'_' || first >= 128) {
        return None;
    }
    end += 1;
    while let Some(&byte) = bytes.get(end) {
        if byte == b'$' {
            return Some(end - i + 1);
        }
        if !(byte.is_ascii_alphanumeric() || byte == b'_' || byte >= 128) {
            return None;
        }
        end += 1;
    }
    None
}

pub fn split_sql_statements(sql: &str) -> Vec<String> {
    let mask = mask_sql(sql);
    let mut statements = Vec::new();
    let mut start = 0;
    for end in mask
        .match_indices(';')
        .map(|(i, _)| i)
        .chain(std::iter::once(sql.len()))
    {
        let statement = sql[start..end].trim();
        if !statement.is_empty() {
            statements.push(statement.to_string());
        }
        start = end + 1;
    }
    statements
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn shared_frontend_lexical_cases() {
        let cases: serde_json::Value =
            serde_json::from_str(include_str!("../../../src/shared/sql-lexer-cases.json")).unwrap();
        for case in cases.as_array().unwrap() {
            let sql = case["sql"].as_str().unwrap();
            let expected: Vec<&str> = case["statements"]
                .as_array()
                .unwrap()
                .iter()
                .map(|value| value.as_str().unwrap())
                .collect();
            assert_eq!(split_sql_statements(sql), expected, "{sql}");
        }
    }
    #[test]
    fn splits_multiple_statements() {
        assert_eq!(
            split_sql_statements("select 1; select 2;"),
            vec!["select 1", "select 2"]
        );
    }
    #[test]
    fn keeps_semicolon_inside_strings_and_comments() {
        assert_eq!(
            split_sql_statements("select ';' as value; -- ;\nselect 2"),
            vec!["select ';' as value", "-- ;\nselect 2"]
        );
    }
    #[test]
    fn preserves_dollar_bodies_and_nested_comments() {
        for sql in [
            "DO $$ BEGIN PERFORM 1; PERFORM 2; END $$",
            "DO $body$ BEGIN RAISE NOTICE '$other$;'; END $body$",
            "SELECT $中文$中文; WHERE$中文$",
            "SELECT 1 /* outer /* inner */ ; still outer */",
            "SELECT [a]];b], \"a\"\";b\" FROM t",
            "SELECT E'it\\'s; a string'",
        ] {
            assert_eq!(
                split_sql_statements(&format!("{sql}; SELECT 2")),
                vec![sql, "SELECT 2"]
            );
        }
    }
    #[test]
    fn dollar_parameters_and_identifier_suffixes_are_not_quotes() {
        assert_eq!(
            split_sql_statements("SELECT $1, foo$tag$; SELECT 2"),
            vec!["SELECT $1, foo$tag$", "SELECT 2"]
        );
    }
    #[test]
    fn mask_preserves_unicode_offsets() {
        let sql = "SELECT '中文; WHERE', $tag$DELETE; WHERE$tag$, [where] /* WHERE */ FROM 表";
        let mask = mask_sql(sql);
        assert_eq!(mask.len(), sql.len());
        assert!(!mask.contains("WHERE"));
        assert!(!mask.contains(';'));
        assert!(mask.ends_with("FROM 表"));
    }
    #[test]
    fn unterminated_regions_are_not_split() {
        for sql in [
            "SELECT 'abc; DELETE FROM t",
            "DO $x$ BEGIN; DELETE FROM t",
            "SELECT 1 /* ; DELETE FROM t",
        ] {
            assert_eq!(split_sql_statements(sql), vec![sql]);
        }
    }
}
