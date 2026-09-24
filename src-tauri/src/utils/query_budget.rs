use serde_json::Value;

use crate::models::error::AppError;

pub const MAX_INTERACTIVE_CELL_BYTES: usize = 1024 * 1024;

pub fn row_json_bytes(row: &[Value]) -> Result<usize, AppError> {
    let mut row_bytes = 2_usize;
    for value in row {
        let cell_bytes = estimated_json_bytes(value);
        if cell_bytes > MAX_INTERACTIVE_CELL_BYTES {
            return Err(AppError::ConfigError(format!(
                "interactive result cell exceeds the {MAX_INTERACTIVE_CELL_BYTES} byte limit"
            )));
        }
        row_bytes = row_bytes.saturating_add(cell_bytes).saturating_add(1);
    }
    Ok(row_bytes)
}

fn estimated_json_bytes(value: &Value) -> usize {
    match value {
        Value::Null => 4,
        Value::Bool(true) => 4,
        Value::Bool(false) => 5,
        Value::Number(number) => number.to_string().len(),
        Value::String(value) => value.chars().fold(2_usize, |total, ch| {
            let encoded = match ch {
                '"' | '\\' | '\u{08}' | '\u{0c}' | '\n' | '\r' | '\t' => 2,
                ch if ch <= '\u{1f}' => 6,
                ch => ch.len_utf8(),
            };
            total.saturating_add(encoded)
        }),
        Value::Array(values) => values.iter().fold(2_usize, |total, value| {
            total
                .saturating_add(estimated_json_bytes(value))
                .saturating_add(1)
        }),
        Value::Object(values) => values.iter().fold(2_usize, |total, (key, value)| {
            total
                .saturating_add(key.len())
                .saturating_add(3)
                .saturating_add(estimated_json_bytes(value))
                .saturating_add(1)
        }),
    }
}
