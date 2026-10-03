use std::{
    net::{Ipv4Addr, SocketAddr, TcpListener},
    path::{Path, PathBuf},
    time::Duration,
};

use tokio::{
    io::AsyncReadExt,
    net::TcpStream,
    process::{Child, Command},
    time::{sleep, timeout, Instant},
};
use uuid::Uuid;

use crate::models::{
    connection::{ConnectionConfig, SshAuthMethod, SshTunnelConfig},
    error::AppError,
};

const TUNNEL_START_TIMEOUT: Duration = Duration::from_secs(10);
const MAX_FORWARD_START_ATTEMPTS: usize = 4;

pub struct SshTunnel {
    child: Option<Child>,
    _askpass_helper: Option<AskpassHelper>,
    pub local_host: String,
    pub local_port: u16,
}

impl SshTunnel {
    pub async fn open(
        config: &ConnectionConfig,
    ) -> Result<Option<(Self, ConnectionConfig)>, AppError> {
        let Some(tunnel_config) = config.ssh_tunnel.as_ref().filter(|tunnel| tunnel.enabled) else {
            return Ok(None);
        };

        validate_tunnel_config(tunnel_config)?;
        let remote_host = tunnel_config
            .remote_host
            .as_deref()
            .or(config.host.as_deref())
            .ok_or_else(|| AppError::SshTunnelError {
                message: "database host is required for SSH tunnel".to_string(),
            })?;
        let remote_port =
            tunnel_config
                .remote_port
                .or(config.port)
                .ok_or_else(|| AppError::SshTunnelError {
                    message: "database port is required for SSH tunnel".to_string(),
                })?;
        let local_host = tunnel_config
            .local_host
            .clone()
            .filter(|value| !value.trim().is_empty())
            .unwrap_or_else(|| "127.0.0.1".to_string());
        let local_host = if local_host.eq_ignore_ascii_case("localhost") {
            "127.0.0.1".to_string()
        } else {
            local_host
        };
        let secret = match tunnel_config.auth_method {
            SshAuthMethod::Password => tunnel_config.password_encrypted.as_deref(),
            SshAuthMethod::PrivateKey => tunnel_config.private_key_passphrase_encrypted.as_deref(),
        };

        for attempt in 0..MAX_FORWARD_START_ATTEMPTS {
            let reservation = LocalPortReservation::bind(&local_host)?;
            let local_port = reservation.port();
            let mut runtime_config = config.clone();
            runtime_config.host = Some(local_host.clone());
            runtime_config.port = Some(local_port);
            runtime_config.connection_url =
                rewrite_connection_url(config.connection_url.as_deref(), &local_host, local_port)?;
            let mut args = ssh_args(
                tunnel_config,
                &local_host,
                local_port,
                remote_host,
                remote_port,
            );
            let askpass_helper = if secret.filter(|value| !value.is_empty()).is_some() {
                Some(write_askpass_script()?)
            } else {
                args.push("-o".to_string());
                args.push("BatchMode=yes".to_string());
                None
            };

            reservation.release();
            let mut command = Command::new("ssh");
            command.args(&args);
            command.stdin(std::process::Stdio::null());
            command.stdout(std::process::Stdio::null());
            command.stderr(std::process::Stdio::piped());
            if let Some(helper) = askpass_helper.as_ref() {
                command.env("SSH_ASKPASS", helper.path());
                command.env("SSH_ASKPASS_REQUIRE", "force");
                command.env("DISPLAY", "vaporlensdb:0");
                command.env("VAPORLENSDB_SSH_ASKPASS_SECRET", secret.unwrap_or_default());
            }

            let mut child = command.spawn().map_err(|error| AppError::SshTunnelError {
                message: format!(
                    "failed to start ssh; install the OpenSSH client and ensure ssh is on PATH: {error}"
                ),
            })?;

            match wait_until_forward_ready(&mut child, &local_host, local_port).await {
                Ok(()) => {
                    return Ok(Some((
                        Self {
                            child: Some(child),
                            _askpass_helper: askpass_helper,
                            local_host,
                            local_port,
                        },
                        runtime_config,
                    )));
                }
                Err(failure) if failure.retryable && attempt + 1 < MAX_FORWARD_START_ATTEMPTS => {
                    continue;
                }
                Err(failure) => return Err(failure.into_app_error()),
            }
        }

        Err(AppError::SshTunnelError {
            message: "SSH tunnel startup exhausted the bounded port-collision retries".to_string(),
        })
    }
}

