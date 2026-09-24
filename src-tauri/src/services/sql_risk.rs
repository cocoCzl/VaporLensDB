use crate::utils::sql_parser::{mask_sql, split_sql_statements};
use serde::Serialize;

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SqlRiskAnalysis {
    pub dangerous: bool,
    pub status: SqlRiskStatus,
    pub reasons: Vec<SqlRiskReason>,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum SqlRiskStatus {
    Safe,
    Dangerous,
    Unknown,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum SqlRiskReason {
    DropStatement,
    TruncateStatement,
    DeleteWithoutWhere,
    UpdateWithoutWhere,
    MergeStatement,
    ProceduralStatement,
    UnclassifiedStatement,
}

pub fn analyze_sql_risk(sql: &str) -> SqlRiskAnalysis {
    let reasons = split_sql_statements(&mask_sql(sql))
        .into_iter()
        .flat_map(|statement| analyze_statement(&statement))
        .collect::<Vec<_>>();

    let status = if reasons.iter().any(|reason| !reason.is_uncertain()) {
        SqlRiskStatus::Dangerous
    } else if reasons.is_empty() {
        SqlRiskStatus::Safe
    } else {
        SqlRiskStatus::Unknown
    };

    SqlRiskAnalysis {
        dangerous: status != SqlRiskStatus::Safe,
        status,
        reasons,
    }
}

impl SqlRiskReason {
    fn is_uncertain(&self) -> bool {
        matches!(
            self,
            Self::ProceduralStatement | Self::UnclassifiedStatement
        )
    }
}

fn analyze_statement(statement: &str) -> Vec<SqlRiskReason> {
    let tokens = scope_tokens(statement);

    if tokens.is_empty() {
        return Vec::new();
    }

    let mut reasons = Vec::new();
    let starts_with_cte = tokens.first().is_some_and(|token| token.word == "with");

    if command_present(&tokens, starts_with_cte, "drop") {
        reasons.push(SqlRiskReason::DropStatement);
    }
    if command_present(&tokens, starts_with_cte, "truncate") {
        reasons.push(SqlRiskReason::TruncateStatement);
    }
    if command_present(&tokens, starts_with_cte, "merge") {
        reasons.push(SqlRiskReason::MergeStatement);
    }
    let procedural = procedural_statement(&tokens);
    if procedural {
        reasons.push(SqlRiskReason::ProceduralStatement);
    }
    if dml_without_where(&tokens, starts_with_cte, "delete") {
        reasons.push(SqlRiskReason::DeleteWithoutWhere);
    }
    if dml_without_where(&tokens, starts_with_cte, "update") {
        reasons.push(SqlRiskReason::UpdateWithoutWhere);
    }
    if !procedural && !known_statement(&tokens, starts_with_cte) {
        reasons.push(SqlRiskReason::UnclassifiedStatement);
    }

    reasons
}

fn procedural_statement(tokens: &[ScopeToken]) -> bool {
    let first = tokens.first().map(|token| token.word.as_str());
    matches!(first, Some("call" | "do" | "exec" | "execute" | "prepare"))
        || (matches!(first, Some("create" | "alter" | "drop"))
            && tokens.iter().any(|token| {
                matches!(
                    token.word.as_str(),
                    "function" | "package" | "procedure" | "trigger"
                )
            }))
}

fn known_statement(tokens: &[ScopeToken], starts_with_cte: bool) -> bool {
    const KNOWN: &[&str] = &[
        "alter",
        "analyze",
        "attach",
        "begin",
        "commit",
        "create",
        "delete",
        "desc",
        "describe",
        "detach",
        "drop",
        "explain",
        "grant",
        "insert",
        "merge",
        "pragma",
        "release",
        "revoke",
        "rollback",
        "savepoint",
        "select",
        "set",
        "show",
        "start",
        "truncate",
        "update",
        "use",
        "vacuum",
        "with",
    ];
    tokens
        .first()
        .is_some_and(|token| KNOWN.contains(&token.word.as_str()))
        && (!starts_with_cte
            || tokens.iter().any(|token| {
                matches!(
                    token.word.as_str(),
                    "delete" | "insert" | "merge" | "select" | "update"
                )
            }))
}

struct ScopeToken {
    word: String,
    scope: usize,
}

// Give every parenthesized region a unique identity, not just a depth: sibling
// CTEs and subqueries must never share a WHERE clause.
fn scope_tokens(statement: &str) -> Vec<ScopeToken> {
    let mut scopes = vec![0];
    let mut next_scope = 0;
    let mut tokens = Vec::new();
    let mut word = String::new();
    for ch in statement.chars().chain(std::iter::once(' ')) {
        if ch.is_ascii_alphanumeric() || ch == '_' {
            word.push(ch.to_ascii_lowercase());
            continue;
        }
        if !word.is_empty() {
            tokens.push(ScopeToken {
                word: std::mem::take(&mut word),
                scope: *scopes.last().unwrap(),
            });
        }
        match ch {
            '(' => {
                next_scope += 1;
                scopes.push(next_scope);
            }
            ')' if scopes.len() > 1 => {
                scopes.pop();
            }
            _ => {}
        }
    }
    tokens
}

fn command_present(tokens: &[ScopeToken], starts_with_cte: bool, keyword: &str) -> bool {
    tokens.first().is_some_and(|token| token.word == keyword)
        || (starts_with_cte && tokens.iter().any(|token| token.word == keyword))
}

fn dml_without_where(tokens: &[ScopeToken], starts_with_cte: bool, keyword: &str) -> bool {
    tokens.iter().enumerate().any(|(index, token)| {
        if token.word != keyword || (index != 0 && !starts_with_cte) {
            return false;
        }
        // RETURNING/OUTPUT and later commands cannot supply this DML's filter.
        !tokens[index + 1..]
            .iter()
            .filter(|next| next.scope == token.scope)
            .take_while(|next| {
                !matches!(
                    next.word.as_str(),
                    "returning" | "select" | "insert" | "update" | "delete" | "merge"
                )
            })
            .any(|next| next.word == "where")
    })
}

#[cfg(test)]
mod tests {
    use super::{analyze_sql_risk, SqlRiskReason, SqlRiskStatus};

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
    fn shared_lexer_hides_dollar_literals_and_nested_comments() {
        for sql in [
            "UPDATE t SET note=$body$where id=1; SELECT 2$body$",
            "UPDATE t SET x=1 /* outer /* inner */ WHERE id=1 */",
            "UPDATE t SET note=E'it\\'s WHERE id=1'",
        ] {
            assert_eq!(
                analyze_sql_risk(sql).reasons,
                vec![SqlRiskReason::UpdateWithoutWhere],
                "{sql}"
            );
        }
        assert!(!analyze_sql_risk("SELECT $$DELETE FROM t; DROP TABLE t$$").dangerous);
    }

    #[test]
    fn detects_cte_dml_without_where() {
        let analysis = analyze_sql_risk("WITH changed AS (UPDATE users SET disabled = true RETURNING id) SELECT * FROM changed;");

        assert!(analysis.dangerous);
        assert_eq!(analysis.reasons, vec![SqlRiskReason::UpdateWithoutWhere]);
    }

    #[test]
    fn nested_where_does_not_filter_outer_update_or_delete() {
        for sql in [
            "UPDATE accounts SET balance = (SELECT amount FROM defaults WHERE id = 1)",
            "WITH defaults AS (SELECT amount FROM source WHERE id = 1) UPDATE accounts SET balance = 0",
            "DELETE FROM accounts USING (SELECT id FROM defaults WHERE id = 1) AS source",
        ] {
            assert!(analyze_sql_risk(sql).dangerous, "{sql}");
        }
        assert!(!analyze_sql_risk("UPDATE accounts SET balance = (SELECT amount FROM defaults WHERE id = 1) WHERE id = 2").dangerous);
        assert!(!analyze_sql_risk("DELETE FROM accounts WHERE EXISTS (SELECT 1 FROM source WHERE source.id = accounts.id)").dangerous);
    }

    #[test]
    fn each_cte_dml_has_its_own_filter_scope() {
        let analysis = analyze_sql_risk("WITH a AS (UPDATE t SET x=1 WHERE id=1 RETURNING id), b AS (UPDATE t SET x=2 RETURNING id) SELECT * FROM b WHERE id=2");
        assert_eq!(analysis.reasons, vec![SqlRiskReason::UpdateWithoutWhere]);
        let analysis = analyze_sql_risk("WITH a AS (DELETE FROM t RETURNING id), b AS (DELETE FROM t WHERE id=2 RETURNING id) SELECT * FROM b");
        assert_eq!(analysis.reasons, vec![SqlRiskReason::DeleteWithoutWhere]);
        assert!(!analyze_sql_risk("WITH a AS (UPDATE t SET x=1 WHERE id=1 RETURNING id) DELETE FROM t WHERE id IN (SELECT id FROM a)").dangerous);
    }

    #[test]
    fn quoted_identifiers_and_literals_cannot_supply_a_filter() {
        for sql in [
            "UPDATE t SET `where` = 1",
            "UPDATE t SET [where] = 1",
            "UPDATE t SET \"where\" = 1",
            "UPDATE t SET note = 'where id = 1' /* WHERE id=2 */",
            "UPDATE t SET [a]]where] = 1",
        ] {
            assert_eq!(
                analyze_sql_risk(sql).reasons,
                vec![SqlRiskReason::UpdateWithoutWhere],
                "{sql}"
            );
        }
    }

    #[test]
    fn merge_is_dangerous_and_procedural_or_unknown_statements_are_uncertain() {
        let merge = analyze_sql_risk(
            "MERGE INTO target USING source ON target.id=source.id WHEN MATCHED THEN DELETE",
        );
        assert_eq!(merge.status, SqlRiskStatus::Dangerous);
        assert_eq!(merge.reasons, vec![SqlRiskReason::MergeStatement]);

        for sql in [
            "CALL rebuild_accounts()",
            "EXECUTE IMMEDIATE 'DELETE FROM accounts'",
            "CREATE PROCEDURE p AS BEGIN DELETE FROM accounts; END",
            "vendor_specific_command accounts",
        ] {
            let analysis = analyze_sql_risk(sql);
            assert!(analysis.dangerous, "{sql}");
            assert_eq!(analysis.status, SqlRiskStatus::Unknown, "{sql}");
            assert!(analysis.reasons.iter().all(SqlRiskReason::is_uncertain));
        }
    }

    #[test]
    fn sql_server_output_does_not_hide_a_later_outer_where() {
        for sql in [
            "UPDATE accounts SET active=0 OUTPUT inserted.id WHERE tenant_id=7",
            "DELETE FROM accounts OUTPUT deleted.id WHERE tenant_id=7",
        ] {
            assert_eq!(analyze_sql_risk(sql).status, SqlRiskStatus::Safe, "{sql}");
        }
        assert_eq!(
            analyze_sql_risk(
                "UPDATE accounts SET active=0 OUTPUT (SELECT id FROM audit WHERE id=1)"
            )
            .reasons,
            vec![SqlRiskReason::UpdateWithoutWhere]
        );
    }
}
