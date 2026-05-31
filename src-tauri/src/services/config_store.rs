use std::{
    path::{Path, PathBuf},
    str::FromStr,
};

use chrono::{DateTime, Utc};
use rusqlite::{params, Connection, OptionalExtension, Row};
use uuid::Uuid;

use crate::{
    models::{
        connection::{ConnectionConfig, DriverType},
        error::AppError,
    },
    utils::crypto,
};

#[derive(Debug, Clone)]
pub struct ConfigStore {
    config_dir: PathBuf,
    db_path: PathBuf,
}

impl ConfigStore {
    pub fn new_default() -> Result<Self, AppError> {
        let home = std::env::var("HOME").map_err(|_| {
            AppError::ConfigError("HOME environment variable is required".to_string())
        })?;
        Self::new(PathBuf::from(home).join(".vaporlensdb"))
    }

    pub fn new(config_dir: PathBuf) -> Result<Self, AppError> {
        std::fs::create_dir_all(&config_dir)?;
        let store = Self {
            db_path: config_dir.join("config.db"),
            config_dir,
        };
        store.init()?;
        Ok(store)
    }

    pub fn config_dir(&self) -> &Path {
        &self.config_dir
    }

    pub fn create_connection(
        &self,
        mut config: ConnectionConfig,
        password: Option<String>,
    ) -> Result<ConnectionConfig, AppError> {
        let now = Utc::now();
        config.created_at = now;
        config.updated_at = now;
        config.password_encrypted = password
            .as_deref()
            .filter(|value| !value.is_empty())
            .map(|value| crypto::encrypt_password(&self.config_dir, value))
            .transpose()?;

        self.conn()?.execute(
            "
            INSERT INTO connections (
                id, name, driver_type, host, port, database_name, connection_url, username,
                password_encrypted, driver_class, driver_paths, ssl_mode, group_name, color_tag,
                created_at, updated_at
            )
            VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16)
            ",
            params_from_config(&config),
        )?;

        Ok(config)
    }

    pub fn update_connection(
        &self,
        mut config: ConnectionConfig,
        password: Option<String>,
    ) -> Result<ConnectionConfig, AppError> {
        let existing = self
            .get_connection(config.id)?
            .ok_or_else(|| AppError::NotFound {
                resource: "connection".to_string(),
                id: config.id.to_string(),
            })?;

        config.created_at = existing.created_at;
        config.updated_at = Utc::now();
        config.password_encrypted = match password {
            Some(password) if !password.is_empty() => {
                Some(crypto::encrypt_password(&self.config_dir, &password)?)
            }
            _ => existing.password_encrypted,
        };

        self.conn()?.execute(
            "
            UPDATE connections
            SET name = ?2,
                driver_type = ?3,
                host = ?4,
                port = ?5,
                database_name = ?6,
                connection_url = ?7,
                username = ?8,
                password_encrypted = ?9,
                driver_class = ?10,
                driver_paths = ?11,
                ssl_mode = ?12,
                group_name = ?13,
                color_tag = ?14,
                created_at = ?15,
                updated_at = ?16
            WHERE id = ?1
            ",
            params_from_config(&config),
        )?;

        Ok(config)
    }

    pub fn delete_connection(&self, id: Uuid) -> Result<(), AppError> {
        let affected = self.conn()?.execute(
            "DELETE FROM connections WHERE id = ?1",
            params![id.to_string()],
        )?;
        if affected == 0 {
            return Err(AppError::NotFound {
                resource: "connection".to_string(),
                id: id.to_string(),
            });
        }
        Ok(())
    }

    pub fn list_connections(&self) -> Result<Vec<ConnectionConfig>, AppError> {
        let conn = self.conn()?;
        let mut statement = conn.prepare(
            "
            SELECT id, name, driver_type, host, port, database_name, connection_url, username,
                   password_encrypted, driver_class, driver_paths, ssl_mode, group_name,
                   color_tag, created_at, updated_at
            FROM connections
            ORDER BY group_name IS NOT NULL, group_name, name
            ",
        )?;

        let rows = statement.query_map([], row_to_connection)?;
        rows.collect::<Result<Vec<_>, _>>().map_err(AppError::from)
    }

    pub fn get_connection(&self, id: Uuid) -> Result<Option<ConnectionConfig>, AppError> {
        self.conn()?
            .query_row(
                "
                SELECT id, name, driver_type, host, port, database_name, connection_url, username,
                       password_encrypted, driver_class, driver_paths, ssl_mode, group_name,
                       color_tag, created_at, updated_at
                FROM connections
                WHERE id = ?1
                ",
                params![id.to_string()],
                row_to_connection,
            )
            .optional()
            .map_err(AppError::from)
    }

    pub fn decrypt_password(&self, config: &ConnectionConfig) -> Result<Option<String>, AppError> {
        config
            .password_encrypted
            .as_deref()
            .map(|value| crypto::decrypt_password(&self.config_dir, value))
            .transpose()
    }

    fn init(&self) -> Result<(), AppError> {
        let conn = self.conn()?;
        conn.execute_batch(
            "
            CREATE TABLE IF NOT EXISTS schema_migrations (
                version INTEGER PRIMARY KEY,
                applied_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS connections (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                driver_type TEXT NOT NULL,
                host TEXT,
                port INTEGER,
                database_name TEXT,
                connection_url TEXT,
                username TEXT,
                password_encrypted TEXT,
                driver_class TEXT,
                driver_paths TEXT,
                ssl_mode TEXT,
                group_name TEXT,
                color_tag TEXT,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            );

            INSERT OR IGNORE INTO schema_migrations (version, applied_at)
            VALUES (1, datetime('now'));
            ",
        )?;
        self.ensure_column("connections", "connection_url", "TEXT")?;
        self.ensure_column("connections", "driver_class", "TEXT")?;
        self.ensure_column("connections", "driver_paths", "TEXT")?;
        Ok(())
    }

    fn conn(&self) -> Result<Connection, AppError> {
        Connection::open(&self.db_path).map_err(AppError::from)
    }

    fn ensure_column(&self, table: &str, column: &str, column_type: &str) -> Result<(), AppError> {
        let conn = self.conn()?;
        let mut statement = conn.prepare(&format!("PRAGMA table_info({table})"))?;
        let exists = statement
            .query_map([], |row| row.get::<_, String>(1))?
            .collect::<Result<Vec<_>, _>>()?
            .iter()
            .any(|name| name == column);

        if !exists {
            conn.execute(
                &format!("ALTER TABLE {table} ADD COLUMN {column} {column_type}"),
                [],
            )?;
        }

        Ok(())
    }
}