impl Drop for SshTunnel {
    fn drop(&mut self) {
        let Some(mut child) = self.child.take() else {
            return;
        };
        let _ = child.start_kill();
        if let Ok(handle) = tokio::runtime::Handle::try_current() {
            handle.spawn(async move {
                let _ = child.wait().await;
            });
        }
    }
}

struct AskpassHelper {
    path: PathBuf,
}

impl AskpassHelper {
    fn path(&self) -> &Path {
        &self.path
    }
}

impl Drop for AskpassHelper {
    fn drop(&mut self) {
        let _ = std::fs::remove_file(&self.path);
    }
}

fn validate_tunnel_config(config: &SshTunnelConfig) -> Result<(), AppError> {
    if config.host.trim().is_empty() {
        return Err(AppError::SshTunnelError {
            message: "SSH host is required".to_string(),
        });
    }
    if config.username.trim().is_empty() {
        return Err(AppError::SshTunnelError {
            message: "SSH username is required".to_string(),
        });
    }
    if matches!(config.auth_method, SshAuthMethod::PrivateKey)
        && config
            .private_key_path
            .as_deref()
            .map(str::trim)
            .unwrap_or("")
            .is_empty()
    {
        return Err(AppError::SshTunnelError {
            message: "SSH private key path is required".to_string(),
        });
    }
    Ok(())
}

fn ssh_args(
    config: &SshTunnelConfig,
    local_host: &str,
    local_port: u16,
    remote_host: &str,
    remote_port: u16,
) -> Vec<String> {
    let mut args = vec![
        "-N".to_string(),
        "-L".to_string(),
        format!(
            "{}:{local_port}:{remote_host}:{remote_port}",
            ssh_forward_host(local_host)
        ),
        "-p".to_string(),
        config.port.to_string(),
        "-o".to_string(),
        "ExitOnForwardFailure=yes".to_string(),
        "-o".to_string(),
        "ServerAliveInterval=30".to_string(),
        "-o".to_string(),
        "ServerAliveCountMax=3".to_string(),
        "-o".to_string(),
        "StrictHostKeyChecking=accept-new".to_string(),
    ];

    if matches!(config.auth_method, SshAuthMethod::PrivateKey) {
        if let Some(path) = config
            .private_key_path
            .as_deref()
            .filter(|value| !value.is_empty())
        {
            args.push("-i".to_string());
            args.push(path.to_string());
        }
    }

    args.push(format!("{}@{}", config.username, config.host));
    args
}

fn ssh_forward_host(local_host: &str) -> String {
    let host = local_host
        .strip_prefix('[')
        .and_then(|value| value.strip_suffix(']'))
        .unwrap_or(local_host);
    match host.parse::<std::net::IpAddr>() {
        Ok(std::net::IpAddr::V6(address)) => format!("[{address}]"),
        _ => local_host.to_string(),
    }
}

struct LocalPortReservation {
    listener: TcpListener,
    local_port: u16,
}

impl LocalPortReservation {
    fn bind(local_host: &str) -> Result<Self, AppError> {
        let listener = TcpListener::bind(local_bind_addr(local_host)?).map_err(|error| {
            AppError::SshTunnelError {
                message: format!("failed to allocate SSH local port: {error}"),
            }
        })?;
        let local_port = listener
            .local_addr()
            .map(|addr| addr.port())
            .map_err(|error| AppError::SshTunnelError {
                message: format!("failed to read SSH local port: {error}"),
            })?;
        Ok(Self {
            listener,
            local_port,
        })
    }

    fn port(&self) -> u16 {
        self.local_port
    }

    fn release(self) {
        drop(self.listener);
    }
}

fn local_bind_addr(local_host: &str) -> Result<SocketAddr, AppError> {
    local_bind_addr_with_port(local_host, 0)
}

fn write_askpass_script() -> Result<AskpassHelper, AppError> {
    #[cfg(windows)]
    let (extension, contents) = (
        "cmd",
        "@echo off\r\n<nul set /p=\"%VAPORLENSDB_SSH_ASKPASS_SECRET%\"\r\n",
    );
    #[cfg(not(windows))]
    let (extension, contents) = (
        "sh",
        "#!/bin/sh\nprintf '%s' \"$VAPORLENSDB_SSH_ASKPASS_SECRET\"\n",
    );
    let path = std::env::temp_dir().join(format!(
        "vaporlensdb-ssh-askpass-{}.{}",
        Uuid::new_v4(),
        extension
    ));
    std::fs::write(&path, contents).map_err(|error| AppError::SshTunnelError {
        message: format!("failed to create SSH askpass helper: {error}"),
    })?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let mut permissions = std::fs::metadata(&path)
            .map_err(|error| AppError::SshTunnelError {
                message: format!("failed to inspect SSH askpass helper: {error}"),
            })?
            .permissions();
        permissions.set_mode(0o700);
        std::fs::set_permissions(&path, permissions).map_err(|error| AppError::SshTunnelError {
            message: format!("failed to mark SSH askpass helper executable: {error}"),
        })?;
    }
    Ok(AskpassHelper { path })
}

