use std::{
    collections::HashMap,
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc,
    },
};

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use tokio::sync::Mutex;
use uuid::Uuid;

use crate::models::error::AppError;

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
    cancel_requested: Arc<AtomicBool>,
}

struct TaskRecord {
    info: TaskInfo,
    cancel_requested: Arc<AtomicBool>,
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
                cancel_requested: Arc::new(AtomicBool::new(false)),
            },
        );

        info
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
        tasks.sort_by(|a, b| b.created_at.cmp(&a.created_at));
        tasks
    }

    pub async fn start_task(
        &self,
        id: Uuid,
        message: impl Into<String>,
    ) -> Result<TaskInfo, AppError> {
        self.update_task(id, |info| {
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

    pub async fn request_cancel(&self, id: Uuid) -> Result<TaskInfo, AppError> {
        let mut tasks = self.inner.lock().await;
        let record = tasks.get_mut(&id).ok_or_else(|| AppError::NotFound {
            resource: "task".to_string(),
            id: id.to_string(),
        })?;

        record.cancel_requested.store(true, Ordering::SeqCst);
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
        let error = error.into();
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
        self.cancel_requested.load(Ordering::SeqCst)
    }
}

#[cfg(test)]
mod tests {
    use super::{TaskManager, TaskStatus};

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
}
