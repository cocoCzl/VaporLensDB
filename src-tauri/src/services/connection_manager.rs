use std::{
    collections::{HashMap, HashSet},
    sync::{Arc, Mutex, MutexGuard},
    time::{Duration, Instant},
};

use tokio::sync::{OwnedSemaphorePermit, Semaphore, TryAcquireError};
use tokio_util::sync::CancellationToken;

use serde::Serialize;
use uuid::Uuid;

use crate::{
    drivers::{
        jdbc::JdbcDriver, mssql::MssqlDriver, mysql::MysqlDriver, postgres::PostgresDriver,
        sqlite::SqliteDriver, trait_def::DatabaseDriver,
    },
    models::{
        connection::{ConnectionConfig, ConnectionRuntimeStatus, ConnectionStatus, DriverType},
        driver_catalog::DriverDefinition,
        error::{AppError, DisconnectBlockReason},
        metadata::{
            ColumnInfo, DatabaseInfo, DriverCapabilities, ForeignKeyInfo, IndexInfo, SchemaInfo,
            TableInfo,
        },
        query_result::{ExplainResult, QueryResult},
    },
    services::ssh_tunnel::SshTunnel,
};

pub struct ConnectionManager {
    connections: HashMap<Uuid, ActiveConnection>,
    statuses: HashMap<Uuid, ConnectionStatus>,
    pending_connections: HashSet<Uuid>,
    next_generation: u64,
    max_live_sessions: usize,
    idle_reclaim_after: Option<Duration>,
}

pub(crate) struct ActiveConnection {
    driver: Arc<dyn DatabaseDriver>,
    _ssh_tunnel: Option<SshTunnel>,
    activity: ConnectionActivity,
    serial_query_gate: Arc<Semaphore>,
    console_sessions: HashMap<String, ConsoleSession>,
    generation: u64,
}

struct QueryRegistration {
    queued: bool,
    cancellation: CancellationToken,
}

struct OperationRegistry {
    last_used: Instant,
    closed: bool,
    queries: HashMap<String, QueryRegistration>,
}

// The owner is not cloned. Each new physical connection gets a distinct
// registry; leases retain that registry, never look up a connection by ID.
struct ConnectionActivity(Arc<Mutex<OperationRegistry>>);

impl ConnectionActivity {
    fn new(last_used: Instant) -> Self {
        Self(Arc::new(Mutex::new(OperationRegistry {
            last_used,
            closed: false,
            queries: HashMap::new(),
        })))
    }

    fn lock(&self) -> MutexGuard<'_, OperationRegistry> {
        self.0.lock().unwrap_or_else(|error| error.into_inner())
    }
}

impl Drop for ConnectionActivity {
    fn drop(&mut self) {
        let mut registry = self.lock();
        registry.closed = true;
        for entry in registry.queries.values() {
            entry.cancellation.cancel();
        }
    }
}

struct OperationLease {
    registry: Arc<Mutex<OperationRegistry>>,
    query_id: String,
}

impl OperationLease {
    fn activate(&self) -> Result<(), AppError> {
        let mut registry = self
            .registry
            .lock()
            .unwrap_or_else(|error| error.into_inner());
        if registry.closed {
            return Err(AppError::ConfigError(
                "queued query belongs to a retired connection".into(),
            ));
        }
        let entry = registry.queries.get_mut(&self.query_id).ok_or_else(|| {
            AppError::ConfigError("query operation lease is no longer registered".into())
        })?;
        if entry.cancellation.is_cancelled() {
            return Err(queued_query_cancelled());
        }
        entry.queued = false;
        registry.last_used = Instant::now();
        Ok(())
    }
}

impl Drop for OperationLease {
    fn drop(&mut self) {
        let mut registry = self
            .registry
            .lock()
            .unwrap_or_else(|error| error.into_inner());
        registry.queries.remove(&self.query_id);
        registry.last_used = Instant::now();
    }
}

fn queued_query_cancelled() -> AppError {
    AppError::QueryFailed {
        sql: "<queued query>".into(),
        message: "query cancelled while waiting for this Data Source".into(),
    }
}

#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum ConsoleTransactionPhase {
    Idle,
    Active,
    Failed,
}

pub(crate) struct ConsoleSession {
    driver: Arc<dyn DatabaseDriver>,
    _ssh_tunnel: Option<SshTunnel>,
    phase: ConsoleTransactionPhase,
    operation_gate: Arc<Semaphore>,
    active_query: Arc<std::sync::Mutex<Option<String>>>,
}

/// A console has one transaction state and one physical session. Reject
/// overlapping execution/commit/rollback and release occupancy on every exit.
pub struct ConsoleOperation {
    pub driver: Arc<dyn DatabaseDriver>,
    pub phase: ConsoleTransactionPhase,
    pub generation: u64,
    active_query: Arc<std::sync::Mutex<Option<String>>>,
    _permit: OwnedSemaphorePermit,
}

