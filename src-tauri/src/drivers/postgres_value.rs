//! PostgreSQL binary-protocol decoding. SQL NULL is handled by Option at the
//! row boundary; malformed/unsupported non-null values must remain errors.
use std::error::Error;

use chrono::{DateTime, NaiveDate, NaiveDateTime, NaiveTime, Utc};
use serde_json::Value;
use tokio_postgres::types::{FromSql, Kind, Type};
use uuid::Uuid;

use crate::utils::result_value::{signed_integer, unsigned_integer};

type DecodeError = Box<dyn Error + Sync + Send>;

#[derive(Debug)]
pub(super) struct PgValue(pub Value);

impl<'a> FromSql<'a> for PgValue {
    fn from_sql(ty: &Type, raw: &'a [u8]) -> Result<Self, DecodeError> {
        if let Kind::Domain(inner) = ty.kind() {
            return Self::from_sql(inner, raw);
        }
        if let Kind::Array(_) = ty.kind() {
            let values = Vec::<Option<PgValue>>::from_sql(ty, raw)?;
            return Ok(Self(Value::Array(
                values
                    .into_iter()
                    .map(|value| value.map_or(Value::Null, |value| value.0))
                    .collect(),
            )));
        }
        let value = match *ty {
            Type::BOOL => Value::Bool(bool::from_sql(ty, raw)?),
            Type::INT2 => signed_integer(i16::from_sql(ty, raw)? as i64),
            Type::INT4 => signed_integer(i32::from_sql(ty, raw)? as i64),
            Type::INT8 => signed_integer(i64::from_sql(ty, raw)?),
            Type::OID => unsigned_integer(u32::from_sql(ty, raw)? as u64),
            Type::XID | Type::CID => unsigned_integer(u32::from_be_bytes(raw.try_into()?) as u64),
            Type::FLOAT4 => float_value(f32::from_sql(ty, raw)? as f64),
            Type::FLOAT8 => float_value(f64::from_sql(ty, raw)?),
            Type::NUMERIC => Value::String(decode_numeric(raw)?),
            Type::UUID => Value::String(Uuid::from_sql(ty, raw)?.to_string()),
            Type::DATE => Value::String(match raw {
                [0x7f, 0xff, 0xff, 0xff] => "infinity".into(),
                [0x80, 0, 0, 0] => "-infinity".into(),
                _ => NaiveDate::from_sql(ty, raw)?.to_string(),
            }),
            Type::TIME => Value::String(NaiveTime::from_sql(ty, raw)?.to_string()),
            Type::TIMESTAMP | Type::TIMESTAMPTZ => {
                let micros = i64::from_be_bytes(raw.try_into()?);
                Value::String(if micros == i64::MAX {
                    "infinity".into()
                } else if micros == i64::MIN {
                    "-infinity".into()
                } else if *ty == Type::TIMESTAMPTZ {
                    DateTime::<Utc>::from_sql(ty, raw)?.to_rfc3339()
                } else {
                    NaiveDateTime::from_sql(ty, raw)?.to_string()
                })
            }
            Type::BYTEA => Value::String(format!(
                "0x{}",
                raw.iter()
                    .map(|byte| format!("{byte:02x}"))
                    .collect::<String>()
            )),
            // Keep JSON text intact: parsing it into floating-point values here
            // or in JavaScript would round nested large numbers/decimals.
            Type::JSON => Value::String(std::str::from_utf8(raw)?.to_owned()),
            Type::JSONB => {
                if raw.first() != Some(&1) {
                    return Err("unsupported PostgreSQL JSONB version".into());
                }
                Value::String(std::str::from_utf8(&raw[1..])?.to_owned())
            }
            _ if matches!(ty.kind(), Kind::Enum(_)) || String::accepts(ty) => {
                Value::String(std::str::from_utf8(raw)?.to_owned())
            }
            _ => return Err(format!("unsupported PostgreSQL result type: {}", ty.name()).into()),
        };
        Ok(Self(value))
    }

    fn accepts(_ty: &Type) -> bool {
        true
    }
}

fn float_value(value: f64) -> Value {
    serde_json::Number::from_f64(value)
        .map(Value::Number)
        .unwrap_or_else(|| Value::String(value.to_string()))
}