fn rewrite_connection_url(
    connection_url: Option<&str>,
    local_host: &str,
    local_port: u16,
) -> Result<Option<String>, AppError> {
    let Some(url) = connection_url else {
        return Ok(None);
    };
    // Never include the supplied URL or parser error: either may expose
    // credentials embedded in userinfo, paths, or properties.
    let invalid_url = || AppError::SshTunnelError {
        message: concat!(
            "SSH URL forwarding requires a single-host PostgreSQL/MySQL/MariaDB URI ",
            "or Oracle thin @//host:port/service URL, without endpoint override parameters; ",
            "use parameter connection settings for other formats"
        )
        .to_string(),
    };
    let prefixes = [
        "postgresql://",
        "postgres://",
        "mysql://",
        "mariadb://",
        "jdbc:postgresql://",
        "jdbc:mysql://",
        "jdbc:mariadb://",
        "jdbc:oracle:thin:@//",
    ];
    let prefix = prefixes
        .iter()
        .find(|prefix| url.starts_with(**prefix))
        .ok_or_else(invalid_url)?;
    let remainder = &url[prefix.len()..];
    let authority_end = remainder.find(['/', '?', '#']).unwrap_or(remainder.len());
    let authority = &remainder[..authority_end];
    let suffix = &remainder[authority_end..];
    // Use the URI parser for authority/port validation, but splice the original
    // text so percent encoding, credentials, path and query remain byte-exact.
    let parsed =
        url::Url::parse(&format!("postgresql://{authority}{suffix}")).map_err(|_| invalid_url())?;
    let host = parsed.host_str().ok_or_else(invalid_url)?;
    if host.is_empty()
        || host.contains([',', ';', '\\', '%'])
        || url.chars().any(|ch| ch.is_control() || ch.is_whitespace())
        || authority.contains('\\')
        || parsed.fragment().is_some()
    {
        return Err(invalid_url());
    }
    // These properties can override the authority or select a socket/alternate
    // host in native and JDBC connectors, bypassing the local forward.
    for (key, _) in parsed.query_pairs() {
        if matches!(
            key.to_ascii_lowercase().as_str(),
            "host"
                | "hostaddr"
                | "port"
                | "servername"
                | "portnumber"
                | "service"
                | "servicefile"
                | "socket"
                | "unix_socket"
                | "unixsocket"
                | "localsocket"
                | "socket_factory"
                | "socketfactory"
                | "socketfactoryarg"
                | "namedpipepath"
                | "pipe"
                | "failoverpartner"
                | "address"
                | "propertiestransform"
        ) {
            return Err(invalid_url());
        }
    }
    let userinfo_end = authority.rfind('@').map_or(0, |index| index + 1);
    let endpoint = &authority[userinfo_end..];
    // Reject a dangling port and non-URI authority syntax rather than guessing.
    if endpoint.ends_with(':') || endpoint.contains(['(', ')', '=']) {
        return Err(invalid_url());
    }
    let local_host = if local_host.eq_ignore_ascii_case("localhost") {
        local_host.to_string()
    } else {
        let unbracketed = local_host
            .strip_prefix('[')
            .and_then(|host| host.strip_suffix(']'))
            .unwrap_or(local_host);
        match unbracketed
            .parse::<std::net::IpAddr>()
            .map_err(|_| invalid_url())?
        {
            std::net::IpAddr::V4(addr) => addr.to_string(),
            std::net::IpAddr::V6(addr) => format!("[{addr}]"),
        }
    };
    if local_port == 0 {
        return Err(invalid_url());
    }
    Ok(Some(format!(
        "{prefix}{}{local_host}:{local_port}{suffix}",
        &authority[..userinfo_end]
    )))
}

