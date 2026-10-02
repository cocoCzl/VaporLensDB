use serde_json::Value;

use crate::models::error::AppError;

pub const MAX_INTERACTIVE_CELL_BYTES: usize = 1024 * 1024;
pub const MAX_INTERACTIVE_SOURCE_CHUNK_BYTES: usize = 4 * 1024 * 1024;

pub struct QueryChunkBuffer {
    max_rows: usize,
    estimated_bytes: usize,
    rows: Vec<Vec<Value>>,
}

impl QueryChunkBuffer {
    pub fn new(max_rows: usize) -> Self {
        Self {
            max_rows: max_rows.max(1),
            estimated_bytes: 0,
            rows: Vec::with_capacity(max_rows.max(1)),
        }
    }

    pub fn push(&mut self, row: Vec<Value>) -> Result<Option<Vec<Vec<Value>>>, AppError> {
        let row_bytes = row_json_bytes(&row)?;
        if row_bytes > MAX_INTERACTIVE_SOURCE_CHUNK_BYTES {
            return Err(AppError::ResultLimitExceeded(format!(
                "interactive result row exceeds the {MAX_INTERACTIVE_SOURCE_CHUNK_BYTES} byte source chunk limit"
            )));
        }

        let should_flush = !self.rows.is_empty()
            && (self.rows.len() >= self.max_rows
                || row_bytes
                    > MAX_INTERACTIVE_SOURCE_CHUNK_BYTES.saturating_sub(self.estimated_bytes));
        let flushed = should_flush.then(|| self.take());
        self.estimated_bytes = self.estimated_bytes.saturating_add(row_bytes);
        self.rows.push(row);
        Ok(flushed)
    }

    pub fn take(&mut self) -> Vec<Vec<Value>> {
        self.estimated_bytes = 0;
        std::mem::take(&mut self.rows)
    }

    pub fn is_empty(&self) -> bool {
        self.rows.is_empty()
    }

    pub fn len(&self) -> usize {
        self.rows.len()
    }
}

pub fn row_json_bytes(row: &[Value]) -> Result<usize, AppError> {
    let mut row_bytes = 2_usize;
    for value in row {
        let cell_bytes = estimated_json_bytes(value);
        if cell_bytes > MAX_INTERACTIVE_CELL_BYTES {
            return Err(AppError::ResultLimitExceeded(format!(
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
        Value::String(value) => estimated_json_string_bytes(value),
        Value::Array(values) => values.iter().fold(2_usize, |total, value| {
            total
                .saturating_add(estimated_json_bytes(value))
                .saturating_add(1)
        }),
        Value::Object(values) => values.iter().fold(2_usize, |total, (key, value)| {
            total
                .saturating_add(estimated_json_string_bytes(key))
                .saturating_add(1)
                .saturating_add(estimated_json_bytes(value))
                .saturating_add(1)
        }),
    }
}

fn estimated_json_string_bytes(value: &str) -> usize {
    value.chars().fold(2_usize, |total, ch| {
        let encoded = match ch {
            '"' | '\\' | '\u{08}' | '\u{0c}' | '\n' | '\r' | '\t' => 2,
            ch if ch <= '\u{1f}' => 6,
            ch => ch.len_utf8(),
        };
        total.saturating_add(encoded)
    })
}

#[cfg(test)]
mod tests {
    use super::{QueryChunkBuffer, MAX_INTERACTIVE_CELL_BYTES};

    #[test]
    fn rejects_oversized_cells_before_buffering_them() {
        let mut buffer = QueryChunkBuffer::new(10);
        let result = buffer.push(vec![serde_json::json!(
            "x".repeat(MAX_INTERACTIVE_CELL_BYTES)
        )]);
        assert!(result.is_err());
        assert_eq!(result.unwrap_err().code(), "RESULT_LIMIT_EXCEEDED");
        assert!(buffer.is_empty());
    }

    #[test]
    fn flushes_source_chunks_by_rows_and_estimated_bytes() {
        let mut row_limited = QueryChunkBuffer::new(2);
        assert!(row_limited
            .push(vec![serde_json::json!(1)])
            .unwrap()
            .is_none());
        assert!(row_limited
            .push(vec![serde_json::json!(2)])
            .unwrap()
            .is_none());
        let flushed = row_limited
            .push(vec![serde_json::json!(3)])
            .unwrap()
            .unwrap();
        assert_eq!(flushed.len(), 2);
        assert_eq!(row_limited.take(), vec![vec![serde_json::json!(3)]]);

        let mut byte_limited = QueryChunkBuffer::new(10);
        let cell = "x".repeat(MAX_INTERACTIVE_CELL_BYTES - 2);
        for _ in 0..3 {
            assert!(byte_limited
                .push(vec![serde_json::json!(&cell)])
                .unwrap()
                .is_none());
        }
        let flushed = byte_limited
            .push(vec![serde_json::json!(&cell)])
            .unwrap()
            .unwrap();
        assert_eq!(flushed.len(), 3);
        assert_eq!(byte_limited.take().len(), 1);
    }
}
