use std::{collections::HashMap, sync::Arc};

use uuid::Uuid;

use crate::{
    drivers::{
        jdbc::JdbcDriver, mysql::MysqlDriver, postgres::PostgresDriver, trait_def::DatabaseDriver,
    },
    models::{
        connection::{ConnectionConfig, ConnectionRuntimeStatus, ConnectionStatus, DriverType},
        error::AppError,
        metadata::{ColumnInfo, DatabaseInfo, ForeignKeyInfo, IndexInfo, SchemaInfo, TableInfo},
        query_result::{ExplainResult, QueryResult},
    },
    services::external_driver::validate_odbc_prerequisites,
};

pub struct ConnectionManager {
    connections: HashMap<Uuid, Arc<dyn DatabaseDriver>>,
    statuses: HashMap<Uuid, ConnectionStatus>,
}

impl ConnectionManager {
    pub fn new() -> Self {
        Self {
            connections: HashMap::new(),
            statuses: HashMap::new(),
        }
    }

    pub async fn test_connection(
        &self,
        config: &ConnectionConfig,
        password: Option<&str>,
    ) -> Result<(), AppError> {
        match config.driver_type {
            DriverType::Odbc => {
                return validate_odbc_prerequisites(config);
            }
            _ => {}
        }

        let driver = create_driver(config, password).await?;
        driver.ping().await
    }

    pub async fn connect(
        &mut self,
        config: &ConnectionConfig,
        password: Option<&str>,
    ) -> Result<ConnectionStatus, AppError> {
        self.set_status(config.id, ConnectionRuntimeStatus::Connecting, None);

        match create_driver(config, password).await {
            Ok(driver) => {
                driver.ping().await?;
                self.connections.insert(config.id, driver);
                Ok(self.set_status(config.id, ConnectionRuntimeStatus::Connected, None))
            }
            Err(error) => {
                let message = error.to_string();
                self.set_status(config.id, ConnectionRuntimeStatus::Failed, Some(message));
                Err(error)
            }
        }
    }

    pub fn disconnect(&mut self, connection_id: Uuid) -> Result<ConnectionStatus, AppError> {
        self.connections.remove(&connection_id);
        Ok(self.set_status(connection_id, ConnectionRuntimeStatus::Disconnected, None))
    }

    pub fn status(&self, connection_id: Uuid) -> ConnectionStatus {
        self.statuses
            .get(&connection_id)
            .cloned()
            .unwrap_or(ConnectionStatus {
                connection_id,
                status: ConnectionRuntimeStatus::Disconnected,
                message: None,
            })
    }

    pub fn statuses(&self) -> Vec<ConnectionStatus> {
        self.statuses.values().cloned().collect()
    }

    pub async fn get_databases(&self, connection_id: Uuid) -> Result<Vec<DatabaseInfo>, AppError> {
        self.driver(connection_id)?.get_databases().await
    }

    pub async fn get_schemas(
        &self,
        connection_id: Uuid,
        database: Option<&str>,
    ) -> Result<Vec<SchemaInfo>, AppError> {
        self.driver(connection_id)?.get_schemas(database).await
    }

    pub async fn get_tables(
        &self,
        connection_id: Uuid,
        schema: &str,
    ) -> Result<Vec<TableInfo>, AppError> {
        self.driver(connection_id)?.get_tables(schema).await
    }

    pub async fn get_columns(
        &self,
        connection_id: Uuid,
        schema: &str,
        table: &str,
    ) -> Result<Vec<ColumnInfo>, AppError> {
        self.driver(connection_id)?.get_columns(schema, table).await
    }

    pub async fn get_indexes(
        &self,
        connection_id: Uuid,
        schema: &str,
        table: &str,
    ) -> Result<Vec<IndexInfo>, AppError> {
        self.driver(connection_id)?.get_indexes(schema, table).await
    }

