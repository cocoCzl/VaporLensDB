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
        query_history::{QueryHistoryEntry, QueryHistoryStatus},
    },
    utils::crypto,
};

#[derive(Debug, Clone)]
pub struct ConfigStore {
    config_dir: PathBuf,
    db_path: PathBuf,
}

struct ConfigMigration {
    version: i64,
    name: &'static str,
    apply: fn(&Connection) -> Result<(), AppError>,
}

const CONFIG_MIGRATIONS: &[ConfigMigration] = &[
    ConfigMigration {
        version: 1,
        name: "create base connection store",
        apply: create_base_connection_store,
    },
    ConfigMigration {
        version: 2,
        name: "add external driver connection fields",
        apply: add_external_driver_connection_fields,
    },
    ConfigMigration {
        version: 3,
        name: "create query history store",
        apply: create_query_history_store,
    },
];

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

    pub fn add_query_history(
        &self,
        entry: QueryHistoryEntry,
    ) -> Result<QueryHistoryEntry, AppError> {
        let conn = self.conn()?;
        conn.execute(
            "
            INSERT INTO query_history (
                id, connection_id, connection_name_snapshot, driver_type, database_name,
                schema_name, sql, status, started_at, elapsed_ms, row_count, affected_rows,
                error_code, error_message
            )
            VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14)
            ",
            params![
                entry.id.to_string(),
                entry.connection_id.to_string(),
                &entry.connection_name_snapshot,
                entry.driver_type.to_string(),
                &entry.database,
                &entry.schema,
                &entry.sql,
                query_history_status_value(&entry.status),
                entry.started_at.to_rfc3339(),
                entry.elapsed_ms.map(|value| value as i64),
                entry.row_count.map(|value| value as i64),
                entry.affected_rows.map(|value| value as i64),
                &entry.error_code,
                &entry.error_message,
            ],
        )?;
        self.prune_query_history(5_000)?;
        Ok(entry)
    }

    pub fn list_query_history(&self, limit: u32) -> Result<Vec<QueryHistoryEntry>, AppError> {
        let limit = limit.clamp(1, 5_000);
        let conn = self.conn()?;
        let mut statement = conn.prepare(
            "
            SELECT id, connection_id, connection_name_snapshot, driver_type, database_name,
                   schema_name, sql, status, started_at, elapsed_ms, row_count, affected_rows,
                   error_code, error_message
            FROM query_history
            ORDER BY started_at DESC
            LIMIT ?1
            ",
        )?;

        let rows = statement.query_map(params![limit], row_to_query_history)?;
        rows.collect::<Result<Vec<_>, _>>().map_err(AppError::from)
    }

    pub fn clear_query_history(&self) -> Result<(), AppError> {
        self.conn()?.execute("DELETE FROM query_history", [])?;
        Ok(())
    }

    fn init(&self) -> Result<(), AppError> {
        let conn = self.conn()?;
        run_config_migrations(&conn)
    }

    fn conn(&self) -> Result<Connection, AppError> {
        Connection::open(&self.db_path).map_err(AppError::from)
    }

    fn prune_query_history(&self, max_entries: u32) -> Result<(), AppError> {
        self.conn()?.execute(
            "
            DELETE FROM query_history
            WHERE id NOT IN (
                SELECT id
                FROM query_history
                ORDER BY started_at DESC
                LIMIT ?1
            )
            ",
            params![max_entries],
        )?;
        Ok(())
    }

    #[cfg(test)]
    fn migration_versions(&self) -> Result<Vec<i64>, AppError> {
        let conn = self.conn()?;
        let mut statement = conn.prepare(
            "
            SELECT version
            FROM schema_migrations
            ORDER BY version
            ",
        )?;
        let rows = statement.query_map([], |row| row.get::<_, i64>(0))?;
        rows.collect::<Result<Vec<_>, _>>().map_err(AppError::from)
    }
}

fn run_config_migrations(conn: &Connection) -> Result<(), AppError> {
    conn.execute_batch(
        "
        CREATE TABLE IF NOT EXISTS schema_migrations (
            version INTEGER PRIMARY KEY,
            applied_at TEXT NOT NULL
        );
        ",
    )?;

    for migration in CONFIG_MIGRATIONS {
        if migration_applied(conn, migration.version)? {
            continue;
        }

        (migration.apply)(conn).map_err(|error| {
            AppError::ConfigError(format!(
                "failed to apply config migration {} ({}): {}",
                migration.version, migration.name, error
            ))
        })?;
        conn.execute(
            "
            INSERT INTO schema_migrations (version, applied_at)
            VALUES (?1, datetime('now'))
            ",
            params![migration.version],
        )?;
    }

    Ok(())
}