impl Drop for ConsoleOperation {
    fn drop(&mut self) {
        if let Ok(mut query) = self.active_query.lock() {
            *query = None;
        }
    }
}

impl ActiveConnection {
    fn has_running_operations(&self) -> bool {
        !self.activity.lock().queries.is_empty()
            || self
                .console_sessions
                .values()
                .any(|session| session.operation_gate.available_permits() == 0)
    }

    fn has_uncommitted_transaction(&self) -> bool {
        self.console_sessions
            .values()
            .any(|session| session.phase != ConsoleTransactionPhase::Idle)
    }

    fn can_reclaim(&self) -> bool {
        !self.has_running_operations() && !self.has_uncommitted_transaction()
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ConsoleTransactionState {
    pub connection_id: Uuid,
    pub console_id: String,
    pub mode: String,
    pub phase: ConsoleTransactionPhase,
}

/// Keeps a serial-driver permit alive for the complete lifetime of a query.
/// Concurrent drivers intentionally leave this empty.
pub struct QueryOperation {
    pub driver: Arc<dyn DatabaseDriver>,
    pub generation: u64,
    _serial_permit: Option<OwnedSemaphorePermit>,
    _lease: OperationLease,
}

/// A query that is waiting on a driver which does not support concurrent work.
/// It deliberately owns no `ConnectionManager` borrow, so waiting never blocks
/// cancellation, disconnect protection, or queries against other Data Sources.
pub struct QueuedQueryOperation {
    driver: Arc<dyn DatabaseDriver>,
    generation: u64,
    serial_query_gate: Arc<Semaphore>,
    cancellation: CancellationToken,
    lease: OperationLease,
}

pub enum QueryOperationStart {
    Ready(QueryOperation),
    Queued(QueuedQueryOperation),
}

impl QueryOperationStart {
    pub async fn wait(self) -> Result<QueryOperation, AppError> {
        match self {
            Self::Ready(operation) => {
                // A background task may start after its source was retired,
                // even when no semaphore wait was necessary at registration.
                operation._lease.activate()?;
                Ok(operation)
            }
            Self::Queued(operation) => operation.wait().await,
        }
    }
}

impl QueuedQueryOperation {
    pub async fn wait(self) -> Result<QueryOperation, AppError> {
        let permit = tokio::select! {
            biased;
            () = self.cancellation.cancelled() => return Err(queued_query_cancelled()),
            permit = self.serial_query_gate.acquire_owned() => permit.map_err(|_| AppError::ConfigError("query queue is unavailable".to_string()))?,
        };
        self.lease.activate()?;
        Ok(QueryOperation {
            driver: self.driver,
            generation: self.generation,
            _serial_permit: Some(permit),
            _lease: self.lease,
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
            next_generation: 1,
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
            Ok(mut active) => {
                active.generation = self.next_generation;
                self.next_generation = self.next_generation.saturating_add(1);
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
            .map(ActiveConnection::has_running_operations)
            .unwrap_or(false)
        {
            return Err(AppError::DisconnectBlocked {
                reason: DisconnectBlockReason::RunningOperations,
            });
        }
        if self
            .connections
            .get(&connection_id)
            .is_some_and(ActiveConnection::has_uncommitted_transaction)
        {
            return Err(AppError::DisconnectBlocked {
                reason: DisconnectBlockReason::UncommittedTransaction,
            });
        }
        self.connections.remove(&connection_id);
        self.pending_connections.remove(&connection_id);
        Ok(self.set_status(connection_id, ConnectionRuntimeStatus::Disconnected, None))
    }

    /// Retire a runtime driver that has become unusable (for example, a JDBC
    /// sidecar whose underlying connection was closed). The saved Data Source
    /// remains intact; the next connect creates a fresh runtime session.
    pub fn invalidate_connection(&mut self, connection_id: Uuid, reason: &str) {
        self.connections.remove(&connection_id);
        self.pending_connections.remove(&connection_id);
        self.set_status(
            connection_id,
            ConnectionRuntimeStatus::Disconnected,
            Some(reason.to_string()),
        );
    }

    pub fn invalidate_connection_generation(
        &mut self,
        connection_id: Uuid,
        generation: u64,
        reason: &str,
    ) -> bool {
        if self
            .connections
            .get(&connection_id)
            .is_none_or(|connection| connection.generation != generation)
        {
            return false;
        }
        self.invalidate_connection(connection_id, reason);
        true
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

    pub async fn get_databases(
        &mut self,
        connection_id: Uuid,
    ) -> Result<Vec<DatabaseInfo>, AppError> {
        self.begin_query_operation(
            connection_id,
            &format!("manager-metadata-{}", Uuid::new_v4()),
        )?
        .wait()
        .await?
        .driver
        .get_databases()
        .await
    }

    pub async fn get_schemas(
        &mut self,
        connection_id: Uuid,
        database: Option<&str>,
    ) -> Result<Vec<SchemaInfo>, AppError> {
        self.begin_query_operation(
            connection_id,
            &format!("manager-metadata-{}", Uuid::new_v4()),
        )?
        .wait()
        .await?
        .driver
        .get_schemas(database)
        .await
    }

    pub async fn get_tables(
        &mut self,
        connection_id: Uuid,
        schema: &str,
    ) -> Result<Vec<TableInfo>, AppError> {
        self.begin_query_operation(
            connection_id,
            &format!("manager-metadata-{}", Uuid::new_v4()),
        )?
        .wait()
        .await?
        .driver
        .get_tables(schema)
        .await
    }

    pub async fn get_columns(
        &mut self,
        connection_id: Uuid,
        schema: &str,
        table: &str,
    ) -> Result<Vec<ColumnInfo>, AppError> {
        self.begin_query_operation(
            connection_id,
            &format!("manager-metadata-{}", Uuid::new_v4()),
        )?
        .wait()
        .await?
        .driver
        .get_columns(schema, table)
        .await
    }

    pub async fn get_indexes(
        &mut self,
        connection_id: Uuid,
        schema: &str,
        table: &str,
    ) -> Result<Vec<IndexInfo>, AppError> {
        self.begin_query_operation(
            connection_id,
            &format!("manager-metadata-{}", Uuid::new_v4()),
        )?
        .wait()
        .await?
        .driver
        .get_indexes(schema, table)
        .await
    }

    pub async fn get_foreign_keys(
        &mut self,
        connection_id: Uuid,
        schema: &str,
        table: &str,
    ) -> Result<Vec<ForeignKeyInfo>, AppError> {
        self.begin_query_operation(
            connection_id,
            &format!("manager-metadata-{}", Uuid::new_v4()),
        )?
        .wait()
        .await?
        .driver
        .get_foreign_keys(schema, table)
        .await
    }

    pub async fn get_views(
        &mut self,
        connection_id: Uuid,
        schema: &str,
    ) -> Result<Vec<TableInfo>, AppError> {
        self.begin_query_operation(
            connection_id,
            &format!("manager-metadata-{}", Uuid::new_v4()),
        )?
        .wait()
        .await?
        .driver
        .get_views(schema)
        .await
    }

    pub async fn get_functions(
        &mut self,
        connection_id: Uuid,
        schema: &str,
    ) -> Result<Vec<String>, AppError> {
        self.begin_query_operation(
            connection_id,
            &format!("manager-metadata-{}", Uuid::new_v4()),
        )?
        .wait()
        .await?
        .driver
        .get_functions(schema)
        .await
    }

    pub async fn execute_query(
        &mut self,
        connection_id: Uuid,
        sql: &str,
    ) -> Result<QueryResult, AppError> {
        self.begin_query_operation(
            connection_id,
            &format!("manager-execute-{}", Uuid::new_v4()),
        )?
        .wait()
        .await?
        .driver
        .execute_query(sql, None)
        .await
    }

    pub async fn explain_query(
        &mut self,
        connection_id: Uuid,
        sql: &str,
    ) -> Result<ExplainResult, AppError> {
        self.begin_query_operation(
            connection_id,
            &format!("manager-explain-{}", Uuid::new_v4()),
        )?
        .wait()
        .await?
        .driver
        .explain_query(sql)
        .await
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

    pub fn capabilities(&self, connection_id: Uuid) -> Result<DriverCapabilities, AppError> {
        Ok(self.driver(connection_id)?.capabilities())
    }

    pub fn connection_generation(&self, connection_id: Uuid) -> Result<u64, AppError> {
        self.connections
            .get(&connection_id)
            .map(|connection| connection.generation)
            .ok_or_else(|| AppError::NotFound {
                resource: "active connection".to_string(),
                id: connection_id.to_string(),
            })
    }

    pub fn console_transaction_state(
        &self,
        connection_id: Uuid,
        console_id: &str,
    ) -> ConsoleTransactionState {
        let session = self
            .connections
            .get(&connection_id)
            .and_then(|connection| connection.console_sessions.get(console_id));
        ConsoleTransactionState {
            connection_id,
            console_id: console_id.to_string(),
            mode: if session.is_some() {
                "manual".to_string()
            } else {
                "auto".to_string()
            },
            phase: session
                .map(|value| value.phase)
                .unwrap_or(ConsoleTransactionPhase::Idle),
        }
    }

    pub(crate) fn install_console_session(
        &mut self,
        connection_id: Uuid,
        console_id: String,
        active: ActiveConnection,
    ) -> Result<ConsoleTransactionState, AppError> {
        let connection =
            self.connections
                .get_mut(&connection_id)
                .ok_or_else(|| AppError::NotFound {
                    resource: "active connection".to_string(),
                    id: connection_id.to_string(),
                })?;
        if connection.console_sessions.contains_key(&console_id) {
            return Ok(ConsoleTransactionState {
                connection_id,
                console_id,
                mode: "manual".to_string(),
                phase: ConsoleTransactionPhase::Idle,
            });
        }
        connection.console_sessions.insert(
            console_id.clone(),
            ConsoleSession {
                driver: active.driver,
                _ssh_tunnel: active._ssh_tunnel,
                phase: ConsoleTransactionPhase::Idle,
                operation_gate: Arc::new(Semaphore::new(1)),
                active_query: Arc::new(std::sync::Mutex::new(None)),
            },
        );
        Ok(ConsoleTransactionState {
            connection_id,
            console_id,
            mode: "manual".to_string(),
            phase: ConsoleTransactionPhase::Idle,
        })
    }

    pub fn remove_console_session(
        &mut self,
        connection_id: Uuid,
        console_id: &str,
    ) -> Result<(), AppError> {
        let connection =
            self.connections
                .get_mut(&connection_id)
                .ok_or_else(|| AppError::NotFound {
                    resource: "active connection".to_string(),
                    id: connection_id.to_string(),
                })?;
        if connection
            .console_sessions
            .get(console_id)
            .is_some_and(|session| {
                session.phase != ConsoleTransactionPhase::Idle
                    || session.operation_gate.available_permits() == 0
            })
        {
            return Err(AppError::ConfigError(
                "commit or rollback the active transaction before switching to Auto".to_string(),
            ));
        }
        connection.console_sessions.remove(console_id);
        Ok(())
    }

    pub fn console_driver(
        &self,
        connection_id: Uuid,
        console_id: &str,
    ) -> Result<Arc<dyn DatabaseDriver>, AppError> {
        self.connections
            .get(&connection_id)
            .and_then(|connection| connection.console_sessions.get(console_id))
            .map(|session| session.driver.clone())
            .ok_or_else(|| AppError::NotFound {
                resource: "SQL Console session".to_string(),
                id: console_id.to_string(),
            })
    }

    pub fn begin_console_operation(
        &mut self,
        connection_id: Uuid,
        console_id: &str,
        query_id: Option<&str>,
    ) -> Result<ConsoleOperation, AppError> {
        let connection =
            self.connections
                .get_mut(&connection_id)
                .ok_or_else(|| AppError::NotFound {
                    resource: "active connection".into(),
                    id: connection_id.to_string(),
                })?;
        let session =
            connection
                .console_sessions
                .get(console_id)
                .ok_or_else(|| AppError::NotFound {
                    resource: "SQL Console session".into(),
                    id: console_id.to_string(),
                })?;
        let permit = session.operation_gate.clone().try_acquire_owned().map_err(|_| AppError::ConfigError(
            "SQL Console is busy; wait for the current operation before executing or changing its transaction".into()
        ))?;
        *session
            .active_query
            .lock()
            .map_err(|_| AppError::ConfigError("console query registry is poisoned".into()))? =
            query_id.map(str::to_owned);
        connection.activity.lock().last_used = Instant::now();
        Ok(ConsoleOperation {
            driver: session.driver.clone(),
            phase: session.phase,
            generation: connection.generation,
            active_query: session.active_query.clone(),
            _permit: permit,
        })
    }

    pub fn query_driver(
        &self,
        connection_id: Uuid,
        query_id: &str,
    ) -> Result<Arc<dyn DatabaseDriver>, AppError> {
        if let Some(connection) = self.connections.get(&connection_id) {
            for session in connection.console_sessions.values() {
                let query = session.active_query.lock().map_err(|_| {
                    AppError::ConfigError("console query registry is poisoned".into())
                })?;
                if query.as_deref() == Some(query_id) {
                    return Ok(session.driver.clone());
                }
            }
        }
        self.driver(connection_id)
    }

    pub fn set_console_phase(
        &mut self,
        connection_id: Uuid,
        console_id: &str,
        phase: ConsoleTransactionPhase,
    ) {
        if let Some(session) = self
            .connections
            .get_mut(&connection_id)
            .and_then(|connection| connection.console_sessions.get_mut(console_id))
        {
            session.phase = phase;
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
                    resource: "active connection".into(),
                    id: connection_id.to_string(),
                })?;
        let cancellation = CancellationToken::new();
        {
            let mut registry = connection.activity.lock();
            if registry.queries.contains_key(query_id) {
                return Err(AppError::ConfigError(
                    "query ID is already in use for this connection".into(),
                ));
            }
            registry.last_used = Instant::now();
            registry.queries.insert(
                query_id.to_string(),
                QueryRegistration {
                    queued: true,
                    cancellation: cancellation.clone(),
                },
            );
        }
        let lease = OperationLease {
            registry: connection.activity.0.clone(),
            query_id: query_id.to_string(),
        };
        let driver = connection.driver.clone();
        if driver.supports_concurrent_queries() {
            lease.activate()?;
            return Ok(QueryOperationStart::Ready(QueryOperation {
                driver,
                generation: connection.generation,
                _serial_permit: None,
                _lease: lease,
            }));
        }
        let serial_query_gate = connection.serial_query_gate.clone();
        match serial_query_gate.clone().try_acquire_owned() {
            Ok(permit) => {
                lease.activate()?;
                Ok(QueryOperationStart::Ready(QueryOperation {
                    driver,
                    generation: connection.generation,
                    _serial_permit: Some(permit),
                    _lease: lease,
                }))
            }
            Err(TryAcquireError::NoPermits) => {
                Ok(QueryOperationStart::Queued(QueuedQueryOperation {
                    driver,
                    generation: connection.generation,
                    serial_query_gate,
                    cancellation,
                    lease,
                }))
            }
            Err(TryAcquireError::Closed) => {
                Err(AppError::ConfigError("query queue is unavailable".into()))
            }
        }
    }

    pub fn cancel_queued_query(&mut self, connection_id: Uuid, query_id: &str) -> bool {
        let Some(connection) = self.connections.get(&connection_id) else {
            return false;
        };
        let registry = connection.activity.lock();
        let Some(entry) = registry.queries.get(query_id).filter(|entry| entry.queued) else {
            return false;
        };
        // Retain occupancy until the queued future actually drops its lease.
        entry.cancellation.cancel();
        true
    }

    fn reclaim_session_if_needed(&mut self) -> Result<(), AppError> {
        if self.connections.len() + self.pending_connections.len() < self.max_live_sessions {
            return Ok(());
        }
        let candidate = self.connections.iter()
            .filter(|(_, connection)| connection.can_reclaim())
            .min_by_key(|(_, connection)| connection.activity.lock().last_used)
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
                connection.can_reclaim()
                    && now.saturating_duration_since(connection.activity.lock().last_used)
                        >= idle_after
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
    super::connection_tls::validate_connection_tls(config, definition)?;
    let (ssh_tunnel, runtime_config) = open_tunnel(config).await?;
    let driver = create_driver(&runtime_config, password, definition).await?;
    driver.ping().await?;
    Ok(ActiveConnection {
        driver,
        _ssh_tunnel: ssh_tunnel,
        activity: ConnectionActivity::new(Instant::now()),
        serial_query_gate: Arc::new(Semaphore::new(1)),
        console_sessions: HashMap::new(),
        generation: 0,
    })
}

pub(crate) async fn test_connection(
    config: &ConnectionConfig,
    password: Option<&str>,
    definition: Option<&DriverDefinition>,
) -> Result<(), AppError> {
    super::connection_tls::validate_connection_tls(config, definition)?;
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
                PostgresDriver::connect_with_params_tls(
                    host,
                    port,
                    database,
                    username,
                    password,
                    config.ssl_mode.as_deref(),
                )
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
                // A MySQL server-level connection intentionally has no default
                // database. It is valid for database browsing and lets the
                // workspace select a database after connecting.
                let database = config.database.as_deref().unwrap_or("");
                let username = required(config.username.as_deref(), "username")?;
                let password = password.unwrap_or("");
                MysqlDriver::connect_with_params_tls(
                    host,
                    port,
                    database,
                    username,
                    password,
                    config.ssl_mode.as_deref(),
                )
                .await?
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

    use super::{
        ActiveConnection, ConnectionActivity, ConnectionManager, ConsoleTransactionPhase,
        QueryOperationStart,
    };
    use crate::{
        drivers::sqlite::SqliteDriver,
        models::{
            connection::ConnectionRuntimeStatus,
            error::{AppError, DisconnectBlockReason},
        },
    };

    async fn sqlite_connection(
        last_used: Instant,
        in_flight_operations: usize,
    ) -> ActiveConnection {
        let activity = ConnectionActivity::new(last_used);
        for index in 0..in_flight_operations {
            activity.lock().queries.insert(
                format!("test-occupied-{index}"),
                super::QueryRegistration {
                    queued: false,
                    cancellation: tokio_util::sync::CancellationToken::new(),
                },
            );
        }
        ActiveConnection {
            driver: Arc::new(
                SqliteDriver::connect(":memory:")
                    .await
                    .expect("in-memory SQLite connection"),
            ),
            _ssh_tunnel: None,
            activity,
            serial_query_gate: Arc::new(Semaphore::new(1)),
            console_sessions: HashMap::new(),
            generation: 0,
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
    async fn invalidating_a_stale_connection_allows_a_fresh_connect() {
        let mut manager = ConnectionManager::new();
        let connection_id = Uuid::new_v4();
        manager
            .begin_connect(connection_id)
            .expect("connection attempt starts");
        manager
            .finish_connect(
                connection_id,
                Ok(sqlite_connection(Instant::now(), 0).await),
            )
            .expect("connection installs");

        manager.invalidate_connection(connection_id, "driver session became unusable");

        assert!(matches!(
            manager.status(connection_id).status,
            ConnectionRuntimeStatus::Disconnected
        ));
        assert!(manager
            .begin_connect(connection_id)
            .expect("fresh connection attempt starts")
            .is_none());
    }

    #[tokio::test]
    async fn legacy_manager_driver_wrappers_execute_inside_operation_leases() {
        let mut manager = ConnectionManager::new();
        let connection_id = Uuid::new_v4();
        manager.begin_connect(connection_id).unwrap();
        manager
            .finish_connect(
                connection_id,
                Ok(sqlite_connection(Instant::now(), 0).await),
            )
            .unwrap();

        manager
            .execute_query(
                connection_id,
                "CREATE TABLE lease_wrapper (id INTEGER PRIMARY KEY)",
            )
            .await
            .unwrap();
        let tables = manager.get_tables(connection_id, "main").await.unwrap();
        assert_eq!(
            tables
                .iter()
                .filter(|table| table.name == "lease_wrapper")
                .count(),
            1
        );
        assert!(!manager
            .connections
            .get(&connection_id)
            .expect("connection remains active")
            .has_running_operations());
        manager.disconnect(connection_id).unwrap();
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
    async fn active_and_failed_transactions_survive_both_reclaim_paths() {
        for phase in [
            ConsoleTransactionPhase::Active,
            ConsoleTransactionPhase::Failed,
        ] {
            let mut manager = ConnectionManager::new();
            manager.set_session_policy(1, Some(5));
            let id = Uuid::new_v4();
            manager.connections.insert(
                id,
                sqlite_connection(Instant::now() - Duration::from_secs(3600), 0).await,
            );
            manager
                .install_console_session(
                    id,
                    "console".into(),
                    sqlite_connection(Instant::now(), 0).await,
                )
                .unwrap();
            manager.set_console_phase(id, "console", phase);
            assert!(manager.begin_connect(Uuid::new_v4()).is_err());
            assert!(manager.connections.contains_key(&id));
            assert_eq!(
                manager.console_transaction_state(id, "console").phase,
                phase
            );
            assert!(manager.disconnect(id).is_err());
            manager.set_console_phase(id, "console", ConsoleTransactionPhase::Idle);
            manager.reclaim_idle_sessions();
            assert!(!manager.connections.contains_key(&id));
        }
    }

    #[tokio::test]
    async fn console_lease_blocks_close_reclaim_and_overlapping_transaction_control() {
        let mut manager = ConnectionManager::new();
        manager.set_session_policy(1, Some(5));
        let id = Uuid::new_v4();
        manager
            .connections
            .insert(id, sqlite_connection(Instant::now(), 0).await);
        manager
            .install_console_session(
                id,
                "console".into(),
                sqlite_connection(Instant::now(), 0).await,
            )
            .unwrap();
        let operation = manager
            .begin_console_operation(id, "console", Some("query-a"))
            .unwrap();
        assert!(manager
            .begin_console_operation(id, "console", None)
            .is_err());
        assert!(manager.remove_console_session(id, "console").is_err());
        assert!(manager.disconnect(id).is_err());
        assert!(manager.reclaim_session_if_needed().is_err());
        assert!(Arc::ptr_eq(
            &operation.driver,
            &manager.query_driver(id, "query-a").unwrap()
        ));
        assert!(!Arc::ptr_eq(
            &operation.driver,
            &manager.query_driver(id, "unrelated").unwrap()
        ));
        // Models early-return/cancellation: no explicit release call is needed.
        drop(operation);
        assert!(Arc::ptr_eq(
            &manager.driver(id).unwrap(),
            &manager.query_driver(id, "query-a").unwrap()
        ));
        let commit = manager
            .begin_console_operation(id, "console", None)
            .unwrap();
        assert!(manager
            .begin_console_operation(id, "console", Some("query-b"))
            .is_err());
        drop(commit);
        manager.remove_console_session(id, "console").unwrap();
        manager.disconnect(id).unwrap();
    }

    #[tokio::test]
    async fn stale_query_failure_cannot_invalidate_a_new_generation() {
        let mut manager = ConnectionManager::new();
        let id = Uuid::new_v4();
        manager.begin_connect(id).unwrap();
        manager
            .finish_connect(id, Ok(sqlite_connection(Instant::now(), 0).await))
            .unwrap();
        let generation = manager.connections[&id].generation;
        manager.invalidate_connection(id, "test reconnect");
        manager.begin_connect(id).unwrap();
        manager
            .finish_connect(id, Ok(sqlite_connection(Instant::now(), 0).await))
            .unwrap();
        assert!(!manager.invalidate_connection_generation(id, generation, "late failure"));
        assert!(matches!(
            manager.status(id).status,
            ConnectionRuntimeStatus::Connected
        ));
        let current = manager.connections[&id].generation;
        assert!(manager.invalidate_connection_generation(id, current, "current failure"));
        assert!(!manager.connections.contains_key(&id));
    }

    #[tokio::test]
    async fn dropping_queued_work_and_aborted_waiters_releases_registration() {
        let mut manager = ConnectionManager::new();
        let id = Uuid::new_v4();
        manager
            .connections
            .insert(id, sqlite_connection(Instant::now(), 0).await);
        let running = manager.begin_query_operation(id, "running").unwrap();
        let unpolled = manager.begin_query_operation(id, "unpolled").unwrap();
        drop(unpolled);
        assert!(!manager.cancel_queued_query(id, "unpolled"));
        let QueryOperationStart::Queued(waiting) =
            manager.begin_query_operation(id, "waiting").unwrap()
        else {
            panic!("must queue")
        };
        let worker = tokio::spawn(waiting.wait());
        worker.abort();
        assert!(worker.await.is_err());
        assert!(!manager.cancel_queued_query(id, "waiting"));
        assert!(manager.disconnect(id).is_err());
        drop(running);
        manager.disconnect(id).unwrap();
    }

    #[tokio::test]
    async fn old_query_leases_and_waiters_cannot_modify_a_reconnected_generation() {
        let mut manager = ConnectionManager::new();
        let id = Uuid::new_v4();
        manager
            .connections
            .insert(id, sqlite_connection(Instant::now(), 0).await);
        let running = manager.begin_query_operation(id, "reused").unwrap();
        let QueryOperationStart::Queued(old_waiter) =
            manager.begin_query_operation(id, "queued").unwrap()
        else {
            panic!("must queue")
        };
        manager.invalidate_connection(id, "test reconnect");
        manager
            .connections
            .insert(id, sqlite_connection(Instant::now(), 0).await);
        let replacement = manager.begin_query_operation(id, "reused").unwrap();
        let replacement_queue = manager.begin_query_operation(id, "queued").unwrap();
        drop(running);
        assert!(old_waiter.wait().await.is_err());
        assert_eq!(manager.connections[&id].activity.lock().queries.len(), 2);
        assert!(manager.disconnect(id).is_err());
        drop(replacement_queue);
        drop(replacement);
        manager.disconnect(id).unwrap();
    }

    #[tokio::test]
    async fn cancellation_wins_when_a_queued_permit_is_already_ready() {
        let mut manager = ConnectionManager::new();
        let id = Uuid::new_v4();
        manager
            .connections
            .insert(id, sqlite_connection(Instant::now(), 0).await);
        let running = manager.begin_query_operation(id, "running").unwrap();
        let QueryOperationStart::Queued(waiter) =
            manager.begin_query_operation(id, "queued").unwrap()
        else {
            panic!("must queue")
        };
        manager.cancel_queued_query(id, "queued");
        drop(running);
        assert!(manager.disconnect(id).is_err());
        assert!(waiter.wait().await.is_err());
        manager.disconnect(id).unwrap();
    }

    #[tokio::test]
    async fn duplicate_ids_cannot_replace_live_registrations() {
        let mut manager = ConnectionManager::new();
        let id = Uuid::new_v4();
        manager
            .connections
            .insert(id, sqlite_connection(Instant::now(), 0).await);
        let running = manager.begin_query_operation(id, "running").unwrap();
        assert!(manager.begin_query_operation(id, "running").is_err());
        let queued = manager.begin_query_operation(id, "queued").unwrap();
        assert!(manager.begin_query_operation(id, "queued").is_err());
        assert!(manager.cancel_queued_query(id, "queued"));
        drop(queued);
        drop(running);
        assert!(manager.begin_query_operation(id, "running").is_ok());
        manager.disconnect(id).unwrap();
    }

    #[tokio::test]
    async fn releasing_an_operation_refreshes_idle_time_and_closed_gate_does_not_leak() {
        let mut manager = ConnectionManager::new();
        let id = Uuid::new_v4();
        manager
            .connections
            .insert(id, sqlite_connection(Instant::now(), 0).await);
        let running = manager.begin_query_operation(id, "running").unwrap();
        let before_release = Instant::now();
        drop(running);
        assert!(manager.connections[&id].activity.lock().last_used >= before_release);
        manager.connections[&id].serial_query_gate.close();
        assert!(manager.begin_query_operation(id, "closed").is_err());
        manager.disconnect(id).unwrap();
    }

    #[tokio::test]
    async fn queued_queries_protect_the_gap_between_running_operations() {
        let mut manager = ConnectionManager::new();
        manager.set_session_policy(1, None);
        let id = Uuid::new_v4();
        manager
            .connections
            .insert(id, sqlite_connection(Instant::now(), 0).await);
        let QueryOperationStart::Ready(first) = manager.begin_query_operation(id, "first").unwrap()
        else {
            panic!("first must run")
        };
        let QueryOperationStart::Queued(second) =
            manager.begin_query_operation(id, "second").unwrap()
        else {
            panic!("second must queue")
        };
        drop(first);
        assert!(manager.disconnect(id).is_err());
        assert!(manager.reclaim_session_if_needed().is_err());
        let second = second.wait().await.unwrap();
        drop(second);
        manager.disconnect(id).unwrap();
    }

    #[tokio::test]
    async fn dropping_an_old_console_lease_does_not_clear_a_reconnected_query() {
        let mut manager = ConnectionManager::new();
        let id = Uuid::new_v4();
        manager
            .connections
            .insert(id, sqlite_connection(Instant::now(), 0).await);
        manager
            .install_console_session(
                id,
                "console".into(),
                sqlite_connection(Instant::now(), 0).await,
            )
            .unwrap();
        let old = manager
            .begin_console_operation(id, "console", Some("old"))
            .unwrap();
        manager.invalidate_connection(id, "test disconnect");
        manager
            .connections
            .insert(id, sqlite_connection(Instant::now(), 0).await);
        manager
            .install_console_session(
                id,
                "console".into(),
                sqlite_connection(Instant::now(), 0).await,
            )
            .unwrap();
        let new = manager
            .begin_console_operation(id, "console", Some("new"))
            .unwrap();
        drop(old);
        assert!(Arc::ptr_eq(
            &new.driver,
            &manager.query_driver(id, "new").unwrap()
        ));
        assert!(manager.disconnect(id).is_err());
        drop(new);
        manager.disconnect(id).unwrap();
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
        drop(other_source);
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

    #[tokio::test]
    async fn disconnect_reports_structured_running_operation_and_transaction_blocks() {
        let mut manager = ConnectionManager::new();
        let running_connection = Uuid::new_v4();
        manager.connections.insert(
            running_connection,
            sqlite_connection(Instant::now(), 1).await,
        );

        let running_error = manager
            .disconnect(running_connection)
            .expect_err("running work must block disconnect");
        assert!(matches!(
            running_error,
            AppError::DisconnectBlocked {
                reason: DisconnectBlockReason::RunningOperations
            }
        ));
        assert!(manager.connections.contains_key(&running_connection));

        let transaction_connection = Uuid::new_v4();
        manager.connections.insert(
            transaction_connection,
            sqlite_connection(Instant::now(), 0).await,
        );
        manager
            .install_console_session(
                transaction_connection,
                "transaction-tab".to_string(),
                sqlite_connection(Instant::now(), 0).await,
            )
            .expect("install console session");
        manager.set_console_phase(
            transaction_connection,
            "transaction-tab",
            ConsoleTransactionPhase::Active,
        );

        let transaction_error = manager
            .disconnect(transaction_connection)
            .expect_err("uncommitted transaction must block disconnect");
        assert!(matches!(
            transaction_error,
            AppError::DisconnectBlocked {
                reason: DisconnectBlockReason::UncommittedTransaction
            }
        ));
        assert!(manager.connections.contains_key(&transaction_connection));
    }

    #[tokio::test]
    async fn reconnect_can_reinstall_a_manual_console_for_the_same_tab() {
        let mut manager = ConnectionManager::new();
        let connection_id = Uuid::new_v4();
        let first_tab_id = "existing-sql-tab-a";
        let second_tab_id = "existing-sql-tab-b";
        manager
            .connections
            .insert(connection_id, sqlite_connection(Instant::now(), 0).await);
        manager
            .install_console_session(
                connection_id,
                first_tab_id.to_string(),
                sqlite_connection(Instant::now(), 0).await,
            )
            .expect("initial tab console installs");
        manager
            .install_console_session(
                connection_id,
                second_tab_id.to_string(),
                sqlite_connection(Instant::now(), 0).await,
            )
            .expect("second initial tab console installs");

        manager
            .disconnect(connection_id)
            .expect("idle manual console permits disconnect");
        manager
            .begin_connect(connection_id)
            .expect("reconnect starts");
        manager
            .finish_connect(
                connection_id,
                Ok(sqlite_connection(Instant::now(), 0).await),
            )
            .expect("reconnect installs a fresh runtime");

        manager
            .install_console_session(
                connection_id,
                first_tab_id.to_string(),
                sqlite_connection(Instant::now(), 0).await,
            )
            .expect("same logical tab can receive a fresh console runtime");
        manager
            .install_console_session(
                connection_id,
                second_tab_id.to_string(),
                sqlite_connection(Instant::now(), 0).await,
            )
            .expect("second logical tab can receive an independent fresh console runtime");
        assert!(manager.console_driver(connection_id, first_tab_id).is_ok());
        assert!(manager.console_driver(connection_id, second_tab_id).is_ok());
        assert_eq!(
            manager
                .console_transaction_state(connection_id, first_tab_id)
                .phase,
            ConsoleTransactionPhase::Idle
        );
    }
}