async fn wait_until_forward_ready(
    child: &mut Child,
    local_host: &str,
    local_port: u16,
) -> Result<(), ForwardStartupFailure> {
    let deadline = Instant::now() + TUNNEL_START_TIMEOUT;
    let addr = local_bind_addr_with_port(local_host, local_port).map_err(|error| {
        ForwardStartupFailure {
            message: error.to_string(),
            retryable: false,
        }
    })?;

    loop {
        let process_status = match child.try_wait() {
            Ok(status) => status,
            Err(error) => {
                terminate_child(child).await;
                return Err(ForwardStartupFailure {
                    message: format!("failed to inspect ssh process: {error}"),
                    retryable: false,
                });
            }
        };
        if let Some(status) = process_status {
            let mut stderr = String::new();
            if let Some(mut pipe) = child.stderr.take() {
                let _ = pipe.read_to_string(&mut stderr).await;
            }
            let details = stderr.trim();
            let message = if details.is_empty() {
                format!("ssh exited before tunnel was ready: {status}")
            } else {
                format!("ssh exited before tunnel was ready: {details}")
            };
            let auth_failure = looks_like_auth_failure(details);
            return Err(ForwardStartupFailure {
                retryable: !auth_failure
                    && (port_is_occupied(local_host, local_port)
                        || looks_like_forward_bind_failure(details)),
                message,
            });
        }

        if timeout(Duration::from_millis(250), TcpStream::connect(addr))
            .await
            .ok()
            .and_then(Result::ok)
            .is_some()
        {
            let process_status = match child.try_wait() {
                Ok(status) => status,
                Err(error) => {
                    terminate_child(child).await;
                    return Err(ForwardStartupFailure {
                        message: format!("failed to inspect ssh process: {error}"),
                        retryable: false,
                    });
                }
            };
            if let Some(status) = process_status {
                return Err(ForwardStartupFailure {
                    retryable: port_is_occupied(local_host, local_port),
                    message: format!("ssh exited before tunnel was ready: {status}"),
                });
            }
            return Ok(());
        }

        if Instant::now() >= deadline {
            terminate_child(child).await;
            return Err(ForwardStartupFailure {
                message: "timed out waiting for SSH tunnel".to_string(),
                retryable: false,
            });
        }

        sleep(Duration::from_millis(100)).await;
    }
}

struct ForwardStartupFailure {
    message: String,
    retryable: bool,
}

impl ForwardStartupFailure {
    fn into_app_error(self) -> AppError {
        AppError::SshTunnelError {
            message: self.message,
        }
    }
}

async fn terminate_child(child: &mut Child) {
    let _ = child.start_kill();
    let _ = child.wait().await;
}

fn port_is_occupied(local_host: &str, local_port: u16) -> bool {
    local_bind_addr_with_port(local_host, local_port)
        .map(|addr| TcpListener::bind(addr).is_err())
        .unwrap_or(false)
}

fn local_bind_addr_with_port(local_host: &str, local_port: u16) -> Result<SocketAddr, AppError> {
    if local_host == "127.0.0.1" || local_host.eq_ignore_ascii_case("localhost") {
        return Ok(SocketAddr::from((Ipv4Addr::LOCALHOST, local_port)));
    }
    let host = local_host
        .strip_prefix('[')
        .and_then(|value| value.strip_suffix(']'))
        .unwrap_or(local_host);
    let ip = host.parse().map_err(|error| AppError::SshTunnelError {
        message: format!("invalid SSH local bind address: {error}"),
    })?;
    Ok(SocketAddr::new(ip, local_port))
}

fn looks_like_forward_bind_failure(stderr: &str) -> bool {
    let normalized = stderr.to_ascii_lowercase();
    [
        "address already in use",
        "cannot listen to port",
        "bind: address",
    ]
    .iter()
    .any(|marker| normalized.contains(marker))
}

fn looks_like_auth_failure(stderr: &str) -> bool {
    let normalized = stderr.to_ascii_lowercase();
    [
        "permission denied",
        "authentication failed",
        "could not authenticate",
        "too many authentication failures",
    ]
    .iter()
    .any(|marker| normalized.contains(marker))
}

#[cfg(test)]
mod tests {
    use super::{
        looks_like_auth_failure, looks_like_forward_bind_failure, rewrite_connection_url, ssh_args,
        ssh_forward_host, wait_until_forward_ready, write_askpass_script, LocalPortReservation,
        MAX_FORWARD_START_ATTEMPTS,
    };
    use crate::models::connection::{SshAuthMethod, SshTunnelConfig};