fn migration_applied(conn: &Connection, version: i64) -> Result<bool, AppError> {
    conn.query_row(
        "SELECT 1 FROM schema_migrations WHERE version = ?1",
        params![version],
        |_| Ok(()),
    )
    .optional()
    .map(|value| value.is_some())
    .map_err(AppError::from)
}

fn create_base_connection_store(conn: &Connection) -> Result<(), AppError> {
    conn.execute_batch(
        "
        CREATE TABLE IF NOT EXISTS connections (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            driver_type TEXT NOT NULL,
            host TEXT,
            port INTEGER,
            database_name TEXT,
            username TEXT,
            password_encrypted TEXT,
            ssl_mode TEXT,
            group_name TEXT,
            color_tag TEXT,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
        );
        ",
    )
    .map_err(AppError::from)
}

fn add_external_driver_connection_fields(conn: &Connection) -> Result<(), AppError> {
    ensure_column(conn, "connections", "connection_url", "TEXT")?;
    ensure_column(conn, "connections", "driver_class", "TEXT")?;
    ensure_column(conn, "connections", "driver_paths", "TEXT")?;
    Ok(())
}

fn create_query_history_store(conn: &Connection) -> Result<(), AppError> {
    conn.execute_batch(
        "
        CREATE TABLE IF NOT EXISTS query_history (
            id TEXT PRIMARY KEY,
            connection_id TEXT NOT NULL,
            connection_name_snapshot TEXT NOT NULL,
            driver_type TEXT NOT NULL,
            database_name TEXT,
            schema_name TEXT,
            sql TEXT NOT NULL,
            status TEXT NOT NULL,
            started_at TEXT NOT NULL,
            elapsed_ms INTEGER,
            row_count INTEGER,
            affected_rows INTEGER,
            error_code TEXT,
            error_message TEXT
        );
        ",
    )
    .map_err(AppError::from)
}

