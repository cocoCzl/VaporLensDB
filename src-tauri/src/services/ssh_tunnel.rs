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

pub struct SshTunnel {
    child: Child,
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
        let local_port = allocate_local_port(&local_host)?;
        let mut args = ssh_args(
            tunnel_config,
            &local_host,
            local_port,
            remote_host,
            remote_port,
        );
        let mut askpass_helper = None;

        let secret = match tunnel_config.auth_method {
            SshAuthMethod::Password => tunnel_config.password_encrypted.as_deref(),
            SshAuthMethod::PrivateKey => tunnel_config.private_key_passphrase_encrypted.as_deref(),
        };

        if secret.filter(|value| !value.is_empty()).is_some() {
            askpass_helper = Some(write_askpass_script()?);
        } else {
            args.push("-o".to_string());
            args.push("BatchMode=yes".to_string());
        }

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

        if let Err(error) = wait_until_forward_ready(&mut child, &local_host, local_port).await {
            let _ = child.start_kill();
            return Err(error);
        }

        let mut runtime_config = config.clone();
        runtime_config.host = Some(local_host.clone());
        runtime_config.port = Some(local_port);
        runtime_config.connection_url = rewrite_connection_url(
            config.connection_url.as_deref(),
            config.host.as_deref(),
            config.port,
            &local_host,
            local_port,
        )?;

        Ok(Some((
            Self {
                child,
                _askpass_helper: askpass_helper,
                local_host,
                local_port,
            },
            runtime_config,
        )))
    }
}

impl Drop for SshTunnel {
    fn drop(&mut self) {
        let _ = self.child.start_kill();
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
        format!("{local_host}:{local_port}:{remote_host}:{remote_port}"),
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

fn allocate_local_port(local_host: &str) -> Result<u16, AppError> {
    let addr = if local_host == "127.0.0.1" || local_host.eq_ignore_ascii_case("localhost") {
        SocketAddr::from((Ipv4Addr::LOCALHOST, 0))
    } else {
        format!("{local_host}:0")
            .parse()
            .map_err(|error| AppError::SshTunnelError {
                message: format!("invalid SSH local bind address: {error}"),
            })?
    };
    let listener = TcpListener::bind(addr).map_err(|error| AppError::SshTunnelError {
        message: format!("failed to allocate SSH local port: {error}"),
    })?;
    listener
        .local_addr()
        .map(|addr| addr.port())
        .map_err(|error| AppError::SshTunnelError {
            message: format!("failed to read SSH local port: {error}"),
        })
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
    original_host: Option<&str>,
    original_port: Option<u16>,
    local_host: &str,
    local_port: u16,
) -> Result<Option<String>, AppError> {
    let Some(url) = connection_url else {
        return Ok(None);
    };
    let original_host = original_host.ok_or_else(|| AppError::SshTunnelError {
        message: "database host is required to tunnel a URL connection".to_string(),
    })?;
    let original_port = original_port.ok_or_else(|| AppError::SshTunnelError {
        message: "database port is required to tunnel a URL connection".to_string(),
    })?;

    let rewritten = url
        .replace(original_host, local_host)
        .replace(&original_port.to_string(), &local_port.to_string());
    Ok(Some(rewritten))
}

async fn wait_until_forward_ready(
    child: &mut Child,
    local_host: &str,
    local_port: u16,
) -> Result<(), AppError> {
    let deadline = Instant::now() + TUNNEL_START_TIMEOUT;
    let addr = format!("{local_host}:{local_port}");

    loop {
        if let Some(status) = child.try_wait().map_err(|error| AppError::SshTunnelError {
            message: format!("failed to inspect ssh process: {error}"),
        })? {
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
            return Err(AppError::SshTunnelError { message });
        }

        if timeout(Duration::from_millis(250), TcpStream::connect(&addr))
            .await
            .ok()
            .and_then(Result::ok)
            .is_some()
        {
            return Ok(());
        }

        if Instant::now() >= deadline {
            let _ = child.start_kill();
            return Err(AppError::SshTunnelError {
                message: "timed out waiting for SSH tunnel".to_string(),
            });
        }

        sleep(Duration::from_millis(100)).await;
    }
}

#[cfg(test)]
mod tests {
    use super::{rewrite_connection_url, ssh_args, write_askpass_script};
    use crate::models::connection::{SshAuthMethod, SshTunnelConfig};

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
    fn rewrites_url_to_local_forward() {
        let url = rewrite_connection_url(
            Some("jdbc:postgresql://db.internal:5432/app"),
            Some("db.internal"),
            Some(5432),
            "127.0.0.1",
            15432,
        )
        .expect("rewrite")
        .expect("url");

        assert_eq!(url, "jdbc:postgresql://127.0.0.1:15432/app");
    }
}
