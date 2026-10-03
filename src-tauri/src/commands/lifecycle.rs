use std::future::Future;

use tauri::{AppHandle, Emitter, Manager, Runtime};
use tokio::sync::{Mutex, Notify};

use crate::AppState;

#[derive(Default)]
pub struct ApplicationCloseRequestBridge {
    state: std::sync::Mutex<CloseRequestState>,
}

#[derive(Default)]
struct CloseRequestState {
    listener_ready: bool,
    pending: bool,
    in_flight: bool,
}

impl ApplicationCloseRequestBridge {
    fn request(&self) -> bool {
        let mut state = self.state.lock().unwrap_or_else(|error| error.into_inner());
        if state.in_flight {
            return false;
        }
        if !state.listener_ready {
            state.pending = true;
            return false;
        }
        state.in_flight = true;
        true
    }

    fn listener_ready(&self) -> bool {
        let mut state = self.state.lock().unwrap_or_else(|error| error.into_inner());
        state.listener_ready = true;
        if !state.pending || state.in_flight {
            return false;
        }
        state.pending = false;
        state.in_flight = true;
        true
    }

    fn finish_request(&self) {
        self.state
            .lock()
            .unwrap_or_else(|error| error.into_inner())
            .in_flight = false;
    }
}

fn emit_close_request<R: Runtime>(app: &AppHandle<R>, should_emit: bool) -> tauri::Result<()> {
    if !should_emit {
        return Ok(());
    }
    if let Err(error) = app.emit(crate::APPLICATION_CLOSE_REQUEST_EVENT, ()) {
        app.state::<ApplicationCloseRequestBridge>()
            .finish_request();
        return Err(error);
    }
    Ok(())
}

pub fn request_application_close<R: Runtime>(app: &AppHandle<R>) -> tauri::Result<()> {
    let should_emit = app.state::<ApplicationCloseRequestBridge>().request();
    emit_close_request(app, should_emit)
}

#[tauri::command]
pub fn application_close_listener_ready(app: AppHandle) -> Result<(), String> {
    let should_emit = app
        .state::<ApplicationCloseRequestBridge>()
        .listener_ready();
    emit_close_request(&app, should_emit)
        .map_err(|_| "application close request delivery failed".into())
}

#[tauri::command]
pub fn application_close_request_finished(app: AppHandle) {
    app.state::<ApplicationCloseRequestBridge>()
        .finish_request();
}

pub struct ApplicationShutdownCoordinator {
    state: Mutex<ShutdownState>,
}

enum ShutdownState {
    Idle,
    Running(std::sync::Arc<Notify>),
    Completed,
}

impl ApplicationShutdownCoordinator {
    pub fn new() -> Self {
        Self {
            state: Mutex::new(ShutdownState::Idle),
        }
    }

    pub async fn run_once<F, Fut>(&self, cleanup: F) -> Result<(), String>
    where
        F: FnOnce() -> Fut,
        Fut: Future<Output = Result<(), String>>,
    {
        let cleanup = loop {
            let wait_for = {
                let mut state = self.state.lock().await;
                match &*state {
                    ShutdownState::Completed => return Ok(()),
                    ShutdownState::Running(notify) => Some(notify.clone().notified_owned()),
                    ShutdownState::Idle => {
                        *state = ShutdownState::Running(std::sync::Arc::new(Notify::new()));
                        None
                    }
                }
            };
            let Some(notified) = wait_for else {
                break cleanup;
            };
            notified.await;
        };

        let result = cleanup().await;
        let notify = {
            let mut state = self.state.lock().await;
            let ShutdownState::Running(notify) = &*state else {
                unreachable!("shutdown coordinator owner state changed unexpectedly")
            };
            let notify = notify.clone();
            *state = if result.is_ok() {
                ShutdownState::Completed
            } else {
                ShutdownState::Idle
            };
            notify
        };
        notify.notify_waiters();
        result
    }
}

impl Default for ApplicationShutdownCoordinator {
    fn default() -> Self {
        Self::new()
    }
}