    pub async fn get_foreign_keys(
        &self,
        connection_id: Uuid,
        schema: &str,
        table: &str,
    ) -> Result<Vec<ForeignKeyInfo>, AppError> {
        self.driver(connection_id)?
            .get_foreign_keys(schema, table)
            .await
    }

    pub async fn get_views(
        &self,
        connection_id: Uuid,
        schema: &str,
    ) -> Result<Vec<TableInfo>, AppError> {
        self.driver(connection_id)?.get_views(schema).await
    }

    pub async fn get_functions(
        &self,
        connection_id: Uuid,
        schema: &str,
    ) -> Result<Vec<String>, AppError> {
        self.driver(connection_id)?.get_functions(schema).await
    }

    pub async fn execute_query(
        &self,
        connection_id: Uuid,
        sql: &str,
    ) -> Result<QueryResult, AppError> {
        self.driver(connection_id)?.execute_query(sql, None).await
    }

    pub async fn explain_query(
        &self,
        connection_id: Uuid,
        sql: &str,
    ) -> Result<ExplainResult, AppError> {
        self.driver(connection_id)?.explain_query(sql).await
    }

    pub async fn cancel_query(&self, connection_id: Uuid, query_id: &str) -> Result<(), AppError> {
        self.driver(connection_id)?.cancel_query(query_id).await
    }

    pub fn driver(&self, connection_id: Uuid) -> Result<Arc<dyn DatabaseDriver>, AppError> {
        self.connections
            .get(&connection_id)
            .cloned()
            .ok_or_else(|| AppError::NotFound {
                resource: "active connection".to_string(),
                id: connection_id.to_string(),
            })
    }

    fn set_status(
        &mut self,
        connection_id: Uuid,
        status: ConnectionRuntimeStatus,
        message: Option<String>,
    ) -> ConnectionStatus {
        let status = ConnectionStatus {
            connection_id,
            status,
            message,
        };
        self.statuses.insert(connection_id, status.clone());
        status
    }
}

impl Default for ConnectionManager {
    fn default() -> Self {
        Self::new()
    }
}

async fn create_driver(
    config: &ConnectionConfig,
    password: Option<&str>,
) -> Result<Arc<dyn DatabaseDriver>, AppError> {
    match config.driver_type {
        DriverType::Postgres => {
            let host = required(config.host.as_deref(), "host")?;
            let port = config.port.unwrap_or(5432);
            let database = required(config.database.as_deref(), "database")?;
            let username = required(config.username.as_deref(), "username")?;
            let password = password.unwrap_or("");
            let driver =
                PostgresDriver::connect_with_params(host, port, database, username, password)
                    .await?;
            Ok(Arc::new(driver))
        }
        DriverType::Mysql => {
            let host = required(config.host.as_deref(), "host")?;
            let port = config.port.unwrap_or(3306);
            let database = required(config.database.as_deref(), "database")?;
            let username = required(config.username.as_deref(), "username")?;
            let password = password.unwrap_or("");
            let driver =
                MysqlDriver::connect_with_params(host, port, database, username, password).await?;
            Ok(Arc::new(driver))
        }
        DriverType::Oracle => {
            let driver = JdbcDriver::connect(config, password).await?;
            Ok(Arc::new(driver))
        }
        DriverType::Jdbc => {
            let driver = JdbcDriver::connect(config, password).await?;
            Ok(Arc::new(driver))
        }
        DriverType::Odbc => {
            validate_odbc_prerequisites(config)?;
            Err(AppError::UnsupportedOperation {
                driver: "odbc".to_string(),
                operation: "connect via ODBC bridge runtime".to_string(),
            })
        }
        _ => Err(AppError::UnsupportedOperation {
            driver: config.driver_type.to_string(),
            operation: "connect".to_string(),
        }),
    }
}

fn required<'a>(value: Option<&'a str>, name: &str) -> Result<&'a str, AppError> {
    value
        .filter(|value| !value.is_empty())
        .ok_or_else(|| AppError::ConfigError(format!("{name} is required")))
}