fn params_from_config(config: &ConnectionConfig) -> [Box<dyn rusqlite::ToSql>; 16] {
    let driver_paths = serde_json::to_string(&config.driver_paths).unwrap_or_default();

    [
        Box::new(config.id.to_string()),
        Box::new(config.name.clone()),
        Box::new(config.driver_type.to_string()),
        Box::new(config.host.clone()),
        Box::new(config.port.map(i64::from)),
        Box::new(config.database.clone()),
        Box::new(config.connection_url.clone()),
        Box::new(config.username.clone()),
        Box::new(config.password_encrypted.clone()),
        Box::new(config.driver_class.clone()),
        Box::new(driver_paths),
        Box::new(config.ssl_mode.clone()),
        Box::new(config.group.clone()),
        Box::new(config.color_tag.clone()),
        Box::new(config.created_at.to_rfc3339()),
        Box::new(config.updated_at.to_rfc3339()),
    ]
}

fn row_to_connection(row: &Row<'_>) -> Result<ConnectionConfig, rusqlite::Error> {
    let id: String = row.get(0)?;
    let driver_type: String = row.get(2)?;
    let created_at: String = row.get(14)?;
    let updated_at: String = row.get(15)?;
    let port: Option<i64> = row.get(4)?;
    let driver_paths: Option<String> = row.get(10)?;

    Ok(ConnectionConfig {
        id: Uuid::parse_str(&id).map_err(parse_error)?,
        name: row.get(1)?,
        driver_type: DriverType::from_str(&driver_type).map_err(parse_error)?,
        host: row.get(3)?,
        port: port.map(|value| value as u16),
        database: row.get(5)?,
        connection_url: row.get(6)?,
        username: row.get(7)?,
        password_encrypted: row.get(8)?,
        driver_class: row.get(9)?,
        driver_paths: driver_paths
            .as_deref()
            .and_then(|value| serde_json::from_str(value).ok())
            .unwrap_or_default(),
        ssl_mode: row.get(11)?,
        group: row.get(12)?,
        color_tag: row.get(13)?,
        created_at: DateTime::parse_from_rfc3339(&created_at)
            .map_err(parse_error)?
            .with_timezone(&Utc),
        updated_at: DateTime::parse_from_rfc3339(&updated_at)
            .map_err(parse_error)?
            .with_timezone(&Utc),
    })
}

fn parse_error(error: impl ToString) -> rusqlite::Error {
    rusqlite::Error::InvalidParameterName(error.to_string())
}

#[cfg(test)]
mod tests {
    use super::ConfigStore;
    use crate::models::connection::{ConnectionConfig, DriverType};
    use chrono::Utc;
    use uuid::Uuid;

    #[test]
    fn stores_connection_without_plaintext_password() {
        std::env::set_var("VAPORLENSDB_USE_DEV_KEY", "1");
        let dir =
            std::env::temp_dir().join(format!("vaporlensdb-config-test-{}", uuid::Uuid::new_v4()));
        let store = ConfigStore::new(dir).expect("create config store");
        let config = ConnectionConfig {
            id: Uuid::new_v4(),
            name: "Local PG".to_string(),
            driver_type: DriverType::Postgres,
            host: Some("localhost".to_string()),
            port: Some(5432),
            database: Some("penguin_farm".to_string()),
            connection_url: None,
            username: Some("postgres".to_string()),
            password_encrypted: None,
            driver_class: None,
            driver_paths: Vec::new(),
            ssl_mode: None,
            group: None,
            color_tag: None,
            created_at: Utc::now(),
            updated_at: Utc::now(),
        };

        let saved = store
            .create_connection(config, Some("postgres123".to_string()))
            .expect("save connection");
        assert_ne!(saved.password_encrypted.as_deref(), Some("postgres123"));

        let password = store
            .decrypt_password(&saved)
            .expect("decrypt password")
            .expect("password exists");
        assert_eq!(password, "postgres123");

        let connections = store.list_connections().expect("list connections");
        assert_eq!(connections.len(), 1);
    }
}
