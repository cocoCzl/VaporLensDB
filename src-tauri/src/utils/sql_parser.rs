pub fn split_sql_statements(sql: &str) -> Vec<String> {
    let mut statements = Vec::new();
    let mut current = String::new();
    let mut chars = sql.chars().peekable();
    let mut in_single_quote = false;
    let mut in_double_quote = false;
    let mut in_line_comment = false;
    let mut in_block_comment = false;

    while let Some(ch) = chars.next() {
        let next = chars.peek().copied();

        if in_line_comment {
            current.push(ch);
            if ch == '\n' {
                in_line_comment = false;
            }
            continue;
        }

        if in_block_comment {
            current.push(ch);
            if ch == '*' && next == Some('/') {
                current.push(chars.next().unwrap_or('/'));
                in_block_comment = false;
            }
            continue;
        }

        if !in_single_quote && !in_double_quote {
            if ch == '-' && next == Some('-') {
                current.push(ch);
                current.push(chars.next().unwrap_or('-'));
                in_line_comment = true;
                continue;
            }

            if ch == '/' && next == Some('*') {
                current.push(ch);
                current.push(chars.next().unwrap_or('*'));
                in_block_comment = true;
                continue;
            }
        }

        if ch == '\'' && !in_double_quote {
            current.push(ch);
            if in_single_quote && next == Some('\'') {
                current.push(chars.next().unwrap_or('\''));
                continue;
            }
            in_single_quote = !in_single_quote;
            continue;
        }

        if ch == '"' && !in_single_quote {
            current.push(ch);
            if in_double_quote && next == Some('"') {
                current.push(chars.next().unwrap_or('"'));
                continue;
            }
            in_double_quote = !in_double_quote;
            continue;
        }

        if ch == ';' && !in_single_quote && !in_double_quote {
            push_statement(&mut statements, &mut current);
            continue;
        }

        current.push(ch);
    }

    push_statement(&mut statements, &mut current);
    statements
}

fn push_statement(statements: &mut Vec<String>, current: &mut String) {
    let statement = current.trim();
    if !statement.is_empty() {
        statements.push(statement.to_string());
    }
    current.clear();
}

#[cfg(test)]
mod tests {
    use super::split_sql_statements;

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
}
