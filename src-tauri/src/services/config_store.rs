use std::{
    path::{Path, PathBuf},
    str::FromStr,
};

use chrono::{DateTime, NaiveDateTime, Utc};
use rusqlite::{params, Connection, OptionalExtension, Row};
use uuid::Uuid;

use crate::{
    models::{
        connection::{ConnectionConfig, DriverType, SshTunnelConfig},
        data_source_group::DataSourceGroup,
        driver_catalog::{
            DriverBackend, DriverConnectionVariant, DriverDefinition, DriverDefinitionCapabilities,
            DriverStatus,
        },
        error::AppError,
        query_history::{QueryHistoryEntry, QueryHistoryStatus},
        sql_draft::SqlDraft,
    },
    services::driver_catalog,
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
    ConfigMigration {
        version: 4,
        name: "create driver definition store",
        apply: create_driver_definition_store,
    },
    ConfigMigration {
        version: 5,
        name: "add driver definition runtime type",
        apply: add_driver_definition_runtime_type,
    },
    ConfigMigration {
        version: 6,
        name: "add connection driver definition reference",
        apply: add_connection_driver_definition_reference,
    },
    ConfigMigration {
        version: 7,
        name: "add managed external driver definition fields",
        apply: add_managed_external_driver_definition_fields,
    },
    ConfigMigration {
        version: 8,
        name: "add ssh tunnel connection fields",
        apply: add_ssh_tunnel_connection_fields,
    },
    ConfigMigration {
        version: 9,
        name: "rebuild driver template model",
        apply: rebuild_driver_template_model,
    },
    ConfigMigration {
        version: 10,
        name: "create sql draft store",
        apply: create_sql_draft_store,
    },
    ConfigMigration {
        version: 11,
        name: "migrate legacy connection groups to data source groups",
        apply: migrate_data_source_groups,
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
        store.seed_builtin_driver_definitions()?;
        Ok(store)
    }

    pub fn config_dir(&self) -> &Path {
        &self.config_dir
    }

    pub fn db_path(&self) -> &Path {
        &self.db_path
    }

    pub fn applied_schema_version(&self) -> Result<i64, AppError> {
        self.conn()?
            .query_row("SELECT MAX(version) FROM schema_migrations", [], |row| {
                row.get::<_, Option<i64>>(0)
            })
            .map(|version| version.unwrap_or(0))
            .map_err(AppError::from)
    }

    pub fn create_connection(
        &self,
        mut config: ConnectionConfig,
        password: Option<String>,
        save_password: bool,
    ) -> Result<ConnectionConfig, AppError> {
        self.resolve_group_reference(&mut config)?;
        let now = Utc::now();
        config.created_at = now;
        config.updated_at = now;
        config.password_encrypted = save_password
            .then_some(password)
            .flatten()
            .as_deref()
            .filter(|value| !value.is_empty())
            .map(|value| crypto::encrypt_password(&self.config_dir, value))
            .transpose()?;
        config.has_saved_password = config.password_encrypted.is_some();
        encrypt_ssh_tunnel_secrets(&self.config_dir, &mut config, None)?;

        self.conn()?.execute(
            "
            INSERT INTO connections (
                id, name, driver_definition_id, driver_type, driver_dialect, host, port, database_name, connection_url, username,
                password_encrypted, driver_class, driver_paths, ssl_mode, group_id, group_name, color_tag,
                ssh_tunnel_json, ssh_password_encrypted, ssh_private_key_passphrase_encrypted,
                created_at, updated_at
            )
            VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18, ?19, ?20, ?21, ?22)
            ",
            params_from_config(&config),
        )?;

        Ok(config)
    }

    pub fn update_connection(
        &self,
        mut config: ConnectionConfig,
        password: Option<String>,
        save_password: bool,
    ) -> Result<ConnectionConfig, AppError> {
        let existing = self
            .get_connection(config.id)?
            .ok_or_else(|| AppError::NotFound {
                resource: "connection".to_string(),
                id: config.id.to_string(),
            })?;

        self.resolve_group_reference(&mut config)?;
        config.created_at = existing.created_at;
        config.updated_at = Utc::now();
        config.password_encrypted = if !save_password {
            None
        } else {
            match password {
                Some(password) if !password.is_empty() => {
                    Some(crypto::encrypt_password(&self.config_dir, &password)?)
                }
                _ => existing.password_encrypted,
            }
        };
        config.has_saved_password = config.password_encrypted.is_some();
        encrypt_ssh_tunnel_secrets(&self.config_dir, &mut config, existing.ssh_tunnel.as_ref())?;

        self.conn()?.execute(
            "
            UPDATE connections
            SET name = ?2,
                driver_definition_id = ?3,
                driver_type = ?4,
                driver_dialect = ?5,
                host = ?6,
                port = ?7,
                database_name = ?8,
                connection_url = ?9,
                username = ?10,
                password_encrypted = ?11,
                driver_class = ?12,
                driver_paths = ?13,
                ssl_mode = ?14,
                group_id = ?15,
                group_name = ?16,
                color_tag = ?17,
                ssh_tunnel_json = ?18,
                ssh_password_encrypted = ?19,
                ssh_private_key_passphrase_encrypted = ?20,
                created_at = ?21,
                updated_at = ?22
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
            SELECT id, name, driver_definition_id, driver_type, driver_dialect, host, port, database_name, connection_url, username,
                   password_encrypted, driver_class, driver_paths, ssl_mode, group_id, group_name,
                   color_tag, ssh_tunnel_json, ssh_password_encrypted,
                   ssh_private_key_passphrase_encrypted, created_at, updated_at
            FROM connections
            WHERE driver_type <> 'odbc'
            ORDER BY group_name IS NOT NULL, group_name, name
            ",
        )?;

        let rows = statement.query_map([], row_to_connection)?;
        rows.collect::<Result<Vec<_>, _>>()
            .map_err(|error| AppError::ConfigError(format!("list connections: {error}")))
    }

    pub fn get_connection(&self, id: Uuid) -> Result<Option<ConnectionConfig>, AppError> {
        self.conn()?
            .query_row(
                "
            SELECT id, name, driver_definition_id, driver_type, driver_dialect, host, port, database_name, connection_url, username,
                   password_encrypted, driver_class, driver_paths, ssl_mode, group_id, group_name,
                   color_tag, ssh_tunnel_json, ssh_password_encrypted,
                   ssh_private_key_passphrase_encrypted, created_at, updated_at
                FROM connections
                WHERE id = ?1
                  AND driver_type <> 'odbc'
                ",
                params![id.to_string()],
                row_to_connection,
            )
            .optional()
            .map_err(AppError::from)
    }

    pub fn list_data_source_groups(&self) -> Result<Vec<DataSourceGroup>, AppError> {
        let conn = self.conn()?;
        let mut statement = conn.prepare(
            "SELECT id, name, sort_order, created_at, updated_at FROM data_source_groups ORDER BY sort_order, name COLLATE NOCASE",
        )?;
        let groups = statement
            .query_map([], row_to_data_source_group)?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|error| AppError::ConfigError(format!("list data source groups: {error}")))?;
        Ok(groups)
    }

    pub fn create_data_source_group(&self, name: String) -> Result<DataSourceGroup, AppError> {
        let name = normalize_group_name(&name)?;
        let now = Utc::now();
        let group = DataSourceGroup {
            id: Uuid::new_v4(),
            name,
            sort_order: self.next_group_sort_order()?,
            created_at: now,
            updated_at: now,
        };
        self.conn()?.execute(
            "INSERT INTO data_source_groups (id, name, sort_order, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5)",
            params![group.id.to_string(), group.name, group.sort_order, group.created_at.to_rfc3339(), group.updated_at.to_rfc3339()],
        )?;
        Ok(group)
    }

    pub fn rename_data_source_group(
        &self,
        id: Uuid,
        name: String,
    ) -> Result<DataSourceGroup, AppError> {
        let name = normalize_group_name(&name)?;
        let existing = self
            .get_data_source_group(id)?
            .ok_or_else(|| AppError::NotFound {
                resource: "data source group".to_string(),
                id: id.to_string(),
            })?;
        let updated_at = Utc::now();
        let conn = self.conn()?;
        let transaction = conn.unchecked_transaction()?;
        transaction.execute(
            "UPDATE data_source_groups SET name = ?2, updated_at = ?3 WHERE id = ?1",
            params![id.to_string(), name, updated_at.to_rfc3339()],
        )?;
        transaction.execute(
            "UPDATE connections SET group_name = ?2, updated_at = ?3 WHERE group_id = ?1",
            params![id.to_string(), name, updated_at.to_rfc3339()],
        )?;
        transaction.commit()?;
        Ok(DataSourceGroup {
            name,
            updated_at,
            ..existing
        })
    }

    pub fn delete_data_source_group(&self, id: Uuid) -> Result<(), AppError> {
        let conn = self.conn()?;
        let transaction = conn.unchecked_transaction()?;
        let affected = transaction.execute(
            "UPDATE connections SET group_id = NULL, group_name = NULL, updated_at = ?2 WHERE group_id = ?1",
            params![id.to_string(), Utc::now().to_rfc3339()],
        )?;
        let deleted = transaction.execute(
            "DELETE FROM data_source_groups WHERE id = ?1",
            params![id.to_string()],
        )?;
        if deleted == 0 {
            return Err(AppError::NotFound {
                resource: "data source group".to_string(),
                id: id.to_string(),
            });
        }
        let _ = affected;
        transaction.commit()?;
        Ok(())
    }

    pub fn reorder_data_source_groups(
        &self,
        ids: Vec<Uuid>,
    ) -> Result<Vec<DataSourceGroup>, AppError> {
        let existing = self.list_data_source_groups()?;
        if ids.len() != existing.len()
            || ids.iter().collect::<std::collections::HashSet<_>>().len() != ids.len()
            || ids
                .iter()
                .any(|id| !existing.iter().any(|group| group.id == *id))
        {
            return Err(AppError::ConfigError(
                "Data Source Group order must contain every group exactly once".to_string(),
            ));
        }
        let conn = self.conn()?;
        let transaction = conn.unchecked_transaction()?;
        let now = Utc::now().to_rfc3339();
        for (index, id) in ids.iter().enumerate() {
            transaction.execute(
                "UPDATE data_source_groups SET sort_order = ?2, updated_at = ?3 WHERE id = ?1",
                params![id.to_string(), (index as i64 + 1) * 100, now],
            )?;
        }
        transaction.commit()?;
        self.list_data_source_groups()
    }

    pub fn set_connection_group(
        &self,
        connection_id: Uuid,
        group_id: Option<Uuid>,
    ) -> Result<(), AppError> {
        let group = group_id
            .map(|id| self.get_data_source_group(id))
            .transpose()?
            .flatten();
        if group.is_none() {
            if let Some(group_id) = group_id {
                return Err(AppError::NotFound {
                    resource: "data source group".to_string(),
                    id: group_id.to_string(),
                });
            }
        }
        let affected = self.conn()?.execute(
            "UPDATE connections SET group_id = ?2, group_name = ?3, updated_at = ?4 WHERE id = ?1",
            params![
                connection_id.to_string(),
                group_id.map(|id| id.to_string()),
                group.map(|item| item.name),
                Utc::now().to_rfc3339()
            ],
        )?;
        if affected == 0 {
            return Err(AppError::NotFound {
                resource: "connection".to_string(),
                id: connection_id.to_string(),
            });
        }
        Ok(())
    }

    fn get_data_source_group(&self, id: Uuid) -> Result<Option<DataSourceGroup>, AppError> {
        self.conn()?.query_row(
            "SELECT id, name, sort_order, created_at, updated_at FROM data_source_groups WHERE id = ?1",
            params![id.to_string()],
            row_to_data_source_group,
        ).optional().map_err(AppError::from)
    }

    fn next_group_sort_order(&self) -> Result<i64, AppError> {
        self.conn()?
            .query_row(
                "SELECT COALESCE(MAX(sort_order), 0) + 100 FROM data_source_groups",
                [],
                |row| row.get(0),
            )
            .map_err(AppError::from)
    }

    fn resolve_group_reference(&self, config: &mut ConnectionConfig) -> Result<(), AppError> {
        if let Some(group_id) = config.group_id {
            let group =
                self.get_data_source_group(group_id)?
                    .ok_or_else(|| AppError::NotFound {
                        resource: "data source group".to_string(),
                        id: group_id.to_string(),
                    })?;
            config.group = Some(group.name);
            return Ok(());
        }
        let Some(name) = config
            .group
            .as_deref()
            .map(str::trim)
            .filter(|value| !value.is_empty())
        else {
            config.group = None;
            return Ok(());
        };
        let name = normalize_group_name(name)?;
        let existing = self.conn()?.query_row(
            "SELECT id, name, sort_order, created_at, updated_at FROM data_source_groups WHERE name = ? COLLATE NOCASE",
            params![name], row_to_data_source_group,
        ).optional()?;
        let group = match existing {
            Some(group) => group,
            None => self.create_data_source_group(name)?,
        };
        config.group_id = Some(group.id);
        config.group = Some(group.name);
        Ok(())
    }

    pub fn decrypt_password(&self, config: &ConnectionConfig) -> Result<Option<String>, AppError> {
        config
            .password_encrypted
            .as_deref()
            .map(|value| crypto::decrypt_password(&self.config_dir, value))
            .transpose()
    }

    pub fn decrypt_ssh_tunnel(
        &self,
        config: &ConnectionConfig,
    ) -> Result<Option<SshTunnelConfig>, AppError> {
        let Some(mut tunnel) = config.ssh_tunnel.clone() else {
            return Ok(None);
        };
        tunnel.password_encrypted = tunnel
            .password_encrypted
            .as_deref()
            .map(|value| crypto::decrypt_password(&self.config_dir, value))
            .transpose()?;
        tunnel.private_key_passphrase_encrypted = tunnel
            .private_key_passphrase_encrypted
            .as_deref()
            .map(|value| crypto::decrypt_password(&self.config_dir, value))
            .transpose()?;
        Ok(Some(tunnel))
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

    pub fn upsert_sql_draft(&self, draft: SqlDraft) -> Result<SqlDraft, AppError> {
        if draft.sql.trim().is_empty() {
            if self.get_sql_draft(draft.id)?.is_some() {
                self.delete_sql_draft(draft.id)?;
            }
            return Ok(draft);
        }

        self.conn()?.execute(
            "
            INSERT INTO sql_drafts (
                id, connection_id, connection_name_snapshot, database_name, schema_name, title,
                sql, created_at, updated_at, last_opened_at, closed_at
            )
            VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)
            ON CONFLICT(id) DO UPDATE SET
                connection_id = excluded.connection_id,
                connection_name_snapshot = excluded.connection_name_snapshot,
                database_name = excluded.database_name,
                schema_name = excluded.schema_name,
                title = excluded.title,
                sql = excluded.sql,
                updated_at = excluded.updated_at,
                last_opened_at = excluded.last_opened_at,
                closed_at = excluded.closed_at
            ",
            params![
                draft.id.to_string(),
                draft.connection_id.map(|id| id.to_string()),
                &draft.connection_name_snapshot,
                &draft.database,
                &draft.schema,
                &draft.title,
                &draft.sql,
                draft.created_at.to_rfc3339(),
                draft.updated_at.to_rfc3339(),
                draft.last_opened_at.map(|value| value.to_rfc3339()),
                draft.closed_at.map(|value| value.to_rfc3339()),
            ],
        )?;
        self.prune_sql_drafts(50)?;
        Ok(draft)
    }

    pub fn get_sql_draft(&self, id: Uuid) -> Result<Option<SqlDraft>, AppError> {
        self.conn()?
            .query_row(
                "
                SELECT id, connection_id, connection_name_snapshot, database_name, schema_name,
                       title, sql, created_at, updated_at, last_opened_at, closed_at
                FROM sql_drafts
                WHERE id = ?1
                ",
                params![id.to_string()],
                row_to_sql_draft,
            )
            .optional()
            .map_err(AppError::from)
    }

    pub fn list_sql_drafts(&self, limit: u32) -> Result<Vec<SqlDraft>, AppError> {
        let limit = limit.clamp(1, 50);
        let conn = self.conn()?;
        let mut statement = conn.prepare(
            "
            SELECT id, connection_id, connection_name_snapshot, database_name, schema_name,
                   title, sql, created_at, updated_at, last_opened_at, closed_at
            FROM sql_drafts
            WHERE trim(sql) <> ''
            ORDER BY updated_at DESC
            LIMIT ?1
            ",
        )?;

        let rows = statement.query_map(params![limit], row_to_sql_draft)?;
        rows.collect::<Result<Vec<_>, _>>().map_err(AppError::from)
    }

    pub fn mark_sql_draft_closed(&self, id: Uuid) -> Result<(), AppError> {
        self.conn()?.execute(
            "
            UPDATE sql_drafts
            SET closed_at = ?2,
                updated_at = ?2
            WHERE id = ?1
            ",
            params![id.to_string(), Utc::now().to_rfc3339()],
        )?;
        Ok(())
    }

    pub fn delete_sql_draft(&self, id: Uuid) -> Result<(), AppError> {
        self.conn()?.execute(
            "DELETE FROM sql_drafts WHERE id = ?1",
            params![id.to_string()],
        )?;
        Ok(())
    }

    pub fn clear_sql_drafts(&self) -> Result<(), AppError> {
        self.conn()?.execute("DELETE FROM sql_drafts", [])?;
        Ok(())
    }

    pub fn list_driver_definitions(&self) -> Result<Vec<DriverDefinition>, AppError> {
        let conn = self.conn()?;
        let mut statement = conn.prepare(
            "
            SELECT id, driver_type, driver_dialect, name, backend, status, default_port, default_username,
                   default_database, jdbc_driver_class, url_template, driver_artifact,
                   driver_artifacts_json, user_driver_required, built_in,
                   download_url, notes, connection_variants_json, metadata_dialect_sql, capabilities_json
            FROM driver_definitions
            WHERE driver_type <> 'odbc'
              AND driver_type NOT IN ('mongo', 'redis')
              AND backend <> 'odbc'
              AND status <> 'planned'
            ORDER BY built_in DESC,
                     CASE status
                       WHEN 'ready' THEN 0
                       WHEN 'configurable' THEN 1
                       ELSE 2
                     END,
                     name
            ",
        )?;

        let rows = statement.query_map([], row_to_driver_definition)?;
        rows.collect::<Result<Vec<_>, _>>().map_err(AppError::from)
    }

    pub fn get_driver_definition(&self, id: &str) -> Result<Option<DriverDefinition>, AppError> {
        self.conn()?
            .query_row(
                "
                SELECT id, driver_type, driver_dialect, name, backend, status, default_port, default_username,
                       default_database, jdbc_driver_class, url_template, driver_artifact,
                       driver_artifacts_json, user_driver_required, built_in,
                       download_url, notes, connection_variants_json, metadata_dialect_sql, capabilities_json
                FROM driver_definitions
                WHERE id = ?1
                  AND driver_type <> 'odbc'
                  AND driver_type NOT IN ('mongo', 'redis')
                  AND backend <> 'odbc'
                  AND status <> 'planned'
                ",
                params![id],
                row_to_driver_definition,
            )
            .optional()
            .map_err(AppError::from)
    }

    pub fn save_custom_driver_definition(
        &self,
        mut definition: DriverDefinition,
    ) -> Result<DriverDefinition, AppError> {
        validate_custom_driver_definition(&definition)?;
        definition.id = definition.id.trim().to_string();
        if definition.id.is_empty() {
            definition.id = format!("custom-{}", Uuid::new_v4());
        }
        definition.built_in = false;

        let conn = self.conn()?;
        if is_builtin_driver_definition(&conn, &definition.id)? {
            return Err(AppError::ConfigError(format!(
                "built-in driver definition cannot be overwritten: {}",
                definition.id
            )));
        }
        upsert_driver_definition(&conn, &definition)?;
        Ok(definition)
    }

    pub fn delete_custom_driver_definition(&self, id: &str) -> Result<(), AppError> {
        let affected = self.conn()?.execute(
            "
            DELETE FROM driver_definitions
            WHERE id = ?1
              AND built_in = 0
            ",
            params![id],
        )?;
        if affected == 0 {
            return Err(AppError::NotFound {
                resource: "custom driver definition".to_string(),
                id: id.to_string(),
            });
        }
        Ok(())
    }

    pub fn update_driver_definition_artifacts(
        &self,
        id: &str,
        driver_artifacts: Vec<String>,
        driver_artifact: Option<String>,
    ) -> Result<DriverDefinition, AppError> {
        let driver_artifacts_json = serde_json::to_string(&driver_artifacts)?;
        let conn = self.conn()?;
        let affected = conn.execute(
            "
            UPDATE driver_definitions
            SET driver_artifacts_json = ?2,
                driver_artifact = ?3,
                updated_at = datetime('now')
            WHERE id = ?1
            ",
            params![id, driver_artifacts_json, driver_artifact],
        )?;
        if affected == 0 {
            return Err(AppError::NotFound {
                resource: "driver definition".to_string(),
                id: id.to_string(),
            });
        }
        self.get_driver_definition(id)?
            .ok_or_else(|| AppError::NotFound {
                resource: "driver definition".to_string(),
                id: id.to_string(),
            })
    }

    fn init(&self) -> Result<(), AppError> {
        let conn = self.conn()?;
        run_config_migrations(&conn)
    }

    fn seed_builtin_driver_definitions(&self) -> Result<(), AppError> {
        let conn = self.conn()?;
        for mut definition in driver_catalog::driver_definitions() {
            if let Some(existing) = self.get_driver_definition(&definition.id)? {
                if existing.built_in && !existing.driver_artifacts.is_empty() {
                    definition.driver_artifacts = existing.driver_artifacts;
                    definition.driver_artifact = existing.driver_artifact;
                }
            }
            upsert_builtin_driver_definition(&conn, &definition)?;
        }
        Ok(())
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

    fn prune_sql_drafts(&self, max_entries: u32) -> Result<(), AppError> {
        self.conn()?.execute(
            "
            DELETE FROM sql_drafts
            WHERE id NOT IN (
                SELECT id
                FROM sql_drafts
                WHERE trim(sql) <> ''
                ORDER BY updated_at DESC
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

fn create_sql_draft_store(conn: &Connection) -> Result<(), AppError> {
    conn.execute_batch(
        "
        CREATE TABLE IF NOT EXISTS sql_drafts (
            id TEXT PRIMARY KEY,
            connection_id TEXT,
            connection_name_snapshot TEXT,
            database_name TEXT,
            schema_name TEXT,
            title TEXT NOT NULL,
            sql TEXT NOT NULL,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            last_opened_at TEXT,
            closed_at TEXT
        );

        CREATE INDEX IF NOT EXISTS idx_sql_drafts_updated_at
        ON sql_drafts(updated_at DESC);
        ",
    )
    .map_err(AppError::from)
}

fn migrate_data_source_groups(conn: &Connection) -> Result<(), AppError> {
    conn.execute_batch(
        "
        CREATE TABLE IF NOT EXISTS data_source_groups (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL COLLATE NOCASE UNIQUE,
            sort_order INTEGER NOT NULL DEFAULT 0,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_data_source_groups_order
        ON data_source_groups(sort_order, name);
        ",
    )?;
    ensure_column(conn, "connections", "group_id", "TEXT")?;

    let mut statement = conn.prepare(
        "SELECT DISTINCT trim(group_name) FROM connections WHERE group_name IS NOT NULL AND trim(group_name) <> '' ORDER BY group_name COLLATE NOCASE",
    )?;
    let legacy_names = statement
        .query_map([], |row| row.get::<_, String>(0))?
        .collect::<Result<Vec<_>, _>>()?;
    for (index, name) in legacy_names.into_iter().enumerate() {
        let existing: Option<String> = conn
            .query_row(
                "SELECT id FROM data_source_groups WHERE name = ?1 COLLATE NOCASE",
                params![name],
                |row| row.get(0),
            )
            .optional()?;
        let id = existing.unwrap_or_else(|| Uuid::new_v4().to_string());
        conn.execute(
            "INSERT OR IGNORE INTO data_source_groups (id, name, sort_order, created_at, updated_at) VALUES (?1, ?2, ?3, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))",
            params![id, name, (index as i64 + 1) * 100],
        )?;
    }
    conn.execute(
        "UPDATE connections SET group_id = (SELECT id FROM data_source_groups WHERE data_source_groups.name = connections.group_name COLLATE NOCASE) WHERE group_id IS NULL AND group_name IS NOT NULL AND trim(group_name) <> ''",
        [],
    )?;
    Ok(())
}

fn create_driver_definition_store(conn: &Connection) -> Result<(), AppError> {
    conn.execute_batch(
        "
        CREATE TABLE IF NOT EXISTS driver_definitions (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            driver_dialect TEXT,
            backend TEXT NOT NULL,
            status TEXT NOT NULL,
            default_port INTEGER,
            default_username TEXT,
            default_database TEXT,
            jdbc_driver_class TEXT,
            url_template TEXT,
            driver_artifact TEXT,
            driver_artifacts_json TEXT NOT NULL DEFAULT '[]',
            odbc_driver_name TEXT,
            user_driver_required INTEGER NOT NULL DEFAULT 0,
            built_in INTEGER NOT NULL DEFAULT 0,
            download_url TEXT,
            notes TEXT,
            connection_variants_json TEXT NOT NULL,
            metadata_dialect_sql TEXT,
            capabilities_json TEXT NOT NULL,
            updated_at TEXT NOT NULL
        );

        CREATE INDEX IF NOT EXISTS idx_driver_definitions_status
        ON driver_definitions(status, name);
        ",
    )
    .map_err(AppError::from)
}

fn upsert_builtin_driver_definition(
    conn: &Connection,
    definition: &DriverDefinition,
) -> Result<(), AppError> {
    upsert_driver_definition(conn, definition)
}

fn upsert_driver_definition(
    conn: &Connection,
    definition: &DriverDefinition,
) -> Result<(), AppError> {
    let connection_variants = serde_json::to_string(&definition.connection_variants)?;
    let capabilities = serde_json::to_string(&definition.capabilities)?;
    let driver_artifacts = serde_json::to_string(&definition.driver_artifacts)?;

    conn.execute(
        "
        INSERT INTO driver_definitions (
            id, driver_type, driver_dialect, name, backend, status, default_port, default_username, default_database,
            jdbc_driver_class, url_template, driver_artifact, driver_artifacts_json,
            user_driver_required, built_in, download_url,
            notes, connection_variants_json, metadata_dialect_sql, capabilities_json, updated_at
        )
        VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18, ?19, ?20, datetime('now'))
        ON CONFLICT(id) DO UPDATE SET
            driver_type = excluded.driver_type,
            driver_dialect = excluded.driver_dialect,
            name = excluded.name,
            backend = excluded.backend,
            status = excluded.status,
            default_port = excluded.default_port,
            default_username = excluded.default_username,
            default_database = excluded.default_database,
            jdbc_driver_class = excluded.jdbc_driver_class,
            url_template = excluded.url_template,
            driver_artifact = excluded.driver_artifact,
            driver_artifacts_json = excluded.driver_artifacts_json,
            user_driver_required = excluded.user_driver_required,
            built_in = excluded.built_in,
            download_url = excluded.download_url,
            notes = excluded.notes,
            connection_variants_json = excluded.connection_variants_json,
            metadata_dialect_sql = excluded.metadata_dialect_sql,
            capabilities_json = excluded.capabilities_json,
            updated_at = datetime('now')
        WHERE driver_definitions.built_in = excluded.built_in
        ",
        params![
            &definition.id,
            definition.driver_type.to_string(),
            &definition.driver_dialect,
            &definition.name,
            definition.backend.to_string(),
            definition.status.to_string(),
            definition.default_port.map(i64::from),
            &definition.default_username,
            &definition.default_database,
            &definition.jdbc_driver_class,
            &definition.url_template,
            &definition.driver_artifact,
            driver_artifacts,
            definition.user_driver_required as i64,
            definition.built_in as i64,
            &definition.download_url,
            &definition.notes,
            connection_variants,
            &definition.metadata_dialect_sql,
            capabilities,
        ],
    )?;

    Ok(())
}

fn add_driver_definition_runtime_type(conn: &Connection) -> Result<(), AppError> {
    ensure_column(conn, "driver_definitions", "driver_type", "TEXT")?;
    conn.execute(
        "
        UPDATE driver_definitions
        SET driver_type = id
        WHERE driver_type IS NULL
           OR driver_type = ''
        ",
        [],
    )?;
    Ok(())
}

fn add_connection_driver_definition_reference(conn: &Connection) -> Result<(), AppError> {
    ensure_column(conn, "connections", "driver_definition_id", "TEXT")?;
    conn.execute(
        "
        UPDATE connections
        SET driver_definition_id = driver_type
        WHERE driver_definition_id IS NULL
           OR driver_definition_id = ''
        ",
        [],
    )?;
    Ok(())
}

fn add_managed_external_driver_definition_fields(conn: &Connection) -> Result<(), AppError> {
    ensure_column(
        conn,
        "driver_definitions",
        "driver_artifacts_json",
        "TEXT NOT NULL DEFAULT '[]'",
    )?;
    ensure_column(conn, "driver_definitions", "odbc_driver_name", "TEXT")?;
    Ok(())
}

fn add_ssh_tunnel_connection_fields(conn: &Connection) -> Result<(), AppError> {
    ensure_column(conn, "connections", "ssh_tunnel_json", "TEXT")?;
    ensure_column(conn, "connections", "ssh_password_encrypted", "TEXT")?;
    ensure_column(
        conn,
        "connections",
        "ssh_private_key_passphrase_encrypted",
        "TEXT",
    )?;
    Ok(())
}

fn rebuild_driver_template_model(conn: &Connection) -> Result<(), AppError> {
    ensure_column(conn, "connections", "driver_dialect", "TEXT")?;
    ensure_column(conn, "driver_definitions", "driver_dialect", "TEXT")?;
    ensure_column(conn, "driver_definitions", "download_url", "TEXT")?;

    conn.execute("DELETE FROM connections", [])?;
    conn.execute("DELETE FROM driver_definitions", [])?;
    conn.execute("DELETE FROM query_history", [])?;
    Ok(())
}

fn is_builtin_driver_definition(conn: &Connection, id: &str) -> Result<bool, AppError> {
    conn.query_row(
        "
        SELECT built_in
        FROM driver_definitions
        WHERE id = ?1
        ",
        params![id],
        |row| row.get::<_, i64>(0),
    )
    .optional()
    .map(|value| value.unwrap_or(0) != 0)
    .map_err(AppError::from)
}

fn validate_custom_driver_definition(definition: &DriverDefinition) -> Result<(), AppError> {
    if definition.name.trim().is_empty() {
        return Err(AppError::ConfigError(
            "driver definition name is required".to_string(),
        ));
    }
    if !matches!(definition.driver_type, DriverType::Jdbc) {
        return Err(AppError::ConfigError(
            "custom driver definitions currently support only JDBC".to_string(),
        ));
    }
    if definition.connection_variants.is_empty() {
        return Err(AppError::ConfigError(
            "at least one connection variant is required".to_string(),
        ));
    }
    Ok(())
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

fn encrypt_ssh_tunnel_secrets(
    config_dir: &Path,
    config: &mut ConnectionConfig,
    existing: Option<&SshTunnelConfig>,
) -> Result<(), AppError> {
    if let Some(tunnel) = config.ssh_tunnel.as_mut() {
        tunnel.password_encrypted = match tunnel.password_encrypted.take() {
            Some(password) if !password.is_empty() => {
                Some(crypto::encrypt_password(config_dir, &password)?)
            }
            _ => existing.and_then(|value| value.password_encrypted.clone()),
        };
        tunnel.private_key_passphrase_encrypted =
            match tunnel.private_key_passphrase_encrypted.take() {
                Some(passphrase) if !passphrase.is_empty() => {
                    Some(crypto::encrypt_password(config_dir, &passphrase)?)
                }
                _ => existing.and_then(|value| value.private_key_passphrase_encrypted.clone()),
            };
    }
    Ok(())
}

fn params_from_config(config: &ConnectionConfig) -> [Box<dyn rusqlite::ToSql>; 22] {
    let driver_paths = serde_json::to_string(&config.driver_paths).unwrap_or_default();
    let ssh_tunnel_json = config
        .ssh_tunnel
        .as_ref()
        .map(serde_json::to_string)
        .transpose()
        .unwrap_or_default();
    let ssh_password_encrypted = config
        .ssh_tunnel
        .as_ref()
        .and_then(|tunnel| tunnel.password_encrypted.clone());
    let ssh_private_key_passphrase_encrypted = config
        .ssh_tunnel
        .as_ref()
        .and_then(|tunnel| tunnel.private_key_passphrase_encrypted.clone());

    [
        Box::new(config.id.to_string()),
        Box::new(config.name.clone()),
        Box::new(config.driver_definition_id.clone()),
        Box::new(config.driver_type.to_string()),
        Box::new(config.driver_dialect.clone()),
        Box::new(config.host.clone()),
        Box::new(config.port.map(i64::from)),
        Box::new(config.database.clone()),
        Box::new(config.connection_url.clone()),
        Box::new(config.username.clone()),
        Box::new(config.password_encrypted.clone()),
        Box::new(config.driver_class.clone()),
        Box::new(driver_paths),
        Box::new(config.ssl_mode.clone()),
        Box::new(config.group_id.map(|id| id.to_string())),
        Box::new(config.group.clone()),
        Box::new(config.color_tag.clone()),
        Box::new(ssh_tunnel_json),
        Box::new(ssh_password_encrypted),
        Box::new(ssh_private_key_passphrase_encrypted),
        Box::new(config.created_at.to_rfc3339()),
        Box::new(config.updated_at.to_rfc3339()),
    ]
}

fn row_to_connection(row: &Row<'_>) -> Result<ConnectionConfig, rusqlite::Error> {
    let id: String = row.get(0)?;
    let driver_type: String = row.get(3)?;
    let created_at: String = row.get(20)?;
    let updated_at: String = row.get(21)?;
    let port: Option<i64> = row.get(6)?;
    let driver_paths: Option<String> = row.get(12)?;
    let ssh_tunnel_json: Option<String> = row.get(17)?;
    let mut ssh_tunnel = ssh_tunnel_json
        .as_deref()
        .and_then(|value| serde_json::from_str::<SshTunnelConfig>(value).ok());
    if let Some(tunnel) = ssh_tunnel.as_mut() {
        tunnel.password_encrypted = row.get(18)?;
        tunnel.private_key_passphrase_encrypted = row.get(19)?;
    }

    Ok(ConnectionConfig {
        id: Uuid::parse_str(&id).map_err(parse_error)?,
        name: row.get(1)?,
        driver_definition_id: row.get(2)?,
        driver_type: DriverType::from_str(&driver_type).map_err(parse_error)?,
        driver_dialect: row.get(4)?,
        host: row.get(5)?,
        port: port.map(|value| value as u16),
        database: row.get(7)?,
        connection_url: row.get(8)?,
        username: row.get(9)?,
        password_encrypted: row.get(10)?,
        has_saved_password: row.get::<_, Option<String>>(10)?.is_some(),
        driver_class: row.get(11)?,
        driver_paths: driver_paths
            .as_deref()
            .and_then(|value| serde_json::from_str(value).ok())
            .unwrap_or_default(),
        ssl_mode: row.get(13)?,
        group_id: row
            .get::<_, Option<String>>(14)?
            .as_deref()
            .map(Uuid::parse_str)
            .transpose()
            .map_err(parse_error)?,
        group: row.get(15)?,
        color_tag: row.get(16)?,
        ssh_tunnel,
        created_at: DateTime::parse_from_rfc3339(&created_at)
            .map_err(parse_error)?
            .with_timezone(&Utc),
        updated_at: DateTime::parse_from_rfc3339(&updated_at)
            .map_err(parse_error)?
            .with_timezone(&Utc),
    })
}

fn row_to_data_source_group(row: &Row<'_>) -> Result<DataSourceGroup, rusqlite::Error> {
    let id: String = row.get(0)?;
    let created_at: String = row.get(3)?;
    let updated_at: String = row.get(4)?;
    Ok(DataSourceGroup {
        id: Uuid::parse_str(&id).map_err(parse_error)?,
        name: row.get(1)?,
        sort_order: row.get(2)?,
        created_at: parse_data_source_group_timestamp(&created_at)
            .map_err(|error| data_source_group_timestamp_error(3, &created_at, error))?,
        updated_at: parse_data_source_group_timestamp(&updated_at)
            .map_err(|error| data_source_group_timestamp_error(4, &updated_at, error))?,
    })
}

fn parse_data_source_group_timestamp(value: &str) -> Result<DateTime<Utc>, String> {
    if let Ok(timestamp) = DateTime::parse_from_rfc3339(value) {
        return Ok(timestamp.with_timezone(&Utc));
    }

    NaiveDateTime::parse_from_str(value, "%Y-%m-%d %H:%M:%S")
        .map(|timestamp| timestamp.and_utc())
        .map_err(|_| "expected RFC 3339 or legacy SQLite datetime".to_string())
}

fn data_source_group_timestamp_error(column: usize, value: &str, error: String) -> rusqlite::Error {
    rusqlite::Error::FromSqlConversionFailure(
        column,
        rusqlite::types::Type::Text,
        Box::new(std::io::Error::new(
            std::io::ErrorKind::InvalidData,
            format!("invalid data source group timestamp {value:?}: {error}"),
        )),
    )
}

fn normalize_group_name(value: &str) -> Result<String, AppError> {
    let name = value.trim();
    if name.is_empty() {
        return Err(AppError::ConfigError(
            "data source group name is required".to_string(),
        ));
    }
    if name.chars().count() > 80 {
        return Err(AppError::ConfigError(
            "data source group name must be at most 80 characters".to_string(),
        ));
    }
    Ok(name.to_string())
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

fn row_to_sql_draft(row: &Row<'_>) -> Result<SqlDraft, rusqlite::Error> {
    let id: String = row.get(0)?;
    let connection_id: Option<String> = row.get(1)?;
    let created_at: String = row.get(7)?;
    let updated_at: String = row.get(8)?;
    let last_opened_at: Option<String> = row.get(9)?;
    let closed_at: Option<String> = row.get(10)?;

    Ok(SqlDraft {
        id: Uuid::parse_str(&id).map_err(parse_error)?,
        connection_id: connection_id
            .as_deref()
            .map(Uuid::parse_str)
            .transpose()
            .map_err(parse_error)?,
        connection_name_snapshot: row.get(2)?,
        database: row.get(3)?,
        schema: row.get(4)?,
        title: row.get(5)?,
        sql: row.get(6)?,
        created_at: DateTime::parse_from_rfc3339(&created_at)
            .map_err(parse_error)?
            .with_timezone(&Utc),
        updated_at: DateTime::parse_from_rfc3339(&updated_at)
            .map_err(parse_error)?
            .with_timezone(&Utc),
        last_opened_at: last_opened_at
            .as_deref()
            .map(DateTime::parse_from_rfc3339)
            .transpose()
            .map_err(parse_error)?
            .map(|value| value.with_timezone(&Utc)),
        closed_at: closed_at
            .as_deref()
            .map(DateTime::parse_from_rfc3339)
            .transpose()
            .map_err(parse_error)?
            .map(|value| value.with_timezone(&Utc)),
    })
}

fn row_to_driver_definition(row: &Row<'_>) -> Result<DriverDefinition, rusqlite::Error> {
    let id: String = row.get(0)?;
    let driver_type: String = row.get(1)?;
    let backend: String = row.get(4)?;
    let status: String = row.get(5)?;
    let default_port: Option<i64> = row.get(6)?;
    let driver_artifacts_json: String = row.get(12)?;
    let user_driver_required: i64 = row.get(13)?;
    let built_in: i64 = row.get(14)?;
    let connection_variants_json: String = row.get(17)?;
    let capabilities_json: String = row.get(19)?;

    Ok(DriverDefinition {
        id,
        driver_type: DriverType::from_str(&driver_type).map_err(parse_error)?,
        driver_dialect: row.get(2)?,
        name: row.get(3)?,
        backend: DriverBackend::from_str(&backend).map_err(parse_error)?,
        status: DriverStatus::from_str(&status).map_err(parse_error)?,
        default_port: default_port.map(|value| value as u16),
        default_username: row.get(7)?,
        default_database: row.get(8)?,
        jdbc_driver_class: row.get(9)?,
        url_template: row.get(10)?,
        driver_artifact: row.get(11)?,
        driver_artifacts: serde_json::from_str::<Vec<String>>(&driver_artifacts_json)
            .map_err(parse_error)?,
        user_driver_required: user_driver_required != 0,
        built_in: built_in != 0,
        download_url: row.get(15)?,
        notes: row.get(16)?,
        connection_variants: serde_json::from_str::<Vec<DriverConnectionVariant>>(
            &connection_variants_json,
        )
        .map_err(parse_error)?,
        metadata_dialect_sql: row.get(18)?,
        capabilities: serde_json::from_str::<DriverDefinitionCapabilities>(&capabilities_json)
            .map_err(parse_error)?,
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
    use super::{migrate_data_source_groups, table_columns, table_exists, ConfigStore};
    use crate::models::{
        connection::{ConnectionConfig, DriverType, SshAuthMethod, SshTunnelConfig},
        driver_catalog::{
            DriverBackend, DriverConnectionVariant, DriverDefinition, DriverDefinitionCapabilities,
            DriverStatus,
        },
        query_history::{QueryHistoryEntry, QueryHistoryStatus},
        sql_draft::SqlDraft,
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
            vec![1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]
        );
        let drivers = store
            .list_driver_definitions()
            .expect("list seeded driver definitions");
        assert!(drivers
            .iter()
            .any(|driver| driver.id == "postgres" && driver.driver_type == DriverType::Postgres));
        assert!(drivers
            .iter()
            .any(|driver| driver.id == "oracle" && driver.driver_type == DriverType::Oracle));
        assert!(!drivers
            .iter()
            .any(|driver| matches!(driver.driver_type, DriverType::Mongo | DriverType::Redis)));
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
            vec![1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]
        );
        assert!(columns.iter().any(|column| column == "connection_url"));
        assert!(columns.iter().any(|column| column == "driver_class"));
        assert!(columns.iter().any(|column| column == "driver_paths"));
        assert!(columns
            .iter()
            .any(|column| column == "driver_definition_id"));
        assert!(columns.iter().any(|column| column == "ssh_tunnel_json"));
        assert!(columns
            .iter()
            .any(|column| column == "ssh_password_encrypted"));
        assert!(table_exists(&conn, "query_history").expect("query history table exists"));
        assert!(table_exists(&conn, "sql_drafts").expect("sql drafts table exists"));
        assert!(table_exists(&conn, "driver_definitions").expect("driver definitions table exists"));
        assert!(table_exists(&conn, "data_source_groups").expect("data source groups table exists"));
        assert!(columns.iter().any(|column| column == "group_id"));
        assert!(store
            .get_connection(old_connection_id)
            .expect("legacy connection lookup after model rebuild")
            .is_none());
        assert!(store
            .list_driver_definitions()
            .expect("list seeded driver definitions")
            .iter()
            .any(|driver| driver.id == "postgres" && driver.built_in));
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
            driver_definition_id: Some("postgres".to_string()),
            driver_type: DriverType::Postgres,
            driver_dialect: Some("postgresql".to_string()),
            host: Some("localhost".to_string()),
            port: Some(5432),
            database: Some("penguin_farm".to_string()),
            connection_url: None,
            username: Some("postgres".to_string()),
            password_encrypted: None,
            has_saved_password: false,
            driver_class: None,
            driver_paths: Vec::new(),
            ssl_mode: None,
            group_id: None,
            group: None,
            color_tag: None,
            ssh_tunnel: None,
            created_at: Utc::now(),
            updated_at: Utc::now(),
        };

        let saved = store
            .create_connection(config, Some("postgres123".to_string()), true)
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
    fn manages_data_source_groups_without_deleting_connections() {
        std::env::set_var("VAPORLENSDB_USE_DEV_KEY", "1");
        let dir = std::env::temp_dir().join(format!(
            "vaporlensdb-data-source-groups-test-{}",
            Uuid::new_v4()
        ));
        let store = ConfigStore::new(dir).expect("create config store");
        let group = store
            .create_data_source_group("Development".to_string())
            .expect("create group");
        assert_eq!(
            store.list_data_source_groups().expect("list groups").len(),
            1
        );

        let renamed = store
            .rename_data_source_group(group.id, "Shared development".to_string())
            .expect("rename group");
        assert_eq!(renamed.name, "Shared development");

        let production = store
            .create_data_source_group("Production".to_string())
            .expect("create second group");
        let reordered = store
            .reorder_data_source_groups(vec![production.id, group.id])
            .expect("reorder groups");
        assert_eq!(
            reordered.iter().map(|item| item.id).collect::<Vec<_>>(),
            vec![production.id, group.id]
        );
        assert!(store.reorder_data_source_groups(vec![group.id]).is_err());

        store
            .delete_data_source_group(group.id)
            .expect("delete group");
        assert_eq!(
            store.list_data_source_groups().expect("list groups").len(),
            1
        );
    }

    #[test]
    fn lists_data_source_groups_with_legacy_sqlite_timestamps() {
        std::env::set_var("VAPORLENSDB_USE_DEV_KEY", "1");
        let dir = std::env::temp_dir().join(format!(
            "vaporlensdb-legacy-data-source-group-timestamp-test-{}",
            Uuid::new_v4()
        ));
        let store = ConfigStore::new(dir).expect("create config store");
        let id = Uuid::new_v4();
        let conn = Connection::open(store.db_path()).expect("open config database");
        conn.execute(
            "INSERT INTO data_source_groups (id, name, sort_order, created_at, updated_at) VALUES (?1, 'Legacy timestamp', 100, '2026-07-22 09:04:56', '2026-07-22 09:04:56')",
            params![id.to_string()],
        )
        .expect("insert legacy data source group");
        drop(conn);

        let groups = store
            .list_data_source_groups()
            .expect("list data source groups with legacy timestamps");
        assert_eq!(groups.len(), 1);
        assert_eq!(groups[0].id, id);
        assert_eq!(groups[0].name, "Legacy timestamp");
    }

    #[test]
    fn data_source_group_migration_writes_rfc3339_timestamps() {
        let conn = Connection::open_in_memory().expect("open in-memory config database");
        conn.execute_batch(
            "
            CREATE TABLE connections (group_name TEXT);
            INSERT INTO connections (group_name) VALUES ('Migrated group');
            ",
        )
        .expect("create legacy connection group");

        migrate_data_source_groups(&conn).expect("migrate data source groups");

        let created_at: String = conn
            .query_row(
                "SELECT created_at FROM data_source_groups WHERE name = 'Migrated group'",
                [],
                |row| row.get(0),
            )
            .expect("read migrated group timestamp");
        assert!(chrono::DateTime::parse_from_rfc3339(&created_at).is_ok());
    }

    #[test]
    fn stores_connection_ssh_tunnel_without_plaintext_secrets() {
        std::env::set_var("VAPORLENSDB_USE_DEV_KEY", "1");
        let dir = std::env::temp_dir().join(format!(
            "vaporlensdb-ssh-tunnel-config-test-{}",
            uuid::Uuid::new_v4()
        ));
        let store = ConfigStore::new(dir).expect("create config store");
        let connection_id = Uuid::new_v4();
        let now = Utc::now();

        let saved = store
            .create_connection(
                ConnectionConfig {
                    id: connection_id,
                    name: "Tunnel PG".to_string(),
                    driver_definition_id: Some("postgres".to_string()),
                    driver_type: DriverType::Postgres,
                    driver_dialect: Some("postgresql".to_string()),
                    host: Some("db.internal".to_string()),
                    port: Some(5432),
                    database: Some("postgres".to_string()),
                    connection_url: None,
                    username: Some("postgres".to_string()),
                    password_encrypted: None,
                    has_saved_password: false,
                    driver_class: None,
                    driver_paths: Vec::new(),
                    ssl_mode: None,
                    group_id: None,
                    group: None,
                    color_tag: None,
                    ssh_tunnel: Some(SshTunnelConfig {
                        enabled: true,
                        host: "bastion.internal".to_string(),
                        port: 22,
                        username: "deploy".to_string(),
                        auth_method: SshAuthMethod::PrivateKey,
                        password_encrypted: None,
                        private_key_path: Some("/tmp/id_ed25519".to_string()),
                        private_key_passphrase_encrypted: Some("key-passphrase".to_string()),
                        remote_host: None,
                        remote_port: None,
                        local_host: Some("127.0.0.1".to_string()),
                    }),
                    created_at: now,
                    updated_at: now,
                },
                None,
                true,
            )
            .expect("create connection");

        let stored_tunnel = saved.ssh_tunnel.as_ref().expect("ssh tunnel stored");
        assert_ne!(
            stored_tunnel.private_key_passphrase_encrypted.as_deref(),
            Some("key-passphrase")
        );

        let reloaded = store
            .get_connection(connection_id)
            .expect("get connection")
            .expect("connection exists");
        let decrypted = store
            .decrypt_ssh_tunnel(&reloaded)
            .expect("decrypt ssh tunnel")
            .expect("ssh tunnel exists");
        assert_eq!(
            decrypted.private_key_passphrase_encrypted.as_deref(),
            Some("key-passphrase")
        );
        assert_eq!(decrypted.host, "bastion.internal");
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
                    driver_definition_id: Some("mysql".to_string()),
                    driver_type: DriverType::Mysql,
                    driver_dialect: Some("mysql".to_string()),
                    host: Some("localhost".to_string()),
                    port: Some(3306),
                    database: Some("app".to_string()),
                    connection_url: Some("mysql://root@localhost:3306/app".to_string()),
                    username: Some("root".to_string()),
                    password_encrypted: None,
                    has_saved_password: false,
                    driver_class: None,
                    driver_paths: Vec::new(),
                    ssl_mode: Some("prefer".to_string()),
                    group_id: None,
                    group: Some("Local".to_string()),
                    color_tag: Some("dev".to_string()),
                    ssh_tunnel: None,
                    created_at,
                    updated_at: created_at,
                },
                None,
                true,
            )
            .expect("create connection");

        assert_eq!(saved.id, connection_id);
        assert_eq!(saved.driver_definition_id.as_deref(), Some("mysql"));
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
                true,
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
    fn saves_a_connection_into_a_new_or_existing_data_source_group() {
        std::env::set_var("VAPORLENSDB_USE_DEV_KEY", "1");
        let dir = std::env::temp_dir().join(format!(
            "vaporlensdb-connection-group-save-test-{}",
            uuid::Uuid::new_v4()
        ));
        let store = ConfigStore::new(dir).expect("create config store");
        let now = Utc::now();

        let first = store
            .create_connection(
                ConnectionConfig {
                    id: Uuid::new_v4(),
                    name: "Grouped Postgres".to_string(),
                    driver_definition_id: Some("postgres".to_string()),
                    driver_type: DriverType::Postgres,
                    driver_dialect: Some("postgresql".to_string()),
                    host: Some("localhost".to_string()),
                    port: Some(5432),
                    database: Some("postgres".to_string()),
                    connection_url: None,
                    username: Some("postgres".to_string()),
                    password_encrypted: None,
                    has_saved_password: false,
                    driver_class: None,
                    driver_paths: Vec::new(),
                    ssl_mode: None,
                    group_id: None,
                    group: Some("test".to_string()),
                    color_tag: None,
                    ssh_tunnel: None,
                    created_at: now,
                    updated_at: now,
                },
                None,
                true,
            )
            .expect("save connection with a new group");
        let group_id = first.group_id.expect("new group id");
        assert_eq!(first.group.as_deref(), Some("test"));
        assert_eq!(
            store.list_data_source_groups().expect("list groups").len(),
            1
        );

        let second = store
            .create_connection(
                ConnectionConfig {
                    id: Uuid::new_v4(),
                    name: "Grouped MySQL".to_string(),
                    driver_definition_id: Some("mysql".to_string()),
                    driver_type: DriverType::Mysql,
                    driver_dialect: Some("mysql".to_string()),
                    host: Some("localhost".to_string()),
                    port: Some(3306),
                    database: Some("app".to_string()),
                    connection_url: None,
                    username: Some("root".to_string()),
                    password_encrypted: None,
                    has_saved_password: false,
                    driver_class: None,
                    driver_paths: Vec::new(),
                    ssl_mode: None,
                    group_id: Some(group_id),
                    group: None,
                    color_tag: None,
                    ssh_tunnel: None,
                    created_at: now,
                    updated_at: now,
                },
                None,
                true,
            )
            .expect("save connection with an existing empty or populated group");
        assert_eq!(second.group_id, Some(group_id));
        assert_eq!(second.group.as_deref(), Some("test"));
        assert_eq!(
            store.list_data_source_groups().expect("list groups").len(),
            1
        );
    }

    #[test]
    fn stores_connection_driver_definition_reference() {
        std::env::set_var("VAPORLENSDB_USE_DEV_KEY", "1");
        let dir = std::env::temp_dir().join(format!(
            "vaporlensdb-connection-driver-ref-test-{}",
            uuid::Uuid::new_v4()
        ));
        let store = ConfigStore::new(dir).expect("create config store");
        let connection_id = Uuid::new_v4();
        let now = Utc::now();

        store
            .create_connection(
                ConnectionConfig {
                    id: connection_id,
                    name: "Custom JDBC Source".to_string(),
                    driver_definition_id: Some("custom-reporting-jdbc".to_string()),
                    driver_type: DriverType::Jdbc,
                    driver_dialect: Some("genericJdbc".to_string()),
                    host: None,
                    port: None,
                    database: None,
                    connection_url: Some("jdbc:example://host/db".to_string()),
                    username: Some("reporting".to_string()),
                    password_encrypted: None,
                    has_saved_password: false,
                    driver_class: Some("com.example.Driver".to_string()),
                    driver_paths: vec!["/tmp/example.jar".to_string()],
                    ssl_mode: None,
                    group_id: None,
                    group: Some("Custom".to_string()),
                    color_tag: Some("dev".to_string()),
                    ssh_tunnel: None,
                    created_at: now,
                    updated_at: now,
                },
                None,
                true,
            )
            .expect("create connection");

        let saved = store
            .get_connection(connection_id)
            .expect("get saved connection")
            .expect("connection exists");
        assert_eq!(
            saved.driver_definition_id.as_deref(),
            Some("custom-reporting-jdbc")
        );
        assert_eq!(saved.driver_type, DriverType::Jdbc);
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
    fn stores_closes_and_clears_sql_drafts() {
        std::env::set_var("VAPORLENSDB_USE_DEV_KEY", "1");
        let dir =
            std::env::temp_dir().join(format!("vaporlensdb-sql-draft-test-{}", Uuid::new_v4()));
        let store = ConfigStore::new(dir).expect("create config store");
        let draft_id = Uuid::new_v4();
        let now = Utc::now();

        store
            .upsert_sql_draft(SqlDraft {
                id: draft_id,
                connection_id: None,
                connection_name_snapshot: Some("Deleted Oracle".to_string()),
                database: Some("orcl".to_string()),
                schema: Some("DEVELOP".to_string()),
                title: "Oracle scratch".to_string(),
                sql: "SELECT * FROM AA".to_string(),
                created_at: now,
                updated_at: now,
                last_opened_at: Some(now),
                closed_at: None,
            })
            .expect("save sql draft");

        let drafts = store.list_sql_drafts(50).expect("list sql drafts");
        assert_eq!(drafts.len(), 1);
        assert_eq!(drafts[0].id, draft_id);
        assert_eq!(
            drafts[0].connection_name_snapshot.as_deref(),
            Some("Deleted Oracle")
        );
        assert_eq!(drafts[0].schema.as_deref(), Some("DEVELOP"));

        store
            .mark_sql_draft_closed(draft_id)
            .expect("mark sql draft closed");
        let closed = store
            .get_sql_draft(draft_id)
            .expect("get closed draft")
            .expect("draft exists");
        assert!(closed.closed_at.is_some());

        store.clear_sql_drafts().expect("clear sql drafts");
        assert!(store
            .list_sql_drafts(50)
            .expect("list cleared sql drafts")
            .is_empty());
    }

    #[test]
    fn seeds_driver_definitions_with_variants_and_capabilities() {
        std::env::set_var("VAPORLENSDB_USE_DEV_KEY", "1");
        let dir =
            std::env::temp_dir().join(format!("vaporlensdb-driver-seed-test-{}", Uuid::new_v4()));
        let store = ConfigStore::new(dir).expect("create config store");

        let drivers = store
            .list_driver_definitions()
            .expect("list driver definitions");
        let postgres = drivers
            .iter()
            .find(|driver| driver.id == "postgres")
            .expect("postgres driver exists");
        let postgres_jdbc = drivers
            .iter()
            .find(|driver| driver.id == "jdbc-postgresql")
            .expect("postgres JDBC driver exists");
        let mysql_jdbc = drivers
            .iter()
            .find(|driver| driver.id == "jdbc-mysql")
            .expect("mysql JDBC driver exists");
        let oracle = drivers
            .iter()
            .find(|driver| driver.id == "oracle")
            .expect("oracle driver exists");

        assert!(postgres.built_in);
        assert_eq!(postgres.default_port, Some(5432));
        assert!(postgres.capabilities.can_stream);
        assert!(postgres
            .connection_variants
            .iter()
            .any(|variant| variant.id == "hostPort"));
        assert!(oracle.user_driver_required);
        assert!(oracle
            .connection_variants
            .iter()
            .any(|variant| variant.id == "oracleService"));
        assert_seeded_metadata_sql(postgres_jdbc);
        assert_seeded_metadata_sql(mysql_jdbc);
    }

    #[test]
    fn hides_legacy_odbc_records_from_runtime_lists() {
        std::env::set_var("VAPORLENSDB_USE_DEV_KEY", "1");
        let dir =
            std::env::temp_dir().join(format!("vaporlensdb-legacy-odbc-test-{}", Uuid::new_v4()));
        let store = ConfigStore::new(dir).expect("create config store");
        let conn = store.conn().expect("open config db");
        let now = Utc::now().to_rfc3339();

        conn.execute(
            "
            INSERT INTO driver_definitions (
                id, driver_type, name, backend, status, driver_artifacts_json,
                user_driver_required, built_in, notes, connection_variants_json,
                metadata_dialect_sql, capabilities_json, updated_at
            )
            VALUES (?1, 'odbc', 'Legacy ODBC', 'odbc', 'configurable', '[]', 1, 0, NULL, ?2, NULL, ?3, datetime('now'))
            ",
            params![
                "legacy-odbc",
                serde_json::json!([{ "id": "urlOnly", "label": "URL only", "requiredFields": ["connectionUrl"] }]).to_string(),
                serde_json::json!({
                    "canConnect": false,
                    "canQuery": false,
                    "canStream": false,
                    "canReadMetadata": false,
                    "canCancel": false,
                    "canGenerateDdl": false
                })
                .to_string(),
            ],
        )
        .expect("insert legacy ODBC driver");

        conn.execute(
            "
            INSERT INTO connections (
                id, name, driver_definition_id, driver_type, host, port, database_name,
                connection_url, username, password_encrypted, driver_class, driver_paths,
                ssl_mode, group_name, color_tag, created_at, updated_at
            )
            VALUES (?1, 'Legacy ODBC connection', 'legacy-odbc', 'odbc', NULL, NULL, NULL,
                    'DSN=legacy', NULL, NULL, NULL, '[]', NULL, NULL, NULL, ?2, ?2)
            ",
            params![Uuid::new_v4().to_string(), now],
        )
        .expect("insert legacy ODBC connection");

        assert!(store
            .list_driver_definitions()
            .expect("list drivers")
            .iter()
            .all(|driver| driver.id != "legacy-odbc"));
        assert!(store
            .get_driver_definition("legacy-odbc")
            .expect("get legacy ODBC driver")
            .is_none());
        assert!(store
            .list_connections()
            .expect("list connections")
            .iter()
            .all(|connection| connection.driver_definition_id.as_deref() != Some("legacy-odbc")));
    }

    #[test]
    fn hides_planned_mongo_and_redis_driver_records_from_runtime_lists() {
        std::env::set_var("VAPORLENSDB_USE_DEV_KEY", "1");
        let dir = std::env::temp_dir().join(format!(
            "vaporlensdb-planned-driver-test-{}",
            Uuid::new_v4()
        ));
        let store = ConfigStore::new(dir).expect("create config store");
        let conn = store.conn().expect("open config db");

        conn.execute(
            "
            INSERT OR REPLACE INTO driver_definitions (
                id, driver_type, name, backend, status, driver_artifacts_json,
                user_driver_required, built_in, notes, connection_variants_json,
                metadata_dialect_sql, capabilities_json, updated_at
            )
            VALUES (?1, ?2, ?3, 'planned', 'planned', '[]', 0, 1, NULL, ?4, NULL, ?5, datetime('now'))
            ",
            params![
                "mongo",
                "mongo",
                "MongoDB",
                serde_json::json!([{ "id": "hostPort", "label": "Host/Port", "requiredFields": ["host"] }]).to_string(),
                serde_json::json!({
                    "canConnect": false,
                    "canQuery": false,
                    "canStream": false,
                    "canReadMetadata": false,
                    "canCancel": false,
                    "canGenerateDdl": false
                })
                .to_string(),
            ],
        )
        .expect("insert planned MongoDB driver");

        assert!(store
            .list_driver_definitions()
            .expect("list drivers")
            .iter()
            .all(|driver| driver.id != "mongo"));
        assert!(store
            .get_driver_definition("mongo")
            .expect("get MongoDB driver")
            .is_none());
    }

    #[test]
    fn preserves_builtin_oracle_driver_artifacts_when_reseeding() {
        std::env::set_var("VAPORLENSDB_USE_DEV_KEY", "1");
        let dir = std::env::temp_dir().join(format!(
            "vaporlensdb-oracle-artifact-test-{}",
            Uuid::new_v4()
        ));
        let store = ConfigStore::new(dir.clone()).expect("create config store");

        let updated = store
            .update_driver_definition_artifacts(
                "oracle",
                vec!["/tmp/ojdbc11.jar".to_string()],
                Some("ojdbc11.jar".to_string()),
            )
            .expect("update oracle artifacts");
        assert!(updated.built_in);
        assert_eq!(updated.driver_artifacts, vec!["/tmp/ojdbc11.jar"]);

        let reopened = ConfigStore::new(dir).expect("reopen config store");
        let oracle = reopened
            .get_driver_definition("oracle")
            .expect("get oracle")
            .expect("oracle exists");
        assert!(oracle.built_in);
        assert_eq!(oracle.driver_artifacts, vec!["/tmp/ojdbc11.jar"]);
        assert_eq!(oracle.driver_artifact.as_deref(), Some("ojdbc11.jar"));
    }

    #[test]
    fn creates_updates_and_deletes_custom_driver_definition() {
        std::env::set_var("VAPORLENSDB_USE_DEV_KEY", "1");
        let dir =
            std::env::temp_dir().join(format!("vaporlensdb-custom-driver-test-{}", Uuid::new_v4()));
        let store = ConfigStore::new(dir).expect("create config store");

        let saved = store
            .save_custom_driver_definition(DriverDefinition {
                id: "custom-reporting-jdbc".to_string(),
                driver_type: DriverType::Jdbc,
                driver_dialect: "genericJdbc".to_string(),
                name: "Reporting JDBC".to_string(),
                backend: DriverBackend::Jdbc,
                status: DriverStatus::Configurable,
                default_port: None,
                default_username: None,
                default_database: None,
                jdbc_driver_class: Some("com.example.Driver".to_string()),
                url_template: Some("jdbc:example://{host}:{port}/{database}".to_string()),
                driver_artifact: Some("example.jar".to_string()),
                driver_artifacts: vec!["/tmp/example.jar".to_string()],
                user_driver_required: true,
                built_in: true,
                download_url: None,
                notes: Some("custom test driver".to_string()),
                connection_variants: vec![DriverConnectionVariant {
                    id: "urlOnly".to_string(),
                    label: "URL only".to_string(),
                    required_fields: vec!["connectionUrl".to_string()],
                }],
                metadata_dialect_sql: Some("SELECT 1".to_string()),
                capabilities: DriverDefinitionCapabilities {
                    can_connect: true,
                    can_query: true,
                    can_stream: false,
                    can_read_metadata: false,
                    can_cancel: false,
                    can_generate_ddl: false,
                },
            })
            .expect("save custom driver");

        assert!(!saved.built_in);
        assert_eq!(saved.id, "custom-reporting-jdbc");
        assert_eq!(saved.driver_artifacts, vec!["/tmp/example.jar"]);
        assert!(store
            .list_driver_definitions()
            .expect("list drivers")
            .iter()
            .any(|driver| driver.id == "custom-reporting-jdbc"));

        let updated = store
            .save_custom_driver_definition(DriverDefinition {
                name: "Reporting JDBC Updated".to_string(),
                ..saved
            })
            .expect("update custom driver");
        assert_eq!(updated.name, "Reporting JDBC Updated");

        let overwrite_builtin = store.save_custom_driver_definition(DriverDefinition {
            id: "postgres".to_string(),
            ..updated.clone()
        });
        assert!(overwrite_builtin.is_err());

        store
            .delete_custom_driver_definition("custom-reporting-jdbc")
            .expect("delete custom driver");
        assert!(!store
            .list_driver_definitions()
            .expect("list drivers after delete")
            .iter()
            .any(|driver| driver.id == "custom-reporting-jdbc"));
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

    #[test]
    fn prunes_sql_drafts_to_recent_fifty_entries() {
        std::env::set_var("VAPORLENSDB_USE_DEV_KEY", "1");
        let dir =
            std::env::temp_dir().join(format!("vaporlensdb-draft-prune-test-{}", Uuid::new_v4()));
        let store = ConfigStore::new(dir).expect("create config store");
        let now = Utc::now();

        for index in 0..55 {
            store
                .upsert_sql_draft(SqlDraft {
                    id: Uuid::new_v4(),
                    connection_id: None,
                    connection_name_snapshot: Some("Scratch".to_string()),
                    database: None,
                    schema: None,
                    title: format!("SQL {index}"),
                    sql: format!("SELECT {index}"),
                    created_at: now + chrono::Duration::milliseconds(index),
                    updated_at: now + chrono::Duration::milliseconds(index),
                    last_opened_at: None,
                    closed_at: None,
                })
                .expect("save sql draft");
        }

        let drafts = store.list_sql_drafts(50).expect("list pruned drafts");
        assert_eq!(drafts.len(), 50);
        assert_eq!(drafts[0].sql, "SELECT 54");
        assert_eq!(
            drafts.last().map(|draft| draft.sql.as_str()),
            Some("SELECT 5")
        );
    }

    fn assert_seeded_metadata_sql(driver: &DriverDefinition) {
        let metadata_sql = driver
            .metadata_dialect_sql
            .as_deref()
            .unwrap_or_else(|| panic!("{} should seed metadata SQL", driver.id));
        let parsed: serde_json::Value =
            serde_json::from_str(metadata_sql).expect("metadata SQL should parse as JSON");
        let object = parsed
            .as_object()
            .expect("metadata SQL should be a JSON object");

        for key in [
            "databases",
            "schemas",
            "tables",
            "views",
            "columns",
            "indexes",
            "foreignKeys",
            "schemaObjects",
        ] {
            assert!(
                object
                    .get(key)
                    .and_then(|value| value.as_str())
                    .is_some_and(|sql| !sql.trim().is_empty()),
                "{} should seed non-empty {key} metadata SQL",
                driver.id
            );
        }
    }
}