fn ensure_column(
    conn: &Connection,
    table: &str,
    column: &str,
    column_type: &str,
) -> Result<(), AppError> {
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

#[cfg(test)]
fn table_columns(conn: &Connection, table: &str) -> Result<Vec<String>, AppError> {
    let mut statement = conn.prepare(&format!("PRAGMA table_info({table})"))?;
    let rows = statement.query_map([], |row| row.get::<_, String>(1))?;
    rows.collect::<Result<Vec<_>, _>>().map_err(AppError::from)
}

#[cfg(test)]
fn table_exists(conn: &Connection, table: &str) -> Result<bool, AppError> {
    conn.query_row(
        "
        SELECT 1
        FROM sqlite_master
        WHERE type = 'table' AND name = ?1
        ",
        params![table],
        |_| Ok(()),
    )
    .optional()
    .map(|value| value.is_some())
    .map_err(AppError::from)
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

fn row_to_query_history(row: &Row<'_>) -> Result<QueryHistoryEntry, rusqlite::Error> {
    let id: String = row.get(0)?;
    let connection_id: String = row.get(1)?;
    let driver_type: String = row.get(3)?;
    let status: String = row.get(7)?;
    let started_at: String = row.get(8)?;
    let elapsed_ms: Option<i64> = row.get(9)?;
    let row_count: Option<i64> = row.get(10)?;
    let affected_rows: Option<i64> = row.get(11)?;

    Ok(QueryHistoryEntry {
        id: Uuid::parse_str(&id).map_err(parse_error)?,
        connection_id: Uuid::parse_str(&connection_id).map_err(parse_error)?,
        connection_name_snapshot: row.get(2)?,
        driver_type: DriverType::from_str(&driver_type).map_err(parse_error)?,
        database: row.get(4)?,
        schema: row.get(5)?,
        sql: row.get(6)?,
        status: query_history_status_from_value(&status).map_err(parse_error)?,
        started_at: DateTime::parse_from_rfc3339(&started_at)
            .map_err(parse_error)?
            .with_timezone(&Utc),
        elapsed_ms: elapsed_ms.map(|value| value as u64),
        row_count: row_count.map(|value| value as u64),
        affected_rows: affected_rows.map(|value| value as u64),
        error_code: row.get(12)?,
        error_message: row.get(13)?,
    })
}

fn query_history_status_value(status: &QueryHistoryStatus) -> &'static str {
    match status {
        QueryHistoryStatus::Success => "success",
        QueryHistoryStatus::Failed => "failed",
    }
}

fn query_history_status_from_value(value: &str) -> Result<QueryHistoryStatus, String> {
    match value {
        "success" => Ok(QueryHistoryStatus::Success),
        "failed" => Ok(QueryHistoryStatus::Failed),
        _ => Err(format!("unsupported query history status: {value}")),
    }
}

fn parse_error(error: impl ToString) -> rusqlite::Error {
    rusqlite::Error::InvalidParameterName(error.to_string())
}

#[cfg(test)]
mod tests {
    use super::{table_columns, table_exists, ConfigStore};
    use crate::models::{
        connection::{ConnectionConfig, DriverType},
        query_history::{QueryHistoryEntry, QueryHistoryStatus},
    };
    use chrono::Utc;
    use rusqlite::{params, Connection};
    use uuid::Uuid;

    #[test]
    fn fresh_database_runs_all_config_migrations_in_order() {
        std::env::set_var("VAPORLENSDB_USE_DEV_KEY", "1");
        let dir = std::env::temp_dir().join(format!(
            "vaporlensdb-fresh-migration-test-{}",
            Uuid::new_v4()
        ));
        let store = ConfigStore::new(dir).expect("create config store");

        assert_eq!(
            store.migration_versions().expect("list migration versions"),
            vec![1, 2, 3]
        );
    }

    #[test]
    fn upgrades_old_config_database_in_place() {
        std::env::set_var("VAPORLENSDB_USE_DEV_KEY", "1");
        let dir = std::env::temp_dir().join(format!(
            "vaporlensdb-upgrade-migration-test-{}",
            Uuid::new_v4()
        ));
        std::fs::create_dir_all(&dir).expect("create temp config dir");
        let db_path = dir.join("config.db");
        let old_connection_id = Uuid::new_v4();
        let created_at = Utc::now().to_rfc3339();

        let conn = Connection::open(&db_path).expect("open old config db");
        conn.execute_batch(
            "
            CREATE TABLE schema_migrations (
                version INTEGER PRIMARY KEY,
                applied_at TEXT NOT NULL
            );

            CREATE TABLE connections (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                driver_type TEXT NOT NULL,
                host TEXT,
                port INTEGER,
                database_name TEXT,
                username TEXT,
                password_encrypted TEXT,
                ssl_mode TEXT,
                group_name TEXT,
                color_tag TEXT,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            );

            INSERT INTO schema_migrations (version, applied_at)
            VALUES (1, datetime('now'));
            ",
        )
        .expect("create old config schema");
        conn.execute(
            "
            INSERT INTO connections (
                id, name, driver_type, host, port, database_name, username,
                password_encrypted, ssl_mode, group_name, color_tag, created_at, updated_at
            )
            VALUES (?1, 'Legacy PG', 'postgres', 'localhost', 5432, 'postgres',
                    'postgres', NULL, NULL, 'Legacy', 'dev', ?2, ?2)
            ",
            params![old_connection_id.to_string(), created_at],
        )
        .expect("insert old connection");
        drop(conn);

        let store = ConfigStore::new(dir.clone()).expect("upgrade config store");
        let conn = Connection::open(db_path).expect("open upgraded config db");
        let columns = table_columns(&conn, "connections").expect("list connection columns");

        assert_eq!(
            store.migration_versions().expect("list migration versions"),
            vec![1, 2, 3]
        );
        assert!(columns.iter().any(|column| column == "connection_url"));
        assert!(columns.iter().any(|column| column == "driver_class"));
        assert!(columns.iter().any(|column| column == "driver_paths"));
        assert!(table_exists(&conn, "query_history").expect("query history table exists"));

        let upgraded = store
            .get_connection(old_connection_id)
            .expect("get upgraded connection")
            .expect("connection exists");
        assert_eq!(upgraded.name, "Legacy PG");
        assert_eq!(upgraded.group.as_deref(), Some("Legacy"));
    }

    #[test]
    fn config_migration_failure_reports_version_and_name() {
        std::env::set_var("VAPORLENSDB_USE_DEV_KEY", "1");
        let dir = std::env::temp_dir().join(format!(
            "vaporlensdb-failed-migration-test-{}",
            Uuid::new_v4()
        ));
        std::fs::create_dir_all(&dir).expect("create temp config dir");
        let conn = Connection::open(dir.join("config.db")).expect("open broken config db");
        conn.execute_batch(
            "
            CREATE TABLE schema_migrations (
                version INTEGER PRIMARY KEY,
                applied_at TEXT NOT NULL
            );

            INSERT INTO schema_migrations (version, applied_at)
            VALUES (1, datetime('now'));
            ",
        )
        .expect("create broken config schema");
        drop(conn);

        let error = ConfigStore::new(dir).expect_err("migration should fail");
        let message = error.to_string();

        assert!(message.contains("failed to apply config migration 2"));
        assert!(message.contains("add external driver connection fields"));
    }

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

    #[test]
    fn creates_updates_and_deletes_connection_with_v1_fields() {
        std::env::set_var("VAPORLENSDB_USE_DEV_KEY", "1");
        let dir = std::env::temp_dir().join(format!(
            "vaporlensdb-connection-crud-test-{}",
            uuid::Uuid::new_v4()
        ));
        let store = ConfigStore::new(dir).expect("create config store");
        let connection_id = Uuid::new_v4();
        let created_at = Utc::now();

        let saved = store
            .create_connection(
                ConnectionConfig {
                    id: connection_id,
                    name: "Local MySQL".to_string(),
                    driver_type: DriverType::Mysql,
                    host: Some("localhost".to_string()),
                    port: Some(3306),
                    database: Some("app".to_string()),
                    connection_url: Some("mysql://root@localhost:3306/app".to_string()),
                    username: Some("root".to_string()),
                    password_encrypted: None,
                    driver_class: None,
                    driver_paths: Vec::new(),
                    ssl_mode: Some("prefer".to_string()),
                    group: Some("Local".to_string()),
                    color_tag: Some("dev".to_string()),
                    created_at,
                    updated_at: created_at,
                },
                None,
            )
            .expect("create connection");

        assert_eq!(saved.id, connection_id);
        assert_eq!(
            saved.connection_url.as_deref(),
            Some("mysql://root@localhost:3306/app")
        );
        assert_eq!(saved.group.as_deref(), Some("Local"));
        assert_eq!(saved.color_tag.as_deref(), Some("dev"));

        let updated = store
            .update_connection(
                ConnectionConfig {
                    name: "Local MySQL Test".to_string(),
                    database: Some("app_test".to_string()),
                    color_tag: Some("test".to_string()),
                    updated_at: Utc::now(),
                    ..saved
                },
                None,
            )
            .expect("update connection");

        assert_eq!(updated.name, "Local MySQL Test");
        assert_eq!(updated.database.as_deref(), Some("app_test"));
        assert_eq!(updated.color_tag.as_deref(), Some("test"));

        store
            .delete_connection(connection_id)
            .expect("delete connection");
        assert!(store
            .get_connection(connection_id)
            .expect("get deleted connection")
            .is_none());
    }

    #[test]
    fn stores_and_clears_query_history() {
        std::env::set_var("VAPORLENSDB_USE_DEV_KEY", "1");
        let dir = std::env::temp_dir().join(format!("vaporlensdb-history-test-{}", Uuid::new_v4()));
        let store = ConfigStore::new(dir).expect("create config store");
        let connection_id = Uuid::new_v4();

        let entry = QueryHistoryEntry {
            id: Uuid::new_v4(),
            connection_id,
            connection_name_snapshot: "Local PG".to_string(),
            driver_type: DriverType::Postgres,
            database: Some("penguin_farm".to_string()),
            schema: Some("public".to_string()),
            sql: "SELECT 1".to_string(),
            status: QueryHistoryStatus::Success,
            started_at: Utc::now(),
            elapsed_ms: Some(12),
            row_count: Some(1),
            affected_rows: None,
            error_code: None,
            error_message: None,
        };

        store.add_query_history(entry).expect("save query history");

        let history = store.list_query_history(200).expect("list query history");
        assert_eq!(history.len(), 1);
        assert_eq!(history[0].connection_id, connection_id);
        assert_eq!(history[0].sql, "SELECT 1");
        assert_eq!(history[0].row_count, Some(1));

        store.clear_query_history().expect("clear query history");
        assert!(store
            .list_query_history(200)
            .expect("list cleared query history")
            .is_empty());
    }

    #[test]
    fn prunes_query_history_to_five_thousand_entries() {
        std::env::set_var("VAPORLENSDB_USE_DEV_KEY", "1");
        let dir =
            std::env::temp_dir().join(format!("vaporlensdb-history-prune-test-{}", Uuid::new_v4()));
        let store = ConfigStore::new(dir).expect("create config store");
        let connection_id = Uuid::new_v4();

        for index in 0..5_005 {
            store
                .add_query_history(QueryHistoryEntry {
                    id: Uuid::new_v4(),
                    connection_id,
                    connection_name_snapshot: "Local PG".to_string(),
                    driver_type: DriverType::Postgres,
                    database: Some("penguin_farm".to_string()),
                    schema: None,
                    sql: format!("SELECT {index}"),
                    status: QueryHistoryStatus::Success,
                    started_at: Utc::now() + chrono::Duration::milliseconds(index),
                    elapsed_ms: Some(index as u64),
                    row_count: Some(1),
                    affected_rows: None,
                    error_code: None,
                    error_message: None,
                })
                .expect("save query history");
        }

        let history = store
            .list_query_history(5_000)
            .expect("list pruned query history");
        assert_eq!(history.len(), 5_000);
        assert_eq!(history[0].sql, "SELECT 5004");
        assert_eq!(
            history.last().map(|entry| entry.sql.as_str()),
            Some("SELECT 5")
        );
    }
}
