use std::{
    collections::{HashMap, HashSet},
    sync::Arc,
    time::{Duration, Instant},
};

use tokio::sync::{OwnedSemaphorePermit, Semaphore, TryAcquireError};
use tokio_util::sync::CancellationToken;

use uuid::Uuid;

use crate::{
    drivers::{
        jdbc::JdbcDriver, mssql::MssqlDriver, mysql::MysqlDriver, postgres::PostgresDriver,
        sqlite::SqliteDriver, trait_def::DatabaseDriver,
    },
    models::{
        connection::{ConnectionConfig, ConnectionRuntimeStatus, ConnectionStatus, DriverType},
        driver_catalog::DriverDefinition,
        error::AppError,
        metadata::{ColumnInfo, DatabaseInfo, ForeignKeyInfo, IndexInfo, SchemaInfo, TableInfo},
        query_result::{ExplainResult, QueryResult},
    },
    services::ssh_tunnel::SshTunnel,
};

pub struct ConnectionManager {
    connections: HashMap<Uuid, ActiveConnection>,
    statuses: HashMap<Uuid, ConnectionStatus>,
    pending_connections: HashSet<Uuid>,
    max_live_sessions: usize,
    idle_reclaim_after: Option<Duration>,
}

pub(crate) struct ActiveConnection {
    driver: Arc<dyn DatabaseDriver>,
    _ssh_tunnel: Option<SshTunnel>,
    last_used: Instant,
    in_flight_operations: usize,
    serial_query_gate: Arc<Semaphore>,
    queued_queries: HashMap<String, CancellationToken>,
}

/// Keeps a serial-driver permit alive for the complete lifetime of a query.
/// Concurrent drivers intentionally leave this empty.
pub struct QueryOperation {
    pub driver: Arc<dyn DatabaseDriver>,
    _serial_permit: Option<OwnedSemaphorePermit>,
}

/// A query that is waiting on a driver which does not support concurrent work.
/// It deliberately owns no `ConnectionManager` borrow, so waiting never blocks
/// cancellation, disconnect protection, or queries against other Data Sources.
pub struct QueuedQueryOperation {
    driver: Arc<dyn DatabaseDriver>,
    serial_query_gate: Arc<Semaphore>,
    cancellation: CancellationToken,
}

pub enum QueryOperationStart {
    Ready(QueryOperation),
    Queued(QueuedQueryOperation),
}

impl QueuedQueryOperation {
    pub async fn wait(self) -> Result<QueryOperation, AppError> {
        let permit = tokio::select! {
            permit = self.serial_query_gate.acquire_owned() => permit.map_err(|_| AppError::ConfigError("query queue is unavailable".to_string()))?,
            () = self.cancellation.cancelled() => return Err(AppError::QueryFailed {
                sql: "<queued query>".to_string(),
                message: "query cancelled while waiting for this Data Source".to_string(),
            }),
        };
        Ok(QueryOperation {
            driver: self.driver,
            _serial_permit: Some(permit),
        })
    }
}

const DEFAULT_MAX_LIVE_SESSIONS: usize = 5;
const DEFAULT_IDLE_RECLAIM_AFTER: Duration = Duration::from_secs(30 * 60);

impl ConnectionManager {
    pub fn new() -> Self {
        Self {
            connections: HashMap::new(),
            statuses: HashMap::new(),
            pending_connections: HashSet::new(),
            max_live_sessions: DEFAULT_MAX_LIVE_SESSIONS,
            idle_reclaim_after: Some(DEFAULT_IDLE_RECLAIM_AFTER),
        }
    }

    pub fn set_session_policy(&mut self, max_live_sessions: u8, idle_reclaim_minutes: Option<u16>) {
        self.max_live_sessions = usize::from(max_live_sessions.clamp(1, 20));
        self.idle_reclaim_after = idle_reclaim_minutes
            .map(|minutes| Duration::from_secs(u64::from(minutes.clamp(5, 120)) * 60));
    }

    pub fn begin_connect(
        &mut self,
        connection_id: Uuid,
    ) -> Result<Option<ConnectionStatus>, AppError> {
        if self.connections.contains_key(&connection_id) {
            return Ok(Some(self.set_status(
                connection_id,
                ConnectionRuntimeStatus::Connected,
                None,
            )));
        }
        if self.pending_connections.contains(&connection_id) {
            return Err(AppError::ConfigError(
                "a connection attempt is already in progress for this Data Source".to_string(),
            ));
        }
        self.reclaim_idle_sessions();
        self.reclaim_session_if_needed()?;
        self.pending_connections.insert(connection_id);
        self.set_status(connection_id, ConnectionRuntimeStatus::Connecting, None);
        Ok(None)
    }

