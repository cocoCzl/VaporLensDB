//! Lossless scalar values at the JavaScript IPC boundary.
use serde_json::Value;

const MAX_SAFE_INTEGER: i64 = 9_007_199_254_740_991;

pub fn signed_integer(value: i64) -> Value {
    if (-MAX_SAFE_INTEGER..=MAX_SAFE_INTEGER).contains(&value) {
        value.into()
    } else {
        Value::String(value.to_string())
    }
}

pub fn unsigned_integer(value: u64) -> Value {
    if value <= MAX_SAFE_INTEGER as u64 {
        value.into()
    } else {
        Value::String(value.to_string())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn preserves_integer_boundaries_without_changing_small_numbers() {
        assert_eq!(signed_integer(42), serde_json::json!(42));
        assert_eq!(
            signed_integer(MAX_SAFE_INTEGER),
            serde_json::json!(MAX_SAFE_INTEGER)
        );
        assert_eq!(
            signed_integer(-MAX_SAFE_INTEGER),
            serde_json::json!(-MAX_SAFE_INTEGER)
        );
        for value in [
            MAX_SAFE_INTEGER + 1,
            MAX_SAFE_INTEGER + 2,
            -MAX_SAFE_INTEGER - 1,
            i64::MIN,
            i64::MAX,
        ] {
            assert_eq!(signed_integer(value), Value::String(value.to_string()));
        }
        assert_eq!(
            unsigned_integer(MAX_SAFE_INTEGER as u64),
            serde_json::json!(MAX_SAFE_INTEGER)
        );
        assert_eq!(
            unsigned_integer(u64::MAX),
            Value::String(u64::MAX.to_string())
        );
    }
}
