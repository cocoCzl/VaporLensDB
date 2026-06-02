use serde::Serialize;

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SqlRiskAnalysis {
    pub dangerous: bool,
    pub reasons: Vec<SqlRiskReason>,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum SqlRiskReason {
    DropStatement,
    TruncateStatement,
    DeleteWithoutWhere,
    UpdateWithoutWhere,
}

pub fn analyze_sql_risk(sql: &str) -> SqlRiskAnalysis {
    let reasons = split_sql_statements(&sanitize_sql(sql))
        .into_iter()
        .flat_map(|statement| analyze_statement(&statement))
        .collect::<Vec<_>>();

    SqlRiskAnalysis {
        dangerous: !reasons.is_empty(),
        reasons,
    }
}

fn analyze_statement(statement: &str) -> Vec<SqlRiskReason> {
    let tokens = statement
        .split(|char: char| !char.is_ascii_alphanumeric() && char != '_')
        .filter(|token| !token.is_empty())
        .map(str::to_ascii_lowercase)
        .collect::<Vec<_>>();

    if tokens.is_empty() {
        return Vec::new();
    }

    let mut reasons = Vec::new();
    let starts_with_cte = tokens.first().is_some_and(|token| token == "with");

    if command_present(&tokens, starts_with_cte, "drop") {
        reasons.push(SqlRiskReason::DropStatement);
    }
    if command_present(&tokens, starts_with_cte, "truncate") {
        reasons.push(SqlRiskReason::TruncateStatement);
    }
    if dml_without_where(&tokens, starts_with_cte, "delete") {
        reasons.push(SqlRiskReason::DeleteWithoutWhere);
    }
    if dml_without_where(&tokens, starts_with_cte, "update") {
        reasons.push(SqlRiskReason::UpdateWithoutWhere);
    }

    reasons
}

fn command_present(tokens: &[String], starts_with_cte: bool, keyword: &str) -> bool {
    tokens.first().is_some_and(|token| token == keyword)
        || (starts_with_cte && tokens.iter().any(|token| token == keyword))
}

fn dml_without_where(tokens: &[String], starts_with_cte: bool, keyword: &str) -> bool {
    let Some(index) = tokens.iter().position(|token| token == keyword) else {
        return false;
    };

    if index != 0 && !starts_with_cte {
        return false;
    }

    !tokens[index + 1..].iter().any(|token| token == "where")
}

fn split_sql_statements(sql: &str) -> Vec<String> {
    sql.split(';')
        .map(str::trim)
        .filter(|statement| !statement.is_empty())
        .map(ToOwned::to_owned)
        .collect()
}

fn sanitize_sql(sql: &str) -> String {
    let mut output = String::with_capacity(sql.len());
    let mut chars = sql.chars().peekable();
    let mut in_single_quote = false;
    let mut in_double_quote = false;
    let mut in_line_comment = false;
    let mut in_block_comment = false;

    while let Some(char) = chars.next() {
        let next = chars.peek().copied();

        if in_line_comment {
            if char == '\n' {
                in_line_comment = false;
                output.push('\n');
            } else {
                output.push(' ');
            }
            continue;
        }

        if in_block_comment {
            if char == '*' && next == Some('/') {
                output.push(' ');
                output.push(' ');
                chars.next();
                in_block_comment = false;
            } else {
                output.push(' ');
            }
            continue;
        }

        if in_single_quote {
            output.push(' ');
            if char == '\'' {
                if next == Some('\'') {
                    output.push(' ');
                    chars.next();
                } else {
                    in_single_quote = false;
                }
            }
            continue;
        }

        if in_double_quote {
            output.push(' ');
            if char == '"' {
                if next == Some('"') {
                    output.push(' ');
                    chars.next();
                } else {
                    in_double_quote = false;
                }
            }
            continue;
        }

        if char == '-' && next == Some('-') {
            output.push(' ');
            output.push(' ');
            chars.next();
            in_line_comment = true;
            continue;
        }

        if char == '/' && next == Some('*') {
            output.push(' ');
            output.push(' ');
            chars.next();
            in_block_comment = true;
            continue;
        }

        if char == '\'' {
            output.push(' ');
            in_single_quote = true;
            continue;
        }

        if char == '"' {
            output.push(' ');
            in_double_quote = true;
            continue;
        }

        output.push(char);
    }

    output
}

#[cfg(test)]
mod tests {
    use super::{analyze_sql_risk, SqlRiskReason};

    #[test]
    fn detects_drop_and_truncate() {
        let analysis = analyze_sql_risk("DROP TABLE users; TRUNCATE TABLE audit_log;");

        assert!(analysis.dangerous);
        assert_eq!(
            analysis.reasons,
            vec![
                SqlRiskReason::DropStatement,
                SqlRiskReason::TruncateStatement
            ]
        );
    }

    #[test]
    fn detects_unscoped_delete_and_update() {
        let analysis = analyze_sql_risk("DELETE FROM users; UPDATE accounts SET disabled = true;");

        assert!(analysis.dangerous);
        assert_eq!(
            analysis.reasons,
            vec![
                SqlRiskReason::DeleteWithoutWhere,
                SqlRiskReason::UpdateWithoutWhere
            ]
        );
    }

    #[test]
    fn allows_safe_select_and_scoped_dml() {
        let analysis = analyze_sql_risk(
            "SELECT * FROM users; DELETE FROM users WHERE id = 1; UPDATE users SET name = 'a' WHERE id = 1;",
        );

        assert!(!analysis.dangerous);
        assert!(analysis.reasons.is_empty());
    }

    #[test]
    fn ignores_comments_and_strings() {
        let analysis = analyze_sql_risk(
            "SELECT 'DROP TABLE users'; -- DELETE FROM users\n/* TRUNCATE TABLE logs */ SELECT 1;",
        );

        assert!(!analysis.dangerous);
    }

    #[test]
    fn detects_cte_dml_without_where() {
        let analysis = analyze_sql_risk("WITH changed AS (UPDATE users SET disabled = true RETURNING id) SELECT * FROM changed;");

        assert!(analysis.dangerous);
        assert_eq!(analysis.reasons, vec![SqlRiskReason::UpdateWithoutWhere]);
    }
}