    fn probe_local_bind(port: u16) -> std::io::Result<std::net::TcpListener> {
        std::net::TcpListener::bind((std::net::Ipv4Addr::LOCALHOST, port))
    }

    fn assert_held_port(port: u16) {
        let error = probe_local_bind(port).expect_err("held reservation must reject a second bind");
        assert_eq!(
            error.kind(),
            std::io::ErrorKind::AddrInUse,
            "held port={port}, kind={:?}, errno={:?}",
            error.kind(),
            error.raw_os_error()
        );
    }

    #[test]
    fn builds_private_key_forwarding_args() {
        let config = SshTunnelConfig {
            enabled: true,
            host: "bastion.example.com".to_string(),
            port: 2222,
            username: "deploy".to_string(),
            auth_method: SshAuthMethod::PrivateKey,
            password_encrypted: None,
            private_key_path: Some("/keys/id_ed25519".to_string()),
            private_key_passphrase_encrypted: None,
            remote_host: None,
            remote_port: None,
            local_host: None,
        };

        let args = ssh_args(&config, "127.0.0.1", 15432, "db.internal", 5432);

        assert!(args.contains(&"-N".to_string()));
        assert!(args.contains(&"127.0.0.1:15432:db.internal:5432".to_string()));
        assert!(args.contains(&"-i".to_string()));
        assert!(args.contains(&"/keys/id_ed25519".to_string()));
        assert!(args.contains(&"deploy@bastion.example.com".to_string()));
    }

    #[test]
    fn keeps_port_reservation_and_forwarding_identity_for_localhost_and_ipv6() {
        assert_eq!(ssh_forward_host("localhost"), "localhost");
        assert_eq!(ssh_forward_host("::1"), "[::1]");
        assert_eq!(ssh_forward_host("[::1]"), "[::1]");
    }

    #[test]
    fn askpass_helper_never_contains_a_password() {
        let helper = write_askpass_script().expect("create askpass helper");
        let contents = std::fs::read_to_string(helper.path()).expect("read askpass helper");

        assert!(contents.contains("VAPORLENSDB_SSH_ASKPASS_SECRET"));
        assert!(!contents.contains("database-password"));

        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let mode = std::fs::metadata(helper.path())
                .expect("inspect askpass helper")
                .permissions()
                .mode()
                & 0o777;
            assert_eq!(mode, 0o700);
        }