/// NUMERIC uses signed base-10000 groups, not an IEEE floating-point value.
fn decode_numeric(raw: &[u8]) -> Result<String, DecodeError> {
    if raw.len() < 8 {
        return Err("invalid PostgreSQL numeric header".into());
    }
    let count = i16::from_be_bytes([raw[0], raw[1]]);
    let weight = i16::from_be_bytes([raw[2], raw[3]]) as i32;
    let sign = u16::from_be_bytes([raw[4], raw[5]]);
    let scale = u16::from_be_bytes([raw[6], raw[7]]) as usize;
    if count < 0 || raw.len() != 8 + count as usize * 2 || scale > 16383 {
        return Err("invalid PostgreSQL numeric length or scale".into());
    }
    match sign {
        0xc000 => return Ok("NaN".into()),
        0xd000 => return Ok("Infinity".into()),
        0xf000 => return Ok("-Infinity".into()),
        0 | 0x4000 => {}
        _ => return Err("invalid PostgreSQL numeric sign".into()),
    }
    let (digit_bytes, remainder) = raw[8..].as_chunks::<2>();
    debug_assert!(remainder.is_empty());
    let digits = digit_bytes
        .iter()
        .map(|bytes| u16::from_be_bytes(*bytes))
        .collect::<Vec<_>>();
    if digits.iter().any(|digit| *digit >= 10000) {
        return Err("invalid PostgreSQL numeric digit".into());
    }
    let group = |power: i32| -> u16 {
        let index = weight - power;
        if index < 0 {
            0
        } else {
            digits.get(index as usize).copied().unwrap_or(0)
        }
    };
    let mut output = String::new();
    if sign == 0x4000 && digits.iter().any(|digit| *digit != 0) {
        output.push('-');
    }
    if weight < 0 {
        output.push('0');
    } else {
        output.push_str(&group(weight).to_string());
        for power in (0..weight).rev() {
            output.push_str(&format!("{:04}", group(power)));
        }
    }
    if scale > 0 {
        output.push('.');
        let end = output.len() + scale;
        for index in 1..=scale.div_ceil(4) {
            output.push_str(&format!("{:04}", group(-(index as i32))));
        }
        output.truncate(end);
    }
    Ok(output)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn decode(ty: Type, raw: &[u8]) -> Value {
        PgValue::from_sql(&ty, raw).unwrap().0
    }

    fn numeric(weight: i16, sign: u16, scale: u16, digits: &[u16]) -> Vec<u8> {
        [
            (digits.len() as i16).to_be_bytes().as_slice(),
            &weight.to_be_bytes(),
            &sign.to_be_bytes(),
            &scale.to_be_bytes(),
            &digits
                .iter()
                .flat_map(|digit| digit.to_be_bytes())
                .collect::<Vec<_>>(),
        ]
        .concat()
    }

    #[test]
    fn decodes_numeric_without_rounding_or_losing_scale() {
        assert_eq!(
            decode_numeric(&numeric(0, 0, 4, &[123, 4500])).unwrap(),
            "123.4500"
        );
        assert_eq!(
            decode_numeric(&numeric(-2, 0x4000, 8, &[12])).unwrap(),
            "-0.00000012"
        );
        assert_eq!(
            decode_numeric(&numeric(2, 0, 0, &[1])).unwrap(),
            "100000000"
        );
        assert_eq!(decode_numeric(&numeric(0, 0, 2, &[])).unwrap(), "0.00");
        assert_eq!(
            decode_numeric(&numeric(3, 0, 0, &[9007, 1992, 5474, 993])).unwrap(),
            "9007199254740993"
        );
        assert_eq!(decode_numeric(&numeric(0, 0xc000, 0, &[])).unwrap(), "NaN");
        assert!(decode_numeric(&numeric(0, 0, 0, &[10000])).is_err());
        assert!(decode_numeric(&[0; 7]).is_err());
    }

    #[test]
    fn decodes_integer_date_uuid_and_binary_values() {
        assert_eq!(
            decode(Type::INT2, &7_i16.to_be_bytes()),
            serde_json::json!(7)
        );
        assert_eq!(
            decode(Type::INT8, &9_007_199_254_740_993_i64.to_be_bytes()),
            serde_json::json!("9007199254740993")
        );
        assert_eq!(
            decode(Type::OID, &u32::MAX.to_be_bytes()),
            serde_json::json!(u32::MAX)
        );
        assert_eq!(
            decode(Type::DATE, &0_i32.to_be_bytes()),
            serde_json::json!("2000-01-01")
        );
        assert_eq!(
            decode(Type::TIMESTAMP, &0_i64.to_be_bytes()),
            serde_json::json!("2000-01-01 00:00:00")
        );
        assert_eq!(
            decode(Type::TIMESTAMPTZ, &0_i64.to_be_bytes()),
            serde_json::json!("2000-01-01T00:00:00+00:00")
        );
        assert_eq!(
            decode(Type::TIME, &0_i64.to_be_bytes()),
            serde_json::json!("00:00:00")
        );
        assert_eq!(
            decode(Type::UUID, &[0; 16]),
            serde_json::json!("00000000-0000-0000-0000-000000000000")
        );
        assert_eq!(decode(Type::BYTEA, &[0, 255]), serde_json::json!("0x00ff"));
    }

    #[test]
    fn preserves_json_text_and_distinguishes_null_from_decode_errors() {
        let json = br#"{"id":9007199254740993,"n":0.1234567890123456789}"#;
        assert_eq!(
            decode(Type::JSON, json).as_str(),
            Some(std::str::from_utf8(json).unwrap())
        );
        assert_eq!(
            decode(Type::JSONB, &[&[1][..], json].concat()).as_str(),
            Some(std::str::from_utf8(json).unwrap())
        );
        assert!(Option::<PgValue>::from_sql_null(&Type::INT2)
            .unwrap()
            .is_none());
        assert!(PgValue::from_sql(&Type::INT2, &[1]).is_err());
        assert!(PgValue::from_sql(&Type::POINT, &[0; 16]).is_err());
        assert!(PgValue::from_sql(&Type::JSONB, &[2]).is_err());
    }

    #[test]
    fn decodes_arrays_with_null_elements() {
        // One dimension, nullable elements, INT2, length 2, lower bound 1.
        let mut raw = [1_i32, 1, 21, 2, 1, 2]
            .into_iter()
            .flat_map(i32::to_be_bytes)
            .collect::<Vec<_>>();
        raw.extend(7_i16.to_be_bytes());
        raw.extend((-1_i32).to_be_bytes());
        assert_eq!(decode(Type::INT2_ARRAY, &raw), serde_json::json!([7, null]));
    }
}