    pub(crate) fn finish_connect(
        &mut self,
        connection_id: Uuid,
        result: Result<ActiveConnection, AppError>,
    ) -> Result<ConnectionStatus, AppError> {
        if !self.pending_connections.remove(&connection_id) {
            return Err(AppError::ConfigError(
                "connection attempt was cancelled".to_string(),
            ));
        }
        match result {
            Ok(active) => {
                self.connections.insert(connection_id, active);
                Ok(self.set_status(connection_id, ConnectionRuntimeStatus::Connected, None))
            }
            Err(error) => {
                let message = error.to_string();
                self.set_status(
                    connection_id,
                    ConnectionRuntimeStatus::Failed,
                    Some(message),
                );
                Err(error)
            }
        }
    }

    pub fn disconnect(&mut self, connection_id: Uuid) -> Result<ConnectionStatus, AppError> {
        if self
            .connections
            .get(&connection_id)
            .map(|connection| connection.in_flight_operations > 0)
            .unwrap_or(false)
        {
            return Err(AppError::ConfigError(
                "cannot disconnect while this Data Source has running operations".to_string(),
            ));
        }
        self.connections.remove(&connection_id);
        self.pending_connections.remove(&connection_id);
        Ok(self.set_status(connection_id, ConnectionRuntimeStatus::Disconnected, None))
    }

    pub async fn shutdown_all(&mut self) {
        let drivers = self
            .connections
            .iter()
            .map(|(id, connection)| (*id, connection.driver.clone()))
            .collect::<Vec<_>>();
        let mut known_ids = self.statuses.keys().copied().collect::<Vec<_>>();

        for (_, driver) in &drivers {
            let _ = driver.cancel_all_queries().await;
        }

        self.connections.clear();
        known_ids.extend(drivers.iter().map(|(id, _)| *id));
        known_ids.sort();
        known_ids.dedup();
        for id in known_ids {
            self.set_status(id, ConnectionRuntimeStatus::Disconnected, None);
        }
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
            .map(|connection| connection.driver.clone())
            .ok_or_else(|| AppError::NotFound {
                resource: "active connection".to_string(),
                id: connection_id.to_string(),
            })
    }

    pub fn acquire_driver(
        &mut self,
        connection_id: Uuid,
    ) -> Result<Arc<dyn DatabaseDriver>, AppError> {
        let connection =
            self.connections
                .get_mut(&connection_id)
                .ok_or_else(|| AppError::NotFound {
                    resource: "active connection".to_string(),
                    id: connection_id.to_string(),
                })?;
        connection.in_flight_operations += 1;
        connection.last_used = Instant::now();
        Ok(connection.driver.clone())
    }

    pub fn release_operation(&mut self, connection_id: Uuid) {
        if let Some(connection) = self.connections.get_mut(&connection_id) {
            connection.in_flight_operations = connection.in_flight_operations.saturating_sub(1);
            connection.last_used = Instant::now();
        }
    }

    pub fn begin_query_operation(
        &mut self,
        connection_id: Uuid,
        query_id: &str,
    ) -> Result<QueryOperationStart, AppError> {
        let connection =
            self.connections
                .get_mut(&connection_id)
                .ok_or_else(|| AppError::NotFound {
                    resource: "active connection".to_string(),
                    id: connection_id.to_string(),
                })?;
        connection.last_used = Instant::now();
        if connection.driver.supports_concurrent_queries() {
            connection.in_flight_operations += 1;
            return Ok(QueryOperationStart::Ready(QueryOperation {
                driver: connection.driver.clone(),
                _serial_permit: None,
            }));
        }
        let cancellation = CancellationToken::new();
        connection
            .queued_queries
            .insert(query_id.to_string(), cancellation.clone());
        let driver = connection.driver.clone();
        let serial_query_gate = connection.serial_query_gate.clone();
        match serial_query_gate.clone().try_acquire_owned() {
            Ok(permit) => {
                connection.queued_queries.remove(query_id);
                connection.in_flight_operations += 1;
                Ok(QueryOperationStart::Ready(QueryOperation {
                    driver,
                    _serial_permit: Some(permit),
                }))
            }
            Err(TryAcquireError::NoPermits) => {
                Ok(QueryOperationStart::Queued(QueuedQueryOperation {
                    driver,
                    serial_query_gate,
                    cancellation,
                }))
            }
            Err(TryAcquireError::Closed) => {
                connection.queued_queries.remove(query_id);
                Err(AppError::ConfigError(
                    "query queue is unavailable".to_string(),
                ))
            }
        }
    }

