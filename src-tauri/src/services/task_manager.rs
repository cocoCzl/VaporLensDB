use std::{collections::HashMap, sync::Arc};

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use tokio::sync::{watch, Mutex};
use uuid::Uuid;

use crate::{models::error::AppError, utils::error_redaction::sanitize_diagnostic_error};

#[derive(Clone, Default)]
pub struct TaskManager {
    inner: Arc<Mutex<HashMap<Uuid, TaskRecord>>>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum TaskStatus {
    Pending,
    Running,
    Cancelling,
    Cancelled,
    Succeeded,
    Failed,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TaskProgress {
    pub current: u64,
    pub total: Option<u64>,
    pub message: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TaskLogEntry {
    pub at: DateTime<Utc>,
    pub message: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TaskInfo {
    pub id: Uuid,
    pub kind: String,
    pub title: String,
    pub status: TaskStatus,
    pub progress: TaskProgress,
    pub logs: Vec<TaskLogEntry>,
    pub error: Option<String>,
    pub output_path: Option<String>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
    pub finished_at: Option<DateTime<Utc>>,
}

#[derive(Clone)]
pub struct TaskHandle {
    pub id: Uuid,
    cancel_requested: watch::Sender<bool>,
}

pub struct ScopedTaskRegistration {
    manager: TaskManager,
    handle: TaskHandle,
    registration_id: Uuid,
    cleaned: bool,
}

struct TaskRecord {
    info: TaskInfo,
    cancel_requested: watch::Sender<bool>,
    registration_id: Uuid,
}

impl TaskManager {
    pub fn new() -> Self {
        Self::default()
    }

    pub async fn create_task(&self, kind: &str, title: &str, total: Option<u64>) -> TaskInfo {
        self.create_task_with_output(kind, title, total, None).await
    }

    pub async fn create_task_with_output(
        &self,
        kind: &str,
        title: &str,
        total: Option<u64>,
        output_path: Option<String>,
    ) -> TaskInfo {
        let now = Utc::now();
        let info = TaskInfo {
            id: Uuid::new_v4(),
            kind: kind.to_string(),
            title: title.to_string(),
            status: TaskStatus::Pending,
            progress: TaskProgress {
                current: 0,
                total,
                message: None,
            },
            logs: vec![TaskLogEntry {
                at: now,
                message: "Task created".to_string(),
            }],
            error: None,
            output_path,
            created_at: now,
            updated_at: now,
            finished_at: None,
        };

        self.inner.lock().await.insert(
            info.id,
            TaskRecord {
                info: info.clone(),
                cancel_requested: watch::channel(false).0,
                registration_id: Uuid::new_v4(),
            },
        );

        info
    }

    pub async fn register_scoped_task(
        &self,
        id: Uuid,
        kind: &str,
        title: &str,
    ) -> Result<ScopedTaskRegistration, AppError> {
        let now = Utc::now();
        let registration_id = Uuid::new_v4();
        let cancel_requested = watch::channel(false).0;
        let info = TaskInfo {
            id,
            kind: kind.to_string(),
            title: title.to_string(),
            status: TaskStatus::Running,
            progress: TaskProgress {
                current: 0,
                total: None,
                message: Some("Running".to_string()),
            },
            logs: vec![TaskLogEntry {
                at: now,
                message: "Task started".to_string(),
            }],
            error: None,
            output_path: None,
            created_at: now,
            updated_at: now,
            finished_at: None,
        };
        let mut tasks = self.inner.lock().await;
        if tasks.contains_key(&id) {
            return Err(AppError::ConfigError(format!(
                "Task ID is already active: {id}"
            )));
        }
        tasks.insert(
            id,
            TaskRecord {
                info,
                cancel_requested: cancel_requested.clone(),
                registration_id,
            },
        );
        drop(tasks);
        Ok(ScopedTaskRegistration {
            manager: self.clone(),
            handle: TaskHandle {
                id,
                cancel_requested,
            },
            registration_id,
            cleaned: false,
        })
    }

    async fn remove_registration(&self, id: Uuid, registration_id: Uuid) {
        let mut tasks = self.inner.lock().await;
        if tasks
            .get(&id)
            .is_some_and(|record| record.registration_id == registration_id)
        {
            tasks.remove(&id);
        }
    }

    pub async fn handle(&self, id: Uuid) -> Result<TaskHandle, AppError> {
        let tasks = self.inner.lock().await;
        let record = tasks.get(&id).ok_or_else(|| AppError::NotFound {
            resource: "task".to_string(),
            id: id.to_string(),
        })?;

        Ok(TaskHandle {
            id,
            cancel_requested: record.cancel_requested.clone(),
        })
    }

    pub async fn list_tasks(&self) -> Vec<TaskInfo> {
        let mut tasks = self
            .inner
            .lock()
            .await
            .values()
            .map(|record| record.info.clone())
            .collect::<Vec<_>>();
        tasks.sort_by_key(|task| std::cmp::Reverse(task.created_at));
        tasks
    }

    pub async fn start_task(
        &self,
        id: Uuid,
        message: impl Into<String>,
    ) -> Result<TaskInfo, AppError> {
        self.update_task(id, |info| {
            if info.status != TaskStatus::Pending {
                return;
            }
            info.status = TaskStatus::Running;
            info.progress.message = Some(message.into());
            info.logs.push(TaskLogEntry {
                at: Utc::now(),
                message: "Task started".to_string(),
            });
        })
        .await
    }

    pub async fn update_progress(
        &self,
        id: Uuid,
        current: u64,
        message: impl Into<String>,
    ) -> Result<TaskInfo, AppError> {
        self.update_task(id, |info| {
            info.progress.current = current;
            info.progress.message = Some(message.into());
        })
        .await
    }

    pub async fn update_progress_with_total(
        &self,
        id: Uuid,
        current: u64,
        total: Option<u64>,
        message: impl Into<String>,
    ) -> Result<TaskInfo, AppError> {
        self.update_task(id, |info| {
            info.progress.current = current;
            info.progress.total = total;
            info.progress.message = Some(message.into());
        })
        .await
    }

    pub async fn request_cancel(&self, id: Uuid) -> Result<TaskInfo, AppError> {
        let mut tasks = self.inner.lock().await;
        let record = tasks.get_mut(&id).ok_or_else(|| AppError::NotFound {
            resource: "task".to_string(),
            id: id.to_string(),
        })?;

        record.cancel_requested.send_replace(true);
        if matches!(
            record.info.status,
            TaskStatus::Pending | TaskStatus::Running
        ) {
            record.info.status = TaskStatus::Cancelling;
            record.info.updated_at = Utc::now();
            record.info.logs.push(TaskLogEntry {
                at: Utc::now(),
                message: "Cancellation requested".to_string(),
            });
        }

        Ok(record.info.clone())
    }

    pub async fn clear_completed_tasks(&self) -> u64 {
        let mut tasks = self.inner.lock().await;
        let before = tasks.len();
        tasks.retain(|_, record| {
            !matches!(
                record.info.status,
                TaskStatus::Cancelled | TaskStatus::Succeeded | TaskStatus::Failed
            )
        });
        (before - tasks.len()) as u64
    }

    pub async fn output_path(&self, id: Uuid) -> Result<String, AppError> {
        let tasks = self.inner.lock().await;
        let record = tasks.get(&id).ok_or_else(|| AppError::NotFound {
            resource: "task".to_string(),
            id: id.to_string(),
        })?;
        record
            .info
            .output_path
            .clone()
            .ok_or_else(|| AppError::ConfigError("Task has no output file".to_string()))
    }

    pub async fn finish_success(
        &self,
        id: Uuid,
        message: impl Into<String>,
    ) -> Result<TaskInfo, AppError> {
        self.finish(id, TaskStatus::Succeeded, Some(message.into()), None)
            .await
    }

    pub async fn finish_cancelled(
        &self,
        id: Uuid,
        message: impl Into<String>,
    ) -> Result<TaskInfo, AppError> {
        self.finish(id, TaskStatus::Cancelled, Some(message.into()), None)
            .await
    }

    pub async fn finish_failed(
        &self,
        id: Uuid,
        error: impl Into<String>,
    ) -> Result<TaskInfo, AppError> {
        let error = sanitize_diagnostic_error(&error.into(), None);
        self.finish(id, TaskStatus::Failed, Some(error.clone()), Some(error))
            .await
    }

    async fn finish(
        &self,
        id: Uuid,
        status: TaskStatus,
        message: Option<String>,
        error: Option<String>,
    ) -> Result<TaskInfo, AppError> {
        self.update_task(id, |info| {
            let now = Utc::now();
            info.status = status;
            info.progress.message = message.clone();
            info.error = error;
            info.updated_at = now;
            info.finished_at = Some(now);
            if let Some(message) = &message {
                info.logs.push(TaskLogEntry {
                    at: now,
                    message: message.clone(),
                });
            }
        })
        .await
    }

    async fn update_task<F>(&self, id: Uuid, update: F) -> Result<TaskInfo, AppError>
    where
        F: FnOnce(&mut TaskInfo),
    {
        let mut tasks = self.inner.lock().await;
        let record = tasks.get_mut(&id).ok_or_else(|| AppError::NotFound {
            resource: "task".to_string(),
            id: id.to_string(),
        })?;

        update(&mut record.info);
        record.info.updated_at = Utc::now();
        Ok(record.info.clone())
    }
}

impl TaskHandle {
    pub fn is_cancel_requested(&self) -> bool {
        *self.cancel_requested.borrow()
    }

    pub async fn cancelled(&self) {
        // Subscribe before checking the value; wait_for also observes a cancel
        // requested before subscription. Each waiter has its own receiver.
        let mut receiver = self.cancel_requested.subscribe();
        let _ = receiver.wait_for(|requested| *requested).await;
    }
}

impl ScopedTaskRegistration {
    pub fn handle(&self) -> &TaskHandle {
        &self.handle
    }

    pub async fn cleanup(mut self) {
        self.manager
            .remove_registration(self.handle.id, self.registration_id)
            .await;
        self.cleaned = true;
    }
}

impl Drop for ScopedTaskRegistration {
    fn drop(&mut self) {
        if self.cleaned {
            return;
        }
        let manager = self.manager.clone();
        let id = self.handle.id;
        let registration_id = self.registration_id;
        if let Ok(runtime) = tokio::runtime::Handle::try_current() {
            runtime.spawn(async move {
                manager.remove_registration(id, registration_id).await;
            });
        }
    }
}

#[cfg(test)]
mod tests {
    use super::{TaskManager, TaskStatus};
    use uuid::Uuid;

    #[tokio::test]
    async fn cancellation_wakes_all_waiters_and_is_retained_for_late_subscribers() {
        let manager = TaskManager::new();
        let task = manager.create_task("test", "test", None).await;
        let first = manager.handle(task.id).await.unwrap();
        let second = first.clone();
        tokio::time::timeout(std::time::Duration::from_secs(1), async {
            tokio::join!(first.cancelled(), second.cancelled(), async {
                manager.request_cancel(task.id).await.unwrap();
            });
            manager.handle(task.id).await.unwrap().cancelled().await;
        })
        .await
        .expect("all cancellation observers must wake");
        assert!(first.is_cancel_requested());
    }

    #[tokio::test]
    async fn scoped_task_cleanup_removes_registration_and_allows_id_reuse() {
        let manager = TaskManager::new();
        let id = Uuid::new_v4();
        let registration = manager
            .register_scoped_task(id, "preview.csv.import", "preview")
            .await
            .unwrap();
        registration.cleanup().await;
        assert!(manager.handle(id).await.is_err());
        let next = manager
            .register_scoped_task(id, "preview.csv.import", "preview")
            .await
            .unwrap();
        assert!(!next.handle().is_cancel_requested());
        next.cleanup().await;
    }

    #[tokio::test]
    async fn scoped_task_rejects_duplicate_active_id() {
        let manager = TaskManager::new();
        let id = Uuid::new_v4();
        let registration = manager
            .register_scoped_task(id, "preview.csv.import", "preview")
            .await
            .unwrap();
        let error = manager
            .register_scoped_task(id, "preview.csv.import", "duplicate")
            .await
            .err()
            .expect("duplicate registration must fail");
        assert!(error.to_string().contains("already active"));
        registration.cleanup().await;
    }

    #[tokio::test]
    async fn dropped_scoped_task_cleans_up_without_removing_a_new_generation() {
        let manager = TaskManager::new();
        let id = Uuid::new_v4();
        let registration = manager
            .register_scoped_task(id, "preview.csv.import", "preview")
            .await
            .unwrap();
        drop(registration);
        tokio::task::yield_now().await;
        let next = manager
            .register_scoped_task(id, "preview.csv.import", "preview again")
            .await
            .unwrap();
        tokio::task::yield_now().await;
        assert!(manager.handle(id).await.is_ok());
        next.cleanup().await;
    }

    #[tokio::test]
    async fn aborting_future_does_not_leak_scoped_registration() {
        let manager = TaskManager::new();
        let id = Uuid::new_v4();
        let manager_for_task = manager.clone();
        let task = tokio::spawn(async move {
            let _registration = manager_for_task
                .register_scoped_task(id, "preview.csv.import", "preview")
                .await
                .unwrap();
            std::future::pending::<()>().await;
        });
        while manager.handle(id).await.is_err() {
            tokio::task::yield_now().await;
        }
        task.abort();
        let _ = task.await;
        tokio::task::yield_now().await;
        assert!(manager.handle(id).await.is_err());
    }

    #[tokio::test]
    async fn delayed_start_does_not_overwrite_cancelling_or_terminal_status() {
        let manager = TaskManager::new();
        let task = manager.create_task("test", "test", None).await;
        manager.request_cancel(task.id).await.unwrap();
        assert_eq!(
            manager
                .start_task(task.id, "late start")
                .await
                .unwrap()
                .status,
            TaskStatus::Cancelling
        );
        manager
            .finish_cancelled(task.id, "cancelled")
            .await
            .unwrap();
        assert_eq!(
            manager
                .start_task(task.id, "late start")
                .await
                .unwrap()
                .status,
            TaskStatus::Cancelled
        );
    }

    #[tokio::test]
    async fn task_lifecycle_transitions_to_success() {
        let manager = TaskManager::new();
        let task = manager
            .create_task("export.csv.result", "Export CSV", Some(2))
            .await;

        let running = manager.start_task(task.id, "running").await.unwrap();
        assert_eq!(running.status, TaskStatus::Running);

        let progressed = manager
            .update_progress(task.id, 1, "halfway")
            .await
            .unwrap();
        assert_eq!(progressed.progress.current, 1);

        let done = manager.finish_success(task.id, "done").await.unwrap();
        assert_eq!(done.status, TaskStatus::Succeeded);
        assert!(done.finished_at.is_some());
    }

    #[tokio::test]
    async fn task_lifecycle_supports_cancellation() {
        let manager = TaskManager::new();
        let task = manager
            .create_task("import.csv.table", "Import CSV", Some(1))
            .await;
        manager.start_task(task.id, "running").await.unwrap();

        let cancelling = manager.request_cancel(task.id).await.unwrap();
        assert_eq!(cancelling.status, TaskStatus::Cancelling);

        let handle = manager.handle(task.id).await.unwrap();
        assert!(handle.is_cancel_requested());

        let cancelled = manager
            .finish_cancelled(task.id, "cancelled")
            .await
            .unwrap();
        assert_eq!(cancelled.status, TaskStatus::Cancelled);
    }

    #[tokio::test]
    async fn clear_completed_tasks_keeps_active_tasks() {
        let manager = TaskManager::new();
        let completed = manager
            .create_task("export.csv.result", "Export CSV", Some(1))
            .await;
        manager.finish_success(completed.id, "done").await.unwrap();
        let active = manager
            .create_task("import.csv.table", "Import CSV", Some(1))
            .await;
        manager.start_task(active.id, "running").await.unwrap();

        assert_eq!(manager.clear_completed_tasks().await, 1);
        let tasks = manager.list_tasks().await;
        assert_eq!(tasks.len(), 1);
        assert_eq!(tasks[0].id, active.id);
        assert_eq!(tasks[0].status, TaskStatus::Running);
    }

    #[tokio::test]
    async fn failed_task_does_not_retain_external_credentials() {
        let manager = TaskManager::new();
        let task = manager
            .create_task("metadata.index", "Index metadata", None)
            .await;
        let failed = manager
            .finish_failed(
                task.id,
                "jdbc:mysql://test-user:super-secret-test-value@example.invalid/db?password=super-secret-test-value",
            )
            .await
            .unwrap();

        assert!(!failed
            .error
            .unwrap_or_default()
            .contains("super-secret-test-value"));
        assert!(failed
            .logs
            .iter()
            .all(|log| !log.message.contains("super-secret-test-value")));
    }
}
