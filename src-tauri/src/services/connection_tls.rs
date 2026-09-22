use crate::models::{
    connection::{ConnectionConfig, DriverType},
    driver_catalog::{DriverBackend, DriverDefinition},
    error::AppError,
};

/// Validate the standalone SSL field against implemented connector semantics.
/// URL-owned TLS settings are left to the selected driver;
/// they must not silently override an explicit, independently saved SSL field.
pub(super) fn validate_connection_tls(
    config: &ConnectionConfig,
    definition: Option<&DriverDefinition>,
) -> Result<(), AppError> {
    let Some(mode) = config
        .ssl_mode
        .as_deref()
        .map(str::trim)
        .filter(|mode| !mode.is_empty())
    else {
        return Ok(());
    };
    if !matches!(
        mode,
        "disable" | "prefer" | "require" | "verify-ca" | "verify-full"
    ) {
        // Do not interpolate untrusted configuration or connection URLs: they
        // can contain credentials and are also shown in connection diagnostics.
        return Err(AppError::ConfigError("Unknown standalone SSL mode".into()));
    }
    if config
        .connection_url
        .as_deref()
        .is_some_and(|url| !url.trim().is_empty())
    {
        return Err(AppError::ConfigError(
            "A connection URL and a standalone SSL mode cannot be combined. Configure TLS in the driver's URL and clear the standalone SSL field, or use parameter-based connection settings.".into(),
        ));
    }
    let jdbc = matches!(
        definition.map(|item| &item.backend),
        Some(DriverBackend::Jdbc)
    );
    if !jdbc && config.driver_type == DriverType::Postgres {
        return Ok(());
    }
    if !jdbc
        && config.driver_type == DriverType::Mysql
        && matches!(mode, "disable" | "require" | "verify-ca" | "verify-full")
    {
        // mysql_async supports mandatory TLS, not opportunistic prefer mode.
        return Ok(());
    }
    if !jdbc && config.driver_type == DriverType::Mssql && mode == "require" {
        // The existing native parameter connector requires encryption, but
        // trusts the server certificate. This is NOT verify-ca/verify-full.
        return Ok(());
    }
    Err(AppError::ConfigError(
        "The selected connector does not implement the standalone SSL mode. Connection refused rather than ignoring a security setting. Use a connector with documented TLS URL support; do not disable TLS to bypass this error when encryption is required.".into(),
    ))
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::Utc;
    use uuid::Uuid;

    fn config(driver_type: DriverType, mode: Option<&str>, url: Option<&str>) -> ConnectionConfig {
        ConnectionConfig {
            id: Uuid::new_v4(),
            name: "TLS policy test".into(),
            driver_definition_id: None,
            driver_type,
            driver_dialect: None,
            host: Some("invalid.invalid".into()),
            port: None,
            database: Some("db".into()),
            connection_url: url.map(str::to_string),
            username: Some("user".into()),
            password_encrypted: None,
            has_saved_password: false,
            driver_class: None,
            driver_paths: vec![],
            ssl_mode: mode.map(str::to_string),
            group_id: None,
            group: None,
            color_tag: None,
            ssh_tunnel: None,
            created_at: Utc::now(),
            updated_at: Utc::now(),
        }
    }

    #[test]
    fn rejects_every_unimplemented_explicit_encryption_mode() {
        for driver in [DriverType::Mysql, DriverType::Mssql, DriverType::Jdbc] {
            for mode in ["prefer", "require", "verify-ca", "verify-full"] {
                if driver == DriverType::Mysql && mode != "prefer" {
                    continue;
                }
                if driver == DriverType::Mssql && mode == "require" {
                    continue;
                }
                assert!(validate_connection_tls(&config(driver, Some(mode), None), None).is_err());
            }
        }
    }

    #[test]
    fn native_postgres_parameters_accept_all_implemented_modes() {
        for mode in ["disable", "prefer", "require", "verify-ca", "verify-full"] {
            assert!(
                validate_connection_tls(&config(DriverType::Postgres, Some(mode), None), None)
                    .is_ok()
            );
        }
    }

    #[test]
    fn only_native_postgres_and_mysql_parameters_accept_explicit_disable() {
        for driver in [DriverType::Postgres, DriverType::Mysql] {
            assert!(validate_connection_tls(&config(driver, Some("disable"), None), None).is_ok());
        }
        for driver in [DriverType::Mssql, DriverType::Jdbc, DriverType::Sqlite] {
            assert!(validate_connection_tls(&config(driver, Some("disable"), None), None).is_err());
        }
    }

    #[test]
    fn rejects_ambiguous_url_policy_without_echoing_secrets() {
        let secret_url = "postgres://user:private-password@localhost/db?sslmode=require";
        for mode in [
            "disable",
            "prefer",
            "require",
            "verify-ca",
            "verify-full",
            "secret-invalid-mode",
        ] {
            let error = validate_connection_tls(
                &config(DriverType::Postgres, Some(mode), Some(secret_url)),
                None,
            )
            .unwrap_err();
            let message = error.to_string();
            assert!(!message.contains("private-password"));
            assert!(!message.contains("secret-invalid-mode"));
        }
    }

    #[test]
    fn unset_policy_leaves_driver_url_semantics_unchanged() {
        for mode in [None, Some(""), Some("  ")] {
            assert!(validate_connection_tls(
                &config(
                    DriverType::Postgres,
                    mode,
                    Some("postgres://localhost/db?sslmode=require")
                ),
                None
            )
            .is_ok());
        }
    }

    #[test]
    fn native_sql_server_require_does_not_claim_certificate_verification() {
        assert!(
            validate_connection_tls(&config(DriverType::Mssql, Some("require"), None), None)
                .is_ok()
        );
        for mode in ["verify-ca", "verify-full"] {
            assert!(
                validate_connection_tls(&config(DriverType::Mssql, Some(mode), None), None)
                    .is_err()
            );
        }
    }

    #[test]
    fn jdbc_definitions_do_not_inherit_native_parameter_exceptions() {
        let definition = super::super::driver_catalog::driver_definitions()
            .into_iter()
            .find(|item| matches!(item.backend, DriverBackend::Jdbc))
            .unwrap();
        for (driver, mode) in [
            (DriverType::Postgres, "disable"),
            (DriverType::Mysql, "disable"),
            (DriverType::Mssql, "require"),
        ] {
            assert!(
                validate_connection_tls(&config(driver, Some(mode), None), Some(&definition))
                    .is_err()
            );
        }
    }

    #[tokio::test]
    async fn connect_and_test_refuse_unsupported_tls_before_resolving_a_host() {
        let config = config(DriverType::Mysql, Some("prefer"), None);
        assert!(matches!(
            super::super::connection_manager::create_active_connection(&config, None, None).await,
            Err(AppError::ConfigError(_))
        ));
        assert!(matches!(
            super::super::connection_manager::test_connection(&config, None, None).await,
            Err(AppError::ConfigError(_))
        ));
    }
}