    pub fn activate_queued_query(
        &mut self,
        connection_id: Uuid,
        query_id: &str,
    ) -> Result<(), AppError> {
        let connection =
            self.connections
                .get_mut(&connection_id)
                .ok_or_else(|| AppError::NotFound {
                    resource: "active connection".to_string(),
                    id: connection_id.to_string(),
                })?;
        if connection.queued_queries.remove(query_id).is_none() {
            return Err(AppError::QueryFailed {
                sql: "<queued query>".to_string(),
                message: "query cancelled while waiting for this Data Source".to_string(),
            });
        }
        connection.in_flight_operations += 1;
        connection.last_used = Instant::now();
        Ok(())
    }

    pub fn cancel_queued_query(&mut self, connection_id: Uuid, query_id: &str) -> bool {
        let Some(cancellation) = self
            .connections
            .get_mut(&connection_id)
            .and_then(|connection| connection.queued_queries.remove(query_id))
        else {
            return false;
        };
        cancellation.cancel();
        true
    }

    fn reclaim_session_if_needed(&mut self) -> Result<(), AppError> {
        if self.connections.len() + self.pending_connections.len() < self.max_live_sessions {
            return Ok(());
        }
        let candidate = self.connections.iter()
            .filter(|(_, connection)| connection.in_flight_operations == 0)
            .min_by_key(|(_, connection)| connection.last_used)
            .map(|(id, _)| *id)
            .ok_or_else(|| AppError::ConfigError(format!(
                "Connection Session limit ({}) reached; finish or cancel a running operation before connecting another Data Source", self.max_live_sessions
            )))?;
        self.connections.remove(&candidate);
        self.set_status(
            candidate,
            ConnectionRuntimeStatus::Disconnected,
            Some("reclaimed after inactivity".to_string()),
        );
        Ok(())
    }

