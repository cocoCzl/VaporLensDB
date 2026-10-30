//! Product/definition/installation references. Resolution runs before credentials,
//! tunnels and executors; no failed reference may select another backend.
use super::config_store::{upsert_driver_definition, ConfigStore};
use crate::models::{
    connection::ConnectionConfig,
    driver_catalog::{
        DatabaseProduct, DriverArtifact, DriverBackend, DriverDefinition, DriverInstallation,
    },
    error::AppError,
};
use rusqlite::{params, Connection, OptionalExtension};
use sha2::{Digest, Sha256};
use std::{fs::File, io::Read};

fn invalid(message: impl Into<String>) -> AppError {
    AppError::ConfigError(message.into())
}

pub fn artifact_hash(path: &str) -> Result<String, AppError> {
    let mut file = File::open(path)?;
    let mut hash = Sha256::new();
    let mut bytes = [0; 65536];
    loop {
        let n = file.read(&mut bytes)?;
        if n == 0 {
            break;
        }
        hash.update(&bytes[..n]);
    }
    Ok(format!("{:x}", hash.finalize()))
}

pub(crate) fn migrate_products_and_installations(conn: &Connection) -> Result<(), AppError> {
    conn.execute_batch("
        CREATE TABLE database_products (id TEXT PRIMARY KEY, data_json TEXT NOT NULL);
        CREATE TABLE driver_installations (id TEXT PRIMARY KEY, driver_definition_id TEXT NOT NULL, data_json TEXT NOT NULL);
        ALTER TABLE driver_definitions ADD COLUMN product_id TEXT NOT NULL DEFAULT '';
        ALTER TABLE driver_definitions ADD COLUMN default_installation_id TEXT;
        ALTER TABLE driver_definitions ADD COLUMN native_implementation_id TEXT;
        ALTER TABLE connections ADD COLUMN product_id TEXT;
        ALTER TABLE connections ADD COLUMN driver_installation_id TEXT;
        ALTER TABLE connections ADD COLUMN connection_mode TEXT;
        ALTER TABLE connections ADD COLUMN driver_properties_json TEXT NOT NULL DEFAULT '[]';
        ALTER TABLE connections ADD COLUMN driver_property_secrets_json TEXT NOT NULL DEFAULT '{}';
    ")?;
    for (id, name, adapter) in [
        ("postgres", "PostgreSQL", "postgresql"),
        ("mysql", "MySQL", "mysql"),
        ("sqlite", "SQLite", "sqlite"),
        ("mssql", "SQL Server", "mssql"),
        ("oracle", "Oracle", "oracle"),
        ("jdbc", "Generic JDBC", "genericSql"),
    ] {
        put_product(
            conn,
            &DatabaseProduct {
                id: id.into(),
                name: name.into(),
                icon_key: id.into(),
                built_in: true,
                adapter_id: adapter.into(),
                default_driver_definition_id: id.into(),
            },
        )?;
    }
    // Seed missing builtins only; migration must observe actual pre-upgrade overrides.
    for definition in super::driver_catalog::driver_definitions() {
        let exists: bool = conn.query_row(
            "SELECT EXISTS(SELECT 1 FROM driver_definitions WHERE id=?1)",
            [&definition.id],
            |r| r.get(0),
        )?;
        if !exists {
            upsert_driver_definition(conn, &definition)?;
        }
    }
    let mut stmt = conn.prepare("SELECT id, driver_type, name, built_in, backend, driver_artifacts_json FROM driver_definitions")?;
    let definitions = stmt
        .query_map([], |r| {
            Ok((
                r.get::<_, String>(0)?,
                r.get::<_, String>(1)?,
                r.get::<_, String>(2)?,
                r.get::<_, bool>(3)?,
                r.get::<_, String>(4)?,
                r.get::<_, String>(5)?,
            ))
        })?
        .collect::<Result<Vec<_>, _>>()?;
    // One fingerprint per file in this migration transaction, even when many
    // legacy connections share the same ordered JAR set. Never cache across starts.
    let mut artifact_hashes = std::collections::HashMap::new();
    for (id, legacy, name, builtin, backend, paths) in definitions {
        let product = if builtin || id == "jdbc" {
            legacy.clone()
        } else {
            format!("custom-product:{id}")
        };
        if !builtin && id != "jdbc" {
            put_product(
                conn,
                &DatabaseProduct {
                    id: product.clone(),
                    name,
                    icon_key: "jdbc".into(),
                    built_in: false,
                    adapter_id: "genericSql".into(),
                    default_driver_definition_id: id.clone(),
                },
            )?;
        }
        let native = if backend == "nativeRust" {
            Some(legacy)
        } else {
            None
        };
        conn.execute(
            "UPDATE driver_definitions SET product_id=?2, native_implementation_id=?3 WHERE id=?1",
            params![id, product, native],
        )?;
        let paths: Vec<String> = serde_json::from_str(&paths)?;
        if backend == "jdbc" && !paths.is_empty() {
            let installation =
                legacy_installation_with_hashes(conn, &id, &paths, &mut artifact_hashes)?;
            conn.execute(
                "UPDATE driver_definitions SET default_installation_id=?2 WHERE id=?1",
                params![id, installation],
            )?;
        }
    }
    let mut stmt = conn.prepare("SELECT id, driver_definition_id, driver_type, driver_class, driver_paths, connection_url FROM connections")?;
    let connections = stmt
        .query_map([], |r| {
            Ok((
                r.get::<_, String>(0)?,
                r.get::<_, Option<String>>(1)?,
                r.get::<_, String>(2)?,
                r.get::<_, Option<String>>(3)?,
                r.get::<_, Option<String>>(4)?,
                r.get::<_, Option<String>>(5)?,
            ))
        })?
        .collect::<Result<Vec<_>, _>>()?;
    for (id, explicit, legacy, class, paths, url) in connections {
        let mut definition_id = explicit
            .filter(|s| !s.trim().is_empty())
            .unwrap_or(legacy.clone());
        let definition = conn.query_row("SELECT product_id, backend, jdbc_driver_class, driver_artifacts_json, default_installation_id FROM driver_definitions WHERE id=?1", [&definition_id], |r| Ok((r.get::<_,String>(0)?,r.get::<_,String>(1)?,r.get::<_,Option<String>>(2)?,r.get::<_,String>(3)?,r.get::<_,Option<String>>(4)?))).optional()?;
        let (product, installation) = if let Some((
            product,
            backend,
            definition_class,
            definition_paths,
            default_installation,
        )) = definition
        {
            let own_paths: Vec<String> = serde_json::from_str(paths.as_deref().unwrap_or("[]"))?;
            if backend == "jdbc" {
                // Class overrides are definitions, never hidden installation state.
                if class.as_deref().is_some_and(|s| !s.trim().is_empty())
                    && class != definition_class
                {
                    let derived = format!("legacy-connection:{id}");
                    // Copy the row through SQLite's named columns, preserving old schema fields.
                    let cols = conn
                        .prepare("PRAGMA table_info(driver_definitions)")?
                        .query_map([], |r| r.get::<_, String>(1))?
                        .collect::<Result<Vec<_>, _>>()?;
                    let projection = cols
                        .iter()
                        .map(|c| {
                            if c == "id" {
                                "?2".to_string()
                            } else {
                                format!("\"{c}\"")
                            }
                        })
                        .collect::<Vec<_>>()
                        .join(",");
                    conn.execute(&format!("INSERT INTO driver_definitions SELECT {projection} FROM driver_definitions WHERE id=?1"), params![definition_id, derived])?;
                    conn.execute("UPDATE driver_definitions SET jdbc_driver_class=?2, built_in=0, default_installation_id=NULL WHERE id=?1", params![derived, class])?;
                    definition_id = derived;
                }
                let effective_paths = if own_paths.is_empty() {
                    serde_json::from_str(&definition_paths)?
                } else {
                    own_paths
                };
                let install = if effective_paths.is_empty() {
                    default_installation
                } else {
                    Some(legacy_installation_with_hashes(
                        conn,
                        &definition_id,
                        &effective_paths,
                        &mut artifact_hashes,
                    )?)
                };
                (product, install)
            } else {
                (product, None)
            }
        } else {
            (legacy.clone(), None)
        }; // retain broken explicit references for repair
        let mode = infer_connection_mode(&legacy, url.as_deref());
        conn.execute("UPDATE connections SET product_id=?2, driver_definition_id=?3, driver_installation_id=?4, connection_mode=?5 WHERE id=?1", params![id, product, definition_id, installation, mode])?;
    }
    Ok(())
}

pub fn infer_connection_mode(legacy: &str, url: Option<&str>) -> String {
    if legacy == "sqlite" {
        "file"
    } else if url.is_some_and(|s| !s.trim().is_empty()) {
        "urlOnly"
    } else if legacy == "oracle" {
        "oracleService"
    } else {
        "hostPort"
    }
    .into()
}

fn put_product(conn: &Connection, product: &DatabaseProduct) -> Result<(), AppError> {
    conn.execute("INSERT INTO database_products VALUES (?1, ?2) ON CONFLICT(id) DO UPDATE SET data_json=excluded.data_json", params![product.id, serde_json::to_string(product)?])?;
    Ok(())
}
fn put_installation(conn: &Connection, installation: &DriverInstallation) -> Result<(), AppError> {
    let previous: Option<String> = conn
        .query_row(
            "SELECT data_json FROM driver_installations WHERE id=?1",
            [&installation.id],
            |r| r.get(0),
        )
        .optional()?;
    if previous
        .as_ref()
        .is_some_and(|value| value != &serde_json::to_string(installation).unwrap_or_default())
    {
        return Err(invalid(
            "Installation content is immutable; create a new installation identity",
        ));
    }
    conn.execute(
        "INSERT OR IGNORE INTO driver_installations VALUES (?1, ?2, ?3)",
        params![
            installation.id,
            installation.driver_definition_id,
            serde_json::to_string(installation)?
        ],
    )?;
    Ok(())
}
pub(crate) fn legacy_installation(
    conn: &Connection,
    definition: &str,
    paths: &[String],
) -> Result<String, AppError> {
    legacy_installation_with_hashes(
        conn,
        definition,
        paths,
        &mut std::collections::HashMap::new(),
    )
}

fn legacy_installation_with_hashes(
    conn: &Connection,
    definition: &str,
    paths: &[String],
    hashes: &mut std::collections::HashMap<String, Option<String>>,
) -> Result<String, AppError> {
    let fingerprint = format!(
        "{:x}",
        Sha256::digest(serde_json::to_vec(&(definition, paths))?)
    );
    let id = format!("legacy:{fingerprint}");
    let artifacts = paths
        .iter()
        .enumerate()
        .map(|(i, path)| DriverArtifact {
            path: path.clone(),
            sha256: hashes
                .entry(path.clone())
                .or_insert_with(|| {
                    super::super::utils::startup::mark("migration_hash_started");
                    let hash = artifact_hash(path).ok();
                    super::super::utils::startup::mark("migration_hash_finished");
                    hash
                })
                .clone(),
            role: if i == 0 { "primary" } else { "dependency" }.into(),
        })
        .collect();
    put_installation(
        conn,
        &DriverInstallation {
            version: None,
            source: None,
            id: id.clone(),
            driver_definition_id: definition.into(),
            label: "Legacy ordered dependency set (version unverified)".into(),
            artifacts,
            java_requirement: "Java 21+ (bridge)".into(),
            validation: None,
        },
    )?;
    Ok(id)
}

impl ConfigStore {
    pub fn list_database_products(&self) -> Result<Vec<DatabaseProduct>, AppError> {
        let conn = self.conn()?;
        let mut stmt = conn.prepare("SELECT data_json FROM database_products ORDER BY id")?;
        let json = stmt
            .query_map([], |r| r.get::<_, String>(0))?
            .collect::<Result<Vec<_>, _>>()?;
        json.iter()
            .map(|s| serde_json::from_str(s).map_err(Into::into))
            .collect()
    }
    pub fn save_database_product(
        &self,
        mut product: DatabaseProduct,
    ) -> Result<DatabaseProduct, AppError> {
        if product.id.is_empty() {
            product.id = format!("product-{}", uuid::Uuid::new_v4());
        }
        if product.name.trim().is_empty() {
            return Err(invalid("Product name is required"));
        }
        if self
            .list_database_products()?
            .iter()
            .any(|p| p.id == product.id && p.built_in)
        {
            return Err(invalid("Built-in products are read-only"));
        }
        if ![
            "genericSql",
            "postgresql",
            "mysql",
            "sqlite",
            "oracle",
            "mssql",
        ]
        .contains(&product.adapter_id.as_str())
        {
            return Err(invalid("Unknown product adapter"));
        }
        if let Some(existing) = self
            .list_database_products()?
            .iter()
            .find(|p| p.id == product.id)
        {
            if existing.adapter_id != product.adapter_id
                && self
                    .list_connections()?
                    .iter()
                    .any(|c| c.product_id.as_deref() == Some(&product.id))
            {
                return Err(invalid(
                    "Product adapter is referenced by saved connections; migrate them first",
                ));
            }
            if existing.default_driver_definition_id != product.default_driver_definition_id
                && !self.list_driver_definitions()?.iter().any(|d| {
                    d.id == product.default_driver_definition_id && d.product_id == product.id
                })
            {
                return Err(invalid(
                    "Product default driver is missing or belongs to another product",
                ));
            }
        }
        product.built_in = false;
        put_product(&self.conn()?, &product)?;
        Ok(product)
    }
    pub fn validate_definition_product(
        &self,
        definition: &DriverDefinition,
    ) -> Result<(), AppError> {
        if !self
            .list_database_products()?
            .iter()
            .any(|p| p.id == definition.product_id)
        {
            return Err(invalid(
                "Driver product is missing; repair its product reference",
            ));
        }
        if matches!(definition.backend, DriverBackend::NativeRust)
            && !matches!(
                definition.native_implementation_id.as_deref(),
                Some("postgres" | "mysql" | "sqlite" | "mssql")
            )
        {
            return Err(invalid("Native implementation is not registered"));
        }
        if matches!(definition.backend, DriverBackend::NativeRust)
            && (definition.native_implementation_id.as_deref()
                != Some(definition.product_id.as_str())
                || definition.jdbc_driver_class.is_some()
                || definition.default_installation_id.is_some()
                || !definition.driver_artifacts.is_empty())
        {
            return Err(invalid("Native definition must match its registered product and cannot require JDBC fields"));
        }
        if matches!(definition.backend, DriverBackend::Jdbc)
            && definition.native_implementation_id.is_some()
        {
            return Err(invalid(
                "JDBC definitions cannot declare a native implementation",
            ));
        }
        Ok(())
    }
    pub fn list_driver_installations(&self) -> Result<Vec<DriverInstallation>, AppError> {
        let conn = self.conn()?;
        let mut stmt = conn.prepare("SELECT data_json FROM driver_installations ORDER BY id")?;
        let json = stmt
            .query_map([], |r| r.get::<_, String>(0))?
            .collect::<Result<Vec<_>, _>>()?;
        json.iter()
            .map(|s| serde_json::from_str(s).map_err(Into::into))
            .collect()
    }
    pub fn record_installation_validation(
        &self,
        installation: &DriverInstallation,
    ) -> Result<(), AppError> {
        let existing = self
            .list_driver_installations()?
            .into_iter()
            .find(|i| i.id == installation.id)
            .ok_or_else(|| invalid("Installation missing"))?;
        if serde_json::to_string(&existing.artifacts)?
            != serde_json::to_string(&installation.artifacts)?
            || existing.driver_definition_id != installation.driver_definition_id
        {
            return Err(invalid("Installation changed during validation"));
        }
        self.conn()?.execute(
            "UPDATE driver_installations SET data_json=?2 WHERE id=?1",
            params![installation.id, serde_json::to_string(installation)?],
        )?;
        Ok(())
    }
    pub fn publish_installation(&self, installation: &DriverInstallation) -> Result<(), AppError> {
        let definition = self
            .get_driver_definition(&installation.driver_definition_id)?
            .ok_or_else(|| invalid("Driver definition missing"))?;
        if !matches!(definition.backend, DriverBackend::Jdbc) {
            return Err(invalid("Installation requires a JDBC definition"));
        }
        if installation.artifacts.is_empty() {
            return Err(invalid("Installation has no artifacts"));
        }
        let conn = self.conn()?;
        conn.execute_batch("BEGIN IMMEDIATE")?;
        let result = (|| {
            // Imports/downloads can finish after another window removed a definition.
            // Check under the same write transaction as publication, not just before it.
            let backend: Option<String> = conn
                .query_row(
                    "SELECT backend FROM driver_definitions WHERE id=?1",
                    [&installation.driver_definition_id],
                    |r| r.get(0),
                )
                .optional()?;
            if backend.as_deref() != Some("jdbc") {
                return Err(invalid(
                    "JDBC definition changed or was removed during installation",
                ));
            }
            put_installation(&conn, installation)?;
            conn.execute("UPDATE driver_definitions SET default_installation_id=?2, driver_artifacts_json=?3 WHERE id=?1",params![installation.driver_definition_id,installation.id,serde_json::to_string(&installation.artifacts.iter().map(|a|&a.path).collect::<Vec<_>>())?])?;
            Ok::<_, AppError>(())
        })();
        match result {
            Ok(()) => {
                conn.execute_batch("COMMIT")?;
                Ok(())
            }
            Err(e) => {
                let _ = conn.execute_batch("ROLLBACK");
                Err(e)
            }
        }
    }
    pub fn delete_driver_installation(&self, id: &str) -> Result<(), AppError> {
        if self
            .list_connections()?
            .iter()
            .any(|c| c.driver_installation_id.as_deref() == Some(id))
        {
            return Err(invalid(
                "Installation is referenced by saved connections; migrate them first",
            ));
        }
        let installation = self
            .list_driver_installations()?
            .into_iter()
            .find(|i| i.id == id)
            .ok_or_else(|| invalid("Installation missing"))?;
        let conn = self.conn()?;
        conn.execute_batch("BEGIN IMMEDIATE")?;
        let result = (|| {
            conn.execute("UPDATE driver_definitions SET default_installation_id=NULL, driver_artifacts_json='[]' WHERE default_installation_id=?1",[id])?;
            conn.execute("DELETE FROM driver_installations WHERE id=?1", [id])?;
            Ok::<_, AppError>(())
        })();
        match result {
            Ok(()) => conn.execute_batch("COMMIT")?,
            Err(e) => {
                let _ = conn.execute_batch("ROLLBACK");
                return Err(e);
            }
        }
        // Filesystem cleanup only after publishing reference removal. Failed cleanup is
        // safe garbage; never remove imported source files or another installation's files.
        let root = self
            .config_dir()
            .join("driver-artifacts")
            .canonicalize()
            .ok();
        for a in installation.artifacts {
            if self.ensure_artifact_unreferenced(&a.path).is_ok() {
                if let (Some(root), Ok(path)) =
                    (&root, std::path::Path::new(&a.path).canonicalize())
                {
                    if path.starts_with(root) {
                        let _ = std::fs::remove_file(path);
                    }
                }
            }
        }
        Ok(())
    }
    pub fn ensure_driver_unreferenced(&self, id: &str) -> Result<(), AppError> {
        if self
            .list_connections()?
            .iter()
            .any(|c| c.driver_definition_id.as_deref() == Some(id))
        {
            return Err(invalid(
                "Driver is referenced by saved connections; migrate them first",
            ));
        }
        Ok(())
    }
    pub fn ensure_artifact_unreferenced(&self, path: &str) -> Result<(), AppError> {
        if self
            .list_driver_installations()?
            .iter()
            .any(|i| i.artifacts.iter().any(|a| a.path == path))
            || self
                .list_connections()?
                .iter()
                .any(|c| c.driver_paths.iter().any(|p| p == path))
        {
            return Err(invalid("Artifact belongs to an immutable installation or saved connection; remove the unreferenced installation first"));
        }
        Ok(())
    }
    /// Compatibility boundary only. Ordinary execution requires explicit references.
    pub fn normalize_connection_references(
        &self,
        config: &mut ConnectionConfig,
    ) -> Result<(), AppError> {
        let legacy_input = config.product_id.is_none();
        if !legacy_input
            && config
                .driver_definition_id
                .as_deref()
                .is_none_or(str::is_empty)
        {
            return Err(invalid(
                "Connection driver reference missing; repair the connection",
            ));
        }
        let id = config
            .driver_definition_id
            .clone()
            .filter(|s| !s.is_empty())
            .unwrap_or_else(|| config.driver_type.to_string());
        config.driver_definition_id = Some(id.clone());
        let mut property_names = std::collections::HashSet::new();
        for property in &config.driver_properties {
            if property.name.trim().is_empty()
                || !property_names.insert(property.name.to_lowercase())
            {
                return Err(invalid("JDBC property names must be nonempty and unique"));
            }
            if ["user", "username", "password"].contains(&property.name.to_lowercase().as_str()) {
                return Err(invalid("Use the dedicated username/password fields"));
            }
        }
        if config.connection_mode.is_none() {
            config.connection_mode = Some(infer_connection_mode(
                &config.driver_type.to_string(),
                config.connection_url.as_deref(),
            ));
        }
        let Some(mut definition) = self.get_driver_definition(&id)? else {
            return Ok(());
        };
        if config
            .product_id
            .as_deref()
            .is_some_and(|p| p != definition.product_id)
        {
            return Err(invalid("Connection product does not match selected driver"));
        }
        config.product_id = Some(definition.product_id.clone());
        self.validate_definition_product(&definition)?;
        if legacy_input
            && matches!(definition.backend, DriverBackend::Jdbc)
            && config.driver_installation_id.is_none()
        {
            if config
                .driver_class
                .as_deref()
                .is_some_and(|s| !s.is_empty())
                && config.driver_class != definition.jdbc_driver_class
            {
                definition.id = format!("legacy-connection:{}", config.id);
                definition.built_in = false;
                definition.jdbc_driver_class = config.driver_class.clone();
                definition.default_installation_id = None;
                upsert_driver_definition(&self.conn()?, &definition)?;
                config.driver_definition_id = Some(definition.id.clone());
            }
            config.driver_installation_id = if config.driver_paths.is_empty() {
                definition.default_installation_id.clone()
            } else {
                Some(legacy_installation(
                    &self.conn()?,
                    &definition.id,
                    &config.driver_paths,
                )?)
            };
        }
        if let Some(id) = &config.driver_installation_id {
            if let Some(i) = self
                .list_driver_installations()?
                .iter()
                .find(|i| &i.id == id)
            {
                if Some(&i.driver_definition_id) != config.driver_definition_id.as_ref() {
                    return Err(invalid("Installation belongs to another driver"));
                }
            }
        }
        Ok(())
    }
    /// Product adapter, independent of backend and claimed SQL syntax.
    pub fn connection_product_type(
        &self,
        config: &ConnectionConfig,
    ) -> Result<crate::models::connection::DriverType, AppError> {
        use crate::models::connection::DriverType;
        let product_id = config
            .product_id
            .as_deref()
            .unwrap_or(match config.driver_type {
                DriverType::Postgres => "postgres",
                DriverType::Mysql => "mysql",
                DriverType::Sqlite => "sqlite",
                DriverType::Mssql => "mssql",
                DriverType::Oracle => "oracle",
                DriverType::Jdbc => "jdbc",
                DriverType::Mongo => "mongo",
                DriverType::Redis => "redis",
            });
        let product = self
            .list_database_products()?
            .into_iter()
            .find(|p| p.id == product_id)
            .ok_or_else(|| invalid("Connection product missing"))?;
        Ok(match product.adapter_id.as_str() {
            "postgresql" => DriverType::Postgres,
            "mysql" => DriverType::Mysql,
            "sqlite" => DriverType::Sqlite,
            "mssql" => DriverType::Mssql,
            "oracle" => DriverType::Oracle,
            _ => DriverType::Jdbc,
        })
    }
    pub fn resolve_connection(
        &self,
        config: &ConnectionConfig,
    ) -> Result<(ConnectionConfig, DriverDefinition), AppError> {
        let mut config = config.clone();
        self.normalize_connection_references(&mut config)?;
        let id = config
            .driver_definition_id
            .as_deref()
            .ok_or_else(|| invalid("Missing driver reference"))?;
        let definition = self.get_driver_definition(id)?.ok_or_else(|| {
            invalid(format!(
                "Driver definition missing: {id}; repair the connection"
            ))
        })?;
        self.validate_definition_product(&definition)?;
        let mut secrets = crate::utils::crypto::SecretOperation::new(self.config_dir());
        for property in &mut config.driver_properties {
            if property.sensitive && property.value.as_deref().is_none_or(|v| v.is_empty()) {
                if let Some(encrypted) = &property.encrypted_value {
                    property.value = Some(secrets.decrypt(encrypted)?.plaintext);
                }
            }
        }
        let mode = config
            .connection_mode
            .as_deref()
            .ok_or_else(|| invalid("Connection mode missing"))?;
        if !definition.connection_variants.iter().any(|v| v.id == mode) {
            return Err(invalid(
                "Connection mode is not supported by selected driver",
            ));
        }
        if matches!(definition.backend, DriverBackend::Jdbc) {
            let installation = config.driver_installation_id.as_deref().ok_or_else(|| {
                invalid("JDBC installation missing; import and select a driver installation")
            })?;
            let installation = self
                .list_driver_installations()?
                .into_iter()
                .find(|i| i.id == installation)
                .ok_or_else(|| {
                    invalid("Selected JDBC installation is missing; repair the connection")
                })?;
            if installation.driver_definition_id != definition.id {
                return Err(invalid("Installation belongs to another driver"));
            }
            for artifact in &installation.artifacts {
                let hash = artifact_hash(&artifact.path).map_err(|_| {
                    invalid("Selected JDBC installation file is missing or unreadable")
                })?;
                if artifact
                    .sha256
                    .as_ref()
                    .is_some_and(|expected| expected != &hash)
                {
                    return Err(invalid(
                        "JDBC installation file changed; import a new installation",
                    ));
                }
            }
            if installation.artifacts.is_empty() {
                return Err(invalid("Selected JDBC installation has no artifacts"));
            }
            config.driver_paths = installation.artifacts.into_iter().map(|a| a.path).collect();
            config.driver_class = definition.jdbc_driver_class.clone();
            if mode != "urlOnly" {
                config.connection_url = Some(build_jdbc_url(&config, &definition)?);
            }
        } else if !matches!(definition.backend, DriverBackend::NativeRust) {
            return Err(invalid("Driver backend cannot execute connections"));
        }
        if matches!(definition.backend, DriverBackend::NativeRust) {
            if !config.driver_properties.is_empty() {
                return Err(invalid("Driver properties are supported only by JDBC"));
            }
            if mode != "urlOnly" && mode != "file" {
                config.connection_url = None;
            }
        }
        config.driver_type = if matches!(definition.backend, DriverBackend::NativeRust) {
            definition
                .native_implementation_id
                .as_deref()
                .ok_or_else(|| invalid("Missing native implementation"))?
                .parse()
                .map_err(invalid)?
        } else {
            self.connection_product_type(&config)?
        };
        if config.driver_dialect.is_none() {
            config.driver_dialect = Some(definition.driver_dialect.clone());
        }
        Ok((config, definition))
    }
}

pub fn build_jdbc_url(
    config: &ConnectionConfig,
    definition: &DriverDefinition,
) -> Result<String, AppError> {
    let mode = config.connection_mode.as_deref().unwrap_or("urlOnly");
    if mode == "urlOnly" {
        return config
            .connection_url
            .clone()
            .ok_or_else(|| invalid("JDBC URL required"));
    }
    let path = config.connection_url.as_deref().unwrap_or("");
    if mode == "file" && definition.product_id == "sqlite" {
        return Ok(if path.starts_with("jdbc:sqlite:") {
            path.into()
        } else {
            format!("jdbc:sqlite:{path}")
        });
    }
    let template = if mode == "oracleSid" && definition.product_id == "oracle" {
        "jdbc:oracle:thin:@{host}:{port}:{database}"
    } else {
        definition
            .url_template
            .as_deref()
            .ok_or_else(|| invalid("Structured mode requires a URL template"))?
    };
    let url = template
        .replace("{host}", config.host.as_deref().unwrap_or("localhost"))
        .replace(
            "{port}",
            &config
                .port
                .or(definition.default_port)
                .map(|p| p.to_string())
                .unwrap_or_default(),
        )
        .replace("{file}", path)
        .replace("{database}", config.database.as_deref().unwrap_or(""))
        .replace("{username}", config.username.as_deref().unwrap_or(""));
    if url.contains('{') || !url.starts_with("jdbc:") {
        return Err(invalid("Unsupported JDBC URL template placeholder"));
    }
    Ok(url)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    fn store() -> ConfigStore {
        ConfigStore::new(
            std::env::temp_dir().join(format!("vapor-driver-registry-{}", uuid::Uuid::new_v4())),
        )
        .unwrap()
    }
    fn config(driver: &str) -> ConnectionConfig {
        serde_json::from_value(json!({"id":uuid::Uuid::new_v4(),"name":"fixture","driverType":"jdbc","driverDefinitionId":driver,"driverPaths":[],"createdAt":chrono::Utc::now(),"updatedAt":chrono::Utc::now()})).unwrap()
    }
    fn custom(store: &ConfigStore, id: &str, product: Option<&str>) -> DriverDefinition {
        let mut d = super::super::driver_catalog::driver_definitions()
            .into_iter()
            .find(|d| d.id == "jdbc")
            .unwrap();
        d.id = id.into();
        d.name = id.into();
        d.product_id = product.unwrap_or("").into();
        d.built_in = false;
        d.jdbc_driver_class = Some("example.Driver".into());
        store.save_custom_driver_definition(d).unwrap()
    }
    #[test]
    fn migration_hash_snapshot_preserves_order_and_definition_identity_without_persistent_cache() {
        let store = store();
        let root =
            std::env::temp_dir().join(format!("vapor-migration-hash-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&root).unwrap();
        let primary = root.join("main.jar");
        let dependency = root.join("dependency.jar");
        std::fs::write(&primary, b"primary").unwrap();
        std::fs::write(&dependency, b"dependency").unwrap();
        let paths = vec![
            primary.to_string_lossy().into_owned(),
            dependency.to_string_lossy().into_owned(),
        ];
        let conn = store.conn().unwrap();
        let mut hashes = std::collections::HashMap::new();
        let first =
            legacy_installation_with_hashes(&conn, "legacy-a", &paths, &mut hashes).unwrap();
        assert_eq!(
            first,
            legacy_installation_with_hashes(&conn, "legacy-a", &paths, &mut hashes).unwrap()
        );
        let second =
            legacy_installation_with_hashes(&conn, "legacy-b", &paths, &mut hashes).unwrap();
        assert_ne!(first, second);
        assert_eq!(hashes.len(), 2);
        let installations = store.list_driver_installations().unwrap();
        for id in [&first, &second] {
            let install = installations.iter().find(|i| &i.id == id).unwrap();
            assert_eq!(
                install
                    .artifacts
                    .iter()
                    .map(|a| a.path.clone())
                    .collect::<Vec<_>>(),
                paths
            );
            assert_eq!(install.artifacts[0].role, "primary");
            assert_eq!(install.artifacts[1].role, "dependency");
            assert_eq!(
                install.artifacts[0].sha256,
                Some(artifact_hash(&paths[0]).unwrap())
            );
        }
        // Outside this migration snapshot, a changed artifact is re-read and
        // immutable installations still reject silently replacing its content.
        std::fs::write(&primary, b"changed").unwrap();
        assert!(legacy_installation(&conn, "legacy-a", &paths).is_err());
        std::fs::remove_dir_all(root).unwrap();
    }
    #[test]
    fn arbitrary_products_have_stable_independent_identities_and_support_multiple_definitions() {
        let store = store();
        let a = custom(&store, "Aurora arbitrary A", None);
        let b = custom(&store, "Arbitrary B", None);
        assert_ne!(a.product_id, b.product_id);
        let a2 = custom(&store, "A version 2", Some(&a.product_id));
        assert_eq!(a2.product_id, a.product_id);
        let mut product = store
            .list_database_products()
            .unwrap()
            .into_iter()
            .find(|p| p.id == a.product_id)
            .unwrap();
        product.name = "Renamed display".into();
        store.save_database_product(product).unwrap();
        let c = store.create_connection(config(&a.id), None, false).unwrap();
        let id = c.id;
        let reopened = ConfigStore::new(store.config_dir().into()).unwrap();
        let c = reopened.get_connection(id).unwrap().unwrap();
        assert_eq!(c.product_id.as_deref(), Some(a.product_id.as_str()));
        assert_eq!(c.driver_definition_id.as_deref(), Some(a.id.as_str()));
        assert_eq!(
            reopened
                .list_database_products()
                .unwrap()
                .iter()
                .filter(|p| !p.built_in)
                .count(),
            2
        );
    }
    #[test]
    fn installations_are_pinned_and_missing_or_modified_references_never_fall_back() {
        let store = store();
        let d = custom(&store, "Example driver", None);
        let artifact = store.config_dir().join("fixture.jar");
        std::fs::write(&artifact, b"deterministic fixture").unwrap();
        let install = |id: &str| DriverInstallation {
            version: None,
            source: None,
            id: id.into(),
            driver_definition_id: d.id.clone(),
            label: id.into(),
            artifacts: vec![DriverArtifact {
                path: artifact.to_string_lossy().into_owned(),
                sha256: Some(artifact_hash(artifact.to_str().unwrap()).unwrap()),
                role: "primary".into(),
            }],
            java_requirement: "unverified".into(),
            validation: None,
        };
        store.publish_installation(&install("v1")).unwrap();
        let mut c = config(&d.id);
        c.connection_url = Some("jdbc:example:fixture".into());
        let c = store.create_connection(c, None, false).unwrap();
        assert_eq!(c.driver_installation_id.as_deref(), Some("v1"));
        store.publish_installation(&install("v2")).unwrap();
        assert_eq!(
            store
                .resolve_connection(&c)
                .unwrap()
                .0
                .driver_installation_id
                .as_deref(),
            Some("v1")
        );
        assert!(store.delete_driver_installation("v1").is_err());
        assert!(store.delete_custom_driver_definition(&d.id).is_err());
        assert!(store
            .ensure_artifact_unreferenced(artifact.to_str().unwrap())
            .is_err());
        let mut broken = c.clone();
        broken.driver_installation_id = Some("deleted".into());
        assert!(store
            .resolve_connection(&broken)
            .unwrap_err()
            .to_string()
            .contains("missing"));
        broken = c.clone();
        broken.driver_definition_id = Some("deleted".into());
        assert!(store
            .resolve_connection(&broken)
            .unwrap_err()
            .to_string()
            .contains("missing"));
        broken = c.clone();
        broken.product_id = Some("postgres".into());
        assert!(store.resolve_connection(&broken).is_err());
        std::fs::write(&artifact, b"changed").unwrap();
        assert!(store
            .resolve_connection(&c)
            .unwrap_err()
            .to_string()
            .contains("changed"));
    }
    #[test]
    fn native_references_are_registered_and_need_no_java_or_installation() {
        let store = store();
        let mut c = config("postgres");
        c.driver_type = crate::models::connection::DriverType::Postgres;
        let (c, d) = store.resolve_connection(&c).unwrap();
        assert_eq!(d.backend.to_string(), "nativeRust");
        assert_eq!(c.product_id.as_deref(), Some("postgres"));
        assert!(c.driver_installation_id.is_none());
        let mut fake = d;
        fake.native_implementation_id = Some("imaginary".into());
        assert!(store.validate_definition_product(&fake).is_err());
    }
    #[test]
    fn arbitrary_file_mode_substitutes_path_without_vendor_checks() {
        let store = store();
        let mut d = custom(&store, "file-fixture", None);
        d.url_template = Some("jdbc:arbitrary:file:{file}".into());
        let mut c = config(&d.id);
        c.connection_mode = Some("file".into());
        c.connection_url = Some("/tmp/a database.file".into());
        assert_eq!(
            build_jdbc_url(&c, &d).unwrap(),
            "jdbc:arbitrary:file:/tmp/a database.file"
        );
        // Adapter authority is the product, not JDBC backend or dialect claims.
        c.product_id = Some(d.product_id.clone());
        c.driver_dialect = Some("oracle".into());
        assert_eq!(
            store.connection_product_type(&c).unwrap(),
            crate::models::connection::DriverType::Jdbc
        );
        c.product_id = Some("postgres".into());
        assert_eq!(
            store.connection_product_type(&c).unwrap(),
            crate::models::connection::DriverType::Postgres
        );
        let mut native = store.get_driver_definition("postgres").unwrap().unwrap();
        native.native_implementation_id = Some("mysql".into());
        assert!(store.validate_definition_product(&native).is_err());
    }
    #[test]
    fn structured_modes_rebuild_urls_and_oracle_sid_is_distinct() {
        let store = store();
        let d = store.get_driver_definition("oracle").unwrap().unwrap();
        let mut c = config("oracle");
        c.host = Some("localhost".into());
        c.port = Some(1522);
        c.database = Some("sample".into());
        c.connection_url = Some("stale URL".into());
        c.connection_mode = Some("oracleService".into());
        assert_eq!(
            build_jdbc_url(&c, &d).unwrap(),
            "jdbc:oracle:thin:@//localhost:1522/sample"
        );
        c.connection_mode = Some("oracleSid".into());
        assert_eq!(
            build_jdbc_url(&c, &d).unwrap(),
            "jdbc:oracle:thin:@localhost:1522:sample"
        );
        c.host = Some("127.0.0.1".into());
        c.port = Some(46001);
        assert!(build_jdbc_url(&c, &d).unwrap().contains("127.0.0.1:46001"));
        c.connection_mode = Some("urlOnly".into());
        assert_eq!(build_jdbc_url(&c, &d).unwrap(), "stale URL");
    }
    #[test]
    fn sensitive_properties_are_encrypted_preserved_and_absent_from_export() {
        std::env::set_var("VAPORLENSDB_USE_DEV_KEY", "1");
        let store = store();
        let d = custom(&store, "Property fixture", None);
        let mut c = config(&d.id);
        c.driver_properties=serde_json::from_value(json!([{"name":"arbitraryCredential","value":"propertySecretFixture"},{"name":"visibleSetting","value":"display","sensitive":false}])).unwrap();
        let saved = store.create_connection(c, None, false).unwrap();
        assert!(saved.driver_properties[0].value.is_none());
        assert!(saved.driver_properties[0].has_saved_value);
        let raw:String=store.conn().unwrap().query_row("SELECT driver_properties_json || driver_property_secrets_json FROM connections WHERE id=?1",[saved.id.to_string()],|r|r.get(0)).unwrap();
        assert!(!raw.contains("propertySecretFixture"));
        assert!(raw.contains("display"));
        let reopened = store.get_connection(saved.id).unwrap().unwrap();
        let updated = store.update_connection(reopened, None, false).unwrap();
        assert_eq!(
            saved.driver_properties[0].encrypted_value,
            updated.driver_properties[0].encrypted_value
        );
        let exported =
            serde_json::to_string(&store.export_driver_configuration().unwrap()).unwrap();
        assert!(!exported.contains("propertySecretFixture"));
        assert!(!exported.contains("encryptedValue"));
        let mut property = updated.driver_properties[0].clone();
        property.value = Some("propertySecretFixture".into());
        assert!(!format!("{:?}", property).contains("propertySecretFixture"));
    }
    #[test]
    fn modern_missing_installation_never_repins_or_creates_legacy_definitions() {
        let store = store();
        let d = custom(&store, "missing-installation-regression", None);
        let artifact = store.config_dir().join("fixture.jar");
        std::fs::write(&artifact, b"fixture").unwrap();
        store
            .publish_installation(&DriverInstallation {
                version: None,
                source: None,
                id: "new-default".into(),
                driver_definition_id: d.id.clone(),
                label: "new default".into(),
                java_requirement: "21".into(),
                validation: None,
                artifacts: vec![DriverArtifact {
                    path: artifact.to_string_lossy().into_owned(),
                    sha256: None,
                    role: "primary".into(),
                }],
            })
            .unwrap();
        let mut c = config(&d.id);
        c.product_id = Some(d.product_id.clone());
        c.connection_url = Some("jdbc:example:fixture".into());
        c.driver_class = Some("stale.Driver".into());
        c.driver_paths = vec![artifact.to_string_lossy().into_owned()];
        let before = store.list_driver_definitions().unwrap().len();
        let saved = store.create_connection(c, None, false).unwrap();
        assert!(saved.driver_installation_id.is_none());
        assert!(store
            .resolve_connection(&saved)
            .unwrap_err()
            .to_string()
            .contains("installation missing"));
        assert_eq!(
            store.list_driver_definitions().unwrap().len(),
            before,
            "ordinary resolution cannot create compatibility definitions"
        );
        let mut bundle = store.export_driver_configuration().unwrap();
        bundle.connections[0].id = uuid::Uuid::new_v4();
        let imported_id = bundle.connections[0].id;
        store.import_driver_configuration(bundle).unwrap();
        assert!(store
            .get_connection(imported_id)
            .unwrap()
            .unwrap()
            .driver_installation_id
            .is_none());
        let mut missing_definition = saved;
        missing_definition.driver_definition_id = None;
        assert!(store.resolve_connection(&missing_definition).is_err());
    }
    #[test]
    fn referenced_definition_cannot_change_metadata_defaults_or_capabilities() {
        let store = store();
        let d = custom(&store, "referenced-definition", None);
        let mut c = config(&d.id);
        c.product_id = Some(d.product_id.clone());
        store.create_connection(c, None, false).unwrap();
        let mut edits = vec![d.clone(); 3];
        edits[0].metadata_dialect_sql = Some("SELECT 'different metadata rules'".into());
        edits[1].default_port = Some(6543);
        edits[2].capabilities.can_read_metadata = !d.capabilities.can_read_metadata;
        for edit in edits {
            assert!(store
                .save_custom_driver_definition(edit)
                .unwrap_err()
                .to_string()
                .contains("referenced by saved connections"));
            let unchanged = store.get_driver_definition(&d.id).unwrap().unwrap();
            assert_eq!(unchanged.metadata_dialect_sql, d.metadata_dialect_sql);
            assert_eq!(unchanged.default_port, d.default_port);
            assert_eq!(
                unchanged.capabilities.can_read_metadata,
                d.capabilities.can_read_metadata
            );
        }
        let renamed = store
            .save_custom_driver_definition(DriverDefinition {
                name: "Display rename".into(),
                ..d
            })
            .unwrap();
        assert_eq!(renamed.name, "Display rename");
    }

    #[test]
    fn definition_deletion_and_product_edits_cannot_leave_dangling_runtime_references() {
        let store = store();
        let d = custom(&store, "deletion-regression", None);
        assert!(store
            .delete_custom_driver_definition(&d.id)
            .unwrap_err()
            .to_string()
            .contains("product default"));
        let second = custom(&store, "second-definition", Some(&d.product_id));
        let path = store.config_dir().join("fixture.jar");
        std::fs::write(&path, b"fixture").unwrap();
        store
            .publish_installation(&DriverInstallation {
                version: None,
                source: None,
                id: "owned-install".into(),
                driver_definition_id: second.id.clone(),
                label: "owned".into(),
                java_requirement: "21".into(),
                validation: None,
                artifacts: vec![DriverArtifact {
                    path: path.to_string_lossy().into_owned(),
                    sha256: None,
                    role: "primary".into(),
                }],
            })
            .unwrap();
        assert!(store
            .delete_custom_driver_definition(&second.id)
            .unwrap_err()
            .to_string()
            .contains("owns installations"));
        store.delete_driver_installation("owned-install").unwrap();
        store.delete_custom_driver_definition(&second.id).unwrap();
        let mut bad_default = d.clone();
        bad_default.default_installation_id = Some("missing".into());
        assert!(store.save_custom_driver_definition(bad_default).is_err());
        let mut c = config(&d.id);
        c.product_id = Some(d.product_id.clone());
        store.create_connection(c, None, false).unwrap();
        let mut p = store
            .list_database_products()
            .unwrap()
            .into_iter()
            .find(|p| p.id == d.product_id)
            .unwrap();
        p.adapter_id = "oracle".into();
        assert!(store.save_database_product(p).is_err());
    }
}