        let path = helper.path().to_path_buf();
        drop(helper);
        assert!(!path.exists());
    }

    #[test]
    fn local_port_reservation_holds_the_port_until_the_attempt_releases_it() {
        let reservation = LocalPortReservation::bind("127.0.0.1").expect("reserve local port");
        let port = reservation.port();
        assert_eq!(reservation.listener.local_addr().unwrap().port(), port);
        assert_held_port(port);
        let release_owned: fn(LocalPortReservation) = LocalPortReservation::release;
        release_owned(reservation);
    }

    #[test]
    fn occupied_port_marks_fake_ssh_startup_as_retryable_without_retrying_auth_failure() {
        let listener = std::net::TcpListener::bind("127.0.0.1:0").expect("bind fake listener");
        let port = listener.local_addr().unwrap().port();
        assert_held_port(port);
        assert!(looks_like_forward_bind_failure(
            "bind: Address already in use"
        ));
        assert!(!looks_like_forward_bind_failure(
            "Could not request local forwarding"
        ));
        assert!(!looks_like_forward_bind_failure(
            "Permission denied (publickey)"
        ));
        assert!(looks_like_auth_failure("Permission denied (publickey)"));
        drop(listener);
    }

    #[test]
    fn ssh_port_retry_is_bounded_and_attempt_state_is_not_shared() {
        assert_eq!(MAX_FORWARD_START_ATTEMPTS, 4);
        let first = LocalPortReservation::bind("127.0.0.1").unwrap();
        let LocalPortReservation {
            listener: stolen_listener,
            local_port: first_port,
        } = first;
        let second = LocalPortReservation::bind("127.0.0.1").unwrap();
        assert!(second.port() > 0);
        assert_ne!(first_port, second.port());
        assert_eq!(stolen_listener.local_addr().unwrap().port(), first_port);
        assert_eq!(second.listener.local_addr().unwrap().port(), second.port());
        assert_held_port(first_port);
        assert_held_port(second.port());
        second.release();
        drop(stolen_listener);
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn fake_ssh_startup_distinguishes_stolen_port_from_auth_failure() {
        let listener = std::net::TcpListener::bind("127.0.0.1:0").expect("bind alien listener");
        let occupied_port = listener.local_addr().unwrap().port();
        let mut collision_child = tokio::process::Command::new("sh")
            .args([
                "-c",
                "printf '%s' 'bind: Address already in use' >&2; exit 255",
            ])
            .stderr(std::process::Stdio::piped())
            .spawn()
            .expect("spawn fake collision ssh");
        collision_child
            .wait()
            .await
            .expect("wait for fake collision ssh");
        let collision = wait_until_forward_ready(&mut collision_child, "127.0.0.1", occupied_port)
            .await
            .expect_err("stolen port must fail startup");
        assert!(collision.retryable);
        drop(listener);

        let free = LocalPortReservation::bind("127.0.0.1").unwrap();
        let free_port = free.port();
        free.release();
        let mut auth_child = tokio::process::Command::new("sh")
            .args([
                "-c",
                "printf '%s' 'Permission denied (publickey)' >&2; exit 255",
            ])
            .stderr(std::process::Stdio::piped())
            .spawn()
            .expect("spawn fake auth ssh");
        auth_child.wait().await.expect("wait for fake auth ssh");
        let auth = wait_until_forward_ready(&mut auth_child, "127.0.0.1", free_port)
            .await
            .expect_err("auth failure must fail startup");
        assert!(!auth.retryable);
    }

    #[test]
    fn rewrites_url_to_local_forward() {
        let url = rewrite_connection_url(
            Some("jdbc:postgresql://db.internal:5432/app"),
            "127.0.0.1",
            15432,
        )
        .expect("rewrite")
        .expect("url");

        assert_eq!(url, "jdbc:postgresql://127.0.0.1:15432/app");
    }

    #[test]
    fn rewrites_only_authority_preserving_credentials_path_and_query() {
        let source = "postgresql://db.internal:p%405432@db.internal:5432/db.internal5432%2Fname?application_name=db.internal5432&sslmode=require";
        let expected = "postgresql://db.internal:p%405432@127.0.0.1:15432/db.internal5432%2Fname?application_name=db.internal5432&sslmode=require";
        assert_eq!(
            rewrite_connection_url(Some(source), "127.0.0.1", 15432)
                .unwrap()
                .as_deref(),
            Some(expected)
        );
    }

    #[test]
    fn handles_missing_ports_ipv6_and_supported_jdbc_dialects() {
        for (source, expected) in [
            ("postgres://db/app", "postgres://[::1]:15432/app"),
            (
                "mysql://[2001:db8::1]:3306/app?charset=utf8",
                "mysql://[::1]:15432/app?charset=utf8",
            ),
            (
                "jdbc:mysql://db/app3306",
                "jdbc:mysql://[::1]:15432/app3306",
            ),
            (
                "jdbc:mariadb://db:3306/app",
                "jdbc:mariadb://[::1]:15432/app",
            ),
            (
                "jdbc:oracle:thin:@//db:1521/service1521",
                "jdbc:oracle:thin:@//[::1]:15432/service1521",
            ),
        ] {
            assert_eq!(
                rewrite_connection_url(Some(source), "::1", 15432)
                    .unwrap()
                    .as_deref(),
                Some(expected)
            );
        }
        assert!(rewrite_connection_url(None, "127.0.0.1", 15432)
            .unwrap()
            .is_none());
    }

    #[test]
    fn rejects_ambiguous_or_unsupported_urls_without_leaking_them() {
        for source in [
            "jdbc:sqlserver://db:1433;database=app;password=secret",
            "jdbc:oracle:thin:@db:1521:SID",
            "jdbc:oracle:thin:@(DESCRIPTION=secret)",
            "jdbc:mysql:loadbalance://db1,db2/app",
            "postgresql://db1,db2/app",
            "postgresql:///app",
            "postgresql://db:/app",
            "postgresql://db:99999/app",
            "postgresql://db/app#secret",
            "postgresql://db/app\n",
            "postgresql://db/app?%68ost=secret",
            "postgresql://db/app?hostaddr=secret",
            "mysql://db/app?socket=secret",
            "jdbc:mysql://db/app?socketFactory=secret",
            "postgresql://db/app?service=secret",
            "sqlite:///secret",
        ] {
            let error = rewrite_connection_url(Some(source), "127.0.0.1", 15432)
                .unwrap_err()
                .to_string();
            assert!(!error.contains("secret"));
            assert!(!error.contains(source));
        }
    }
}