    fn reclaim_idle_sessions(&mut self) {
        let Some(idle_after) = self.idle_reclaim_after else {
            return;
        };
        let now = Instant::now();
        let idle = self
            .connections
            .iter()
            .filter(|(_, connection)| {
                connection.in_flight_operations == 0
                    && now.duration_since(connection.last_used) >= idle_after
            })
            .map(|(id, _)| *id)
            .collect::<Vec<_>>();
        for id in idle {
            self.connections.remove(&id);
            self.set_status(
                id,
                ConnectionRuntimeStatus::Disconnected,
                Some("reclaimed after 30 minutes of inactivity".to_string()),
            );
        }
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

pub(crate) async fn create_active_connection(
    config: &ConnectionConfig,
    password: Option<&str>,
    definition: Option<&DriverDefinition>,
) -> Result<ActiveConnection, AppError> {
    let (ssh_tunnel, runtime_config) = open_tunnel(config).await?;
    let driver = create_driver(&runtime_config, password, definition).await?;
    driver.ping().await?;
    Ok(ActiveConnection {
        driver,
        _ssh_tunnel: ssh_tunnel,
        last_used: Instant::now(),
        in_flight_operations: 0,
        serial_query_gate: Arc::new(Semaphore::new(1)),
        queued_queries: HashMap::new(),
    })
}

pub(crate) async fn test_connection(
    config: &ConnectionConfig,
    password: Option<&str>,
    definition: Option<&DriverDefinition>,
) -> Result<(), AppError> {
    let (_tunnel, runtime_config) = open_tunnel(config).await?;
    let driver = create_driver(&runtime_config, password, definition).await?;
    driver.ping().await
}

async fn open_tunnel(
    config: &ConnectionConfig,
) -> Result<(Option<SshTunnel>, ConnectionConfig), AppError> {
    match SshTunnel::open(config).await? {
        Some((tunnel, runtime_config)) => Ok((Some(tunnel), runtime_config)),
        None => Ok((None, config.clone())),
    }
}

async fn create_driver(
    config: &ConnectionConfig,
    password: Option<&str>,
    definition: Option<&DriverDefinition>,
) -> Result<Arc<dyn DatabaseDriver>, AppError> {
    if matches!(
        definition.map(|definition| &definition.backend),
        Some(crate::models::driver_catalog::DriverBackend::Jdbc)
    ) {
        let driver = JdbcDriver::connect(config, password, definition).await?;
        return Ok(Arc::new(driver));
    }

    match config.driver_type {
        DriverType::Postgres => {
            let driver = if let Some(connection_url) = config.connection_url.as_deref() {
                PostgresDriver::connect_with_url_credentials(
                    connection_url,
                    config.username.as_deref(),
                    password,
                )
                .await?
            } else {
                let host = required(config.host.as_deref(), "host")?;
                let port = config.port.unwrap_or(5432);
                let database = required(config.database.as_deref(), "database")?;
                let username = required(config.username.as_deref(), "username")?;
                let password = password.unwrap_or("");
                PostgresDriver::connect_with_params(host, port, database, username, password)
                    .await?
            };
            Ok(Arc::new(driver))
        }
        DriverType::Mysql => {
            let driver = if let Some(connection_url) = config.connection_url.as_deref() {
                MysqlDriver::connect_with_url_credentials(
                    connection_url,
                    config.username.as_deref(),
                    password,
                )
                .await?
            } else {
                let host = required(config.host.as_deref(), "host")?;
                let port = config.port.unwrap_or(3306);
                let database = required(config.database.as_deref(), "database")?;
                let username = required(config.username.as_deref(), "username")?;
                let password = password.unwrap_or("");
                MysqlDriver::connect_with_params(host, port, database, username, password).await?
            };
            Ok(Arc::new(driver))
        }
        DriverType::Oracle => Err(AppError::UnsupportedOperation {
            driver: config.driver_type.to_string(),
            operation: "native oracle connect".to_string(),
        }),
        DriverType::Sqlite => {
            let path = required(config.connection_url.as_deref(), "connection_url")?;
            let driver = SqliteDriver::connect(path).await?;
            Ok(Arc::new(driver))
        }
        DriverType::Mssql => {
            let driver = if let Some(connection_url) = config.connection_url.as_deref() {
                MssqlDriver::connect_with_url_credentials(
                    connection_url,
                    config.username.as_deref(),
                    password,
                )
                .await?
            } else {
                let host = required(config.host.as_deref(), "host")?;
                let port = config.port.unwrap_or(1433);
                let database = config.database.as_deref().unwrap_or("master");
                let username = required(config.username.as_deref(), "username")?;
                let password = password.unwrap_or("");
                MssqlDriver::connect_with_params(host, port, database, username, password).await?
            };
            Ok(Arc::new(driver))
        }
        DriverType::Jdbc => {
            let driver = JdbcDriver::connect(config, password, definition).await?;
            Ok(Arc::new(driver))
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

#[cfg(test)]
mod tests {
    use std::{
        collections::HashMap,
        sync::Arc,
        time::{Duration, Instant},
    };

    use tokio::sync::Semaphore;
    use uuid::Uuid;

    use super::{ActiveConnection, ConnectionManager, QueryOperationStart};
    use crate::{drivers::sqlite::SqliteDriver, models::connection::ConnectionRuntimeStatus};

    async fn sqlite_connection(
        last_used: Instant,
        in_flight_operations: usize,
    ) -> ActiveConnection {
        ActiveConnection {
            driver: Arc::new(
                SqliteDriver::connect(":memory:")
                    .await
                    .expect("in-memory SQLite connection"),
            ),
            _ssh_tunnel: None,
            last_used,
            in_flight_operations,
            serial_query_gate: Arc::new(Semaphore::new(1)),
            queued_queries: HashMap::new(),
        }
    }

    #[tokio::test]
    async fn shutdown_all_marks_known_connections_disconnected() {
        let mut manager = ConnectionManager::new();
        let connection_id = Uuid::new_v4();
        manager.set_status(connection_id, ConnectionRuntimeStatus::Connected, None);

        manager.shutdown_all().await;

        assert!(matches!(
            manager.status(connection_id).status,
            ConnectionRuntimeStatus::Disconnected
        ));
    }

    #[tokio::test]
    async fn reclaims_the_least_recently_used_idle_session_at_capacity() {
        let mut manager = ConnectionManager::new();
        manager.set_session_policy(1, None);
        let oldest = Uuid::new_v4();
        let newest = Uuid::new_v4();
        manager.connections.insert(
            oldest,
            sqlite_connection(Instant::now() - Duration::from_secs(30), 0).await,
        );

        manager
            .reclaim_session_if_needed()
            .expect("idle session can be reclaimed");
        manager
            .connections
            .insert(newest, sqlite_connection(Instant::now(), 0).await);

        assert!(!manager.connections.contains_key(&oldest));
        assert!(manager.connections.contains_key(&newest));
        assert!(matches!(
            manager.status(oldest).status,
            ConnectionRuntimeStatus::Disconnected
        ));
    }

    #[tokio::test]
    async fn never_reclaims_a_busy_session_at_capacity() {
        let mut manager = ConnectionManager::new();
        manager.set_session_policy(1, None);
        let busy = Uuid::new_v4();
        manager.connections.insert(
            busy,
            sqlite_connection(Instant::now() - Duration::from_secs(30), 1).await,
        );

        let error = manager
            .reclaim_session_if_needed()
            .expect_err("busy session must be protected");

        assert!(error.to_string().contains("limit"));
        assert!(manager.connections.contains_key(&busy));
    }

    #[tokio::test]
    async fn idle_reclaim_uses_the_configured_timeout_without_waiting() {
        let mut manager = ConnectionManager::new();
        manager.set_session_policy(5, Some(5));
        let idle = Uuid::new_v4();
        let active = Uuid::new_v4();
        manager.connections.insert(
            idle,
            sqlite_connection(Instant::now() - Duration::from_secs(5 * 60 + 1), 0).await,
        );
        manager
            .connections
            .insert(active, sqlite_connection(Instant::now(), 0).await);

        manager.reclaim_idle_sessions();

        assert!(!manager.connections.contains_key(&idle));
        assert!(manager.connections.contains_key(&active));
        assert!(matches!(
            manager.status(idle).status,
            ConnectionRuntimeStatus::Disconnected
        ));
    }

    #[tokio::test]
    async fn cancelling_a_queued_serial_query_does_not_block_other_data_sources() {
        let mut manager = ConnectionManager::new();
        let serial_source = Uuid::new_v4();
        let independent_source = Uuid::new_v4();
        manager
            .connections
            .insert(serial_source, sqlite_connection(Instant::now(), 0).await);
        manager.connections.insert(
            independent_source,
            sqlite_connection(Instant::now(), 0).await,
        );

        let running = match manager
            .begin_query_operation(serial_source, "running")
            .expect("first query starts")
        {
            QueryOperationStart::Ready(operation) => operation,
            QueryOperationStart::Queued(_) => panic!("first serial query must not queue"),
        };
        let queued = match manager
            .begin_query_operation(serial_source, "queued")
            .expect("second query queues")
        {
            QueryOperationStart::Ready(_) => panic!("second serial query must queue"),
            QueryOperationStart::Queued(operation) => operation,
        };
        assert!(manager.cancel_queued_query(serial_source, "queued"));

        let other_source = manager
            .begin_query_operation(independent_source, "independent")
            .expect("other source is not blocked");
        assert!(matches!(other_source, QueryOperationStart::Ready(_)));
        let queued_result = queued.wait().await;
        assert!(matches!(queued_result, Err(error) if error.to_string().contains("cancelled")));

        drop(running);
        manager.release_operation(serial_source);
        manager.release_operation(independent_source);
    }

    #[tokio::test]
    async fn pending_connections_count_toward_the_session_limit() {
        let mut manager = ConnectionManager::new();
        manager.set_session_policy(1, None);
        let first = Uuid::new_v4();
        let second = Uuid::new_v4();

        assert!(manager
            .begin_connect(first)
            .expect("first attempt starts")
            .is_none());
        let error = manager
            .begin_connect(second)
            .expect_err("second pending attempt must respect the session limit");

        assert!(error.to_string().contains("limit"));
        assert!(matches!(
            manager.status(first).status,
            ConnectionRuntimeStatus::Connecting
        ));
    }

    #[tokio::test]
    async fn disconnect_cancels_a_pending_connection_install() {
        let mut manager = ConnectionManager::new();
        let connection_id = Uuid::new_v4();
        manager
            .begin_connect(connection_id)
            .expect("connection attempt starts");
        let active = sqlite_connection(Instant::now(), 0).await;

        manager
            .disconnect(connection_id)
            .expect("pending connection can be cancelled");
        let error = manager
            .finish_connect(connection_id, Ok(active))
            .expect_err("cancelled attempt must not be installed");

        assert!(error.to_string().contains("cancelled"));
        assert!(matches!(
            manager.status(connection_id).status,
            ConnectionRuntimeStatus::Disconnected
        ));
    }
}