#[tauri::command]
pub async fn shutdown_application(app: AppHandle) -> Result<(), String> {
    let coordinator = &app.state::<AppState>().shutdown_coordinator;
    let exit_app = app.clone();
    coordinator
        .run_once(|| async move {
            let state = exit_app.state::<AppState>();
            state.idle_reclaim_worker.stop().await;
            state.connection_manager.lock().await.shutdown_all().await;
            state.metadata_index.clear_all().await;
            exit_app.exit(0);
            Ok(())
        })
        .await
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::{
        atomic::{AtomicUsize, Ordering},
        Arc,
    };
    use std::time::Duration;

    #[test]
    fn close_before_ready_is_pending_and_replayed_exactly_once() {
        let bridge = ApplicationCloseRequestBridge::default();
        assert!(!bridge.request());
        assert!(bridge.state.lock().unwrap().pending);
        assert!(bridge.listener_ready());
        assert!(!bridge.state.lock().unwrap().pending);
        assert!(!bridge.listener_ready());
    }

    #[test]
    fn early_menu_and_window_requests_coalesce() {
        let bridge = ApplicationCloseRequestBridge::default();
        assert!(!bridge.request());
        assert!(!bridge.request());
        assert!(bridge.listener_ready());
        assert!(!bridge.request());
        assert!(!bridge.listener_ready());
    }

    #[test]
    fn ready_requests_emit_immediately_and_cancelled_close_can_retry() {
        let bridge = ApplicationCloseRequestBridge::default();
        assert!(!bridge.listener_ready());
        assert!(!bridge.listener_ready());
        assert!(bridge.request());
        assert!(!bridge.request());
        bridge.finish_request();
        bridge.finish_request();
        assert!(bridge.request());
    }

    #[test]
    fn concurrent_ready_and_quit_emit_exactly_once() {
        let bridge = ApplicationCloseRequestBridge::default();
        let barrier = std::sync::Barrier::new(2);
        let emitted = AtomicUsize::new(0);
        std::thread::scope(|scope| {
            scope.spawn(|| {
                barrier.wait();
                if bridge.request() {
                    emitted.fetch_add(1, Ordering::SeqCst);
                }
            });
            scope.spawn(|| {
                barrier.wait();
                if bridge.listener_ready() {
                    emitted.fetch_add(1, Ordering::SeqCst);
                }
            });
        });
        assert_eq!(emitted.load(Ordering::SeqCst), 1);
        assert!(!bridge.listener_ready());
        assert!(!bridge.request());
    }

    #[test]
    fn concurrent_ready_menu_and_window_close_share_one_request() {
        let bridge = ApplicationCloseRequestBridge::default();
        let barrier = std::sync::Barrier::new(3);
        let emitted = AtomicUsize::new(0);
        std::thread::scope(|scope| {
            for _ in 0..2 {
                scope.spawn(|| {
                    barrier.wait();
                    if bridge.request() {
                        emitted.fetch_add(1, Ordering::SeqCst);
                    }
                });
            }
            scope.spawn(|| {
                barrier.wait();
                if bridge.listener_ready() {
                    emitted.fetch_add(1, Ordering::SeqCst);
                }
            });
        });
        assert_eq!(emitted.load(Ordering::SeqCst), 1);
    }

    #[tokio::test]
    async fn replay_and_later_close_requests_still_shutdown_and_exit_once() {
        let bridge = ApplicationCloseRequestBridge::default();
        let coordinator = ApplicationShutdownCoordinator::new();
        let cleanup_calls = AtomicUsize::new(0);
        let exit_calls = AtomicUsize::new(0);
        assert!(!bridge.request());
        assert!(!bridge.request());
        assert!(bridge.listener_ready());
        coordinator
            .run_once(|| async {
                cleanup_calls.fetch_add(1, Ordering::SeqCst);
                exit_calls.fetch_add(1, Ordering::SeqCst);
                Ok(())
            })
            .await
            .unwrap();
        bridge.finish_request();
        assert!(bridge.request());
        coordinator
            .run_once(|| async { panic!("later close request must not clean up or exit twice") })
            .await
            .unwrap();
        assert_eq!(cleanup_calls.load(Ordering::SeqCst), 1);
        assert_eq!(exit_calls.load(Ordering::SeqCst), 1);
    }

    #[tokio::test]
    async fn repeated_shutdown_requests_run_cleanup_and_exit_once() {
        let coordinator = Arc::new(ApplicationShutdownCoordinator::new());
        let cleanup_calls = Arc::new(AtomicUsize::new(0));
        let exit_calls = Arc::new(AtomicUsize::new(0));

        let (release_cleanup, cleanup_released) = tokio::sync::oneshot::channel();
        let first = coordinator.run_once(|| async {
            cleanup_calls.fetch_add(1, Ordering::SeqCst);
            cleanup_released.await.unwrap();
            exit_calls.fetch_add(1, Ordering::SeqCst);
            Ok(())
        });
        let second = coordinator
            .run_once(|| async { panic!("concurrent caller must not perform a second cleanup") });
        tokio::pin!(first, second);
        assert!(futures_util::poll!(&mut first).is_pending());
        assert!(futures_util::poll!(&mut second).is_pending());
        assert_eq!(cleanup_calls.load(Ordering::SeqCst), 1);
        assert_eq!(exit_calls.load(Ordering::SeqCst), 0);
        release_cleanup.send(()).unwrap();

        let results = tokio::time::timeout(Duration::from_secs(5), async {
            tokio::join!(first, second)
        })
        .await
        .unwrap();
        assert_eq!(results, (Ok(()), Ok(())));
        assert_eq!(
            coordinator
                .run_once(|| async { panic!("completed shutdown must not run cleanup again") })
                .await,
            Ok(())
        );

        assert_eq!(cleanup_calls.load(Ordering::SeqCst), 1);
        assert_eq!(exit_calls.load(Ordering::SeqCst), 1);
    }

    #[tokio::test]
    async fn cleanup_failure_is_returned_and_next_request_can_retry() {
        let coordinator = ApplicationShutdownCoordinator::new();
        let attempts = Arc::new(AtomicUsize::new(0));
        let exit_calls = Arc::new(AtomicUsize::new(0));

        let first_attempts = attempts.clone();
        let first = coordinator
            .run_once(|| async move {
                first_attempts.fetch_add(1, Ordering::SeqCst);
                Err("cleanup failed".to_string())
            })
            .await;
        assert_eq!(first, Err("cleanup failed".to_string()));
        assert_eq!(exit_calls.load(Ordering::SeqCst), 0);

        let second_attempts = attempts.clone();
        let second_exit_calls = exit_calls.clone();
        let second = coordinator
            .run_once(|| async move {
                second_attempts.fetch_add(1, Ordering::SeqCst);
                second_exit_calls.fetch_add(1, Ordering::SeqCst);
                Ok(())
            })
            .await;
        assert_eq!(second, Ok(()));
        assert_eq!(attempts.load(Ordering::SeqCst), 2);
        assert_eq!(exit_calls.load(Ordering::SeqCst), 1);
    }
}
