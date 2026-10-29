//! Portable configuration descriptions. Binary artifacts and credentials are
//! deliberately excluded. Imports publish all references in one SQLite transaction.
use super::{
    config_store::{
        encrypt_driver_properties, params_from_config, upsert_driver_definition, ConfigStore,
    },
    driver_registry::{infer_connection_mode, legacy_installation},
};
use crate::models::{
    connection::ConnectionConfig,
    data_source_group::DataSourceGroup,
    driver_catalog::{DatabaseProduct, DriverBackend, DriverDefinition, DriverInstallation},
    error::AppError,
};
use rusqlite::params;
use serde::{Deserialize, Serialize};
#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DriverConfigurationBundle {
    #[serde(default)]
    pub schema_version: u32,
    #[serde(default)]
    pub products: Vec<DatabaseProduct>,
    #[serde(default)]
    pub drivers: Vec<DriverDefinition>,
    #[serde(default)]
    pub installations: Vec<DriverInstallation>,
    #[serde(default)]
    pub groups: Vec<DataSourceGroup>,
    pub connections: Vec<ConnectionConfig>,
}
fn invalid(s: &str) -> AppError {
    AppError::ConfigError(s.into())
}
impl ConfigStore {
    pub fn export_driver_configuration(&self) -> Result<DriverConfigurationBundle, AppError> {
        Ok(DriverConfigurationBundle {
            schema_version: 13,
            products: self.list_database_products()?,
            drivers: self.list_driver_definitions()?,
            installations: self
                .list_driver_installations()?
                .into_iter()
                .map(|mut i| {
                    i.validation = None;
                    i
                })
                .collect(),
            groups: self.list_data_source_groups()?,
            connections: self.list_connections()?,
        })
    }
    /// Only adds new UUIDs; collisions require explicit editing through normal
    /// lifecycle protection. No import can change an active connection behind a lease.
    pub fn import_driver_configuration(
        &self,
        mut bundle: DriverConfigurationBundle,
    ) -> Result<usize, AppError> {
        if bundle.schema_version > 13 {
            return Err(invalid("Configuration is from a newer schema"));
        }
        let mut products = self.list_database_products()?;
        let mut drivers = self.list_driver_definitions()?;
        let mut installations = self.list_driver_installations()?;
        let existing = self.list_connections()?;
        let mut seen = std::collections::HashSet::new();
        if bundle
            .connections
            .iter()
            .any(|c| !seen.insert(c.id) || existing.iter().any(|e| e.id == c.id))
        {
            return Err(invalid(
                "Connection UUID already exists; import never overwrites existing connections",
            ));
        }
        let conn = self.conn()?;
        conn.execute_batch("BEGIN IMMEDIATE")?;
        let result = (|| {
            for p in &bundle.products {
                if let Some(existing) = products.iter().find(|e| e.id == p.id) {
                    if !existing.built_in
                        && serde_json::to_string(existing)? != serde_json::to_string(p)?
                    {
                        return Err(invalid("Product identity conflict"));
                    }
                    continue;
                }
                if p.built_in
                    || p.name.trim().is_empty()
                    || ![
                        "genericSql",
                        "postgresql",
                        "mysql",
                        "oracle",
                        "mssql",
                        "sqlite",
                    ]
                    .contains(&p.adapter_id.as_str())
                {
                    return Err(invalid("Invalid imported product"));
                }
                conn.execute(
                    "INSERT INTO database_products VALUES (?1,?2)",
                    params![p.id, serde_json::to_string(p)?],
                )?;
                products.push(p.clone());
            }
            for d in &mut bundle.drivers {
                if let Some(existing) = drivers.iter().find(|e| e.id == d.id) {
                    if !existing.built_in
                        && serde_json::to_string(existing)? != serde_json::to_string(d)?
                    {
                        return Err(invalid(
                            "Driver identity conflict; copy the definition with a new identity",
                        ));
                    }
                    continue;
                }
                if !matches!(d.backend, DriverBackend::Jdbc) {
                    return Err(invalid(
                        "Imported custom native implementations are not executable",
                    ));
                }
                if d.product_id.is_empty() {
                    d.product_id = format!("custom-product:{}", d.id);
                    let p = DatabaseProduct {
                        id: d.product_id.clone(),
                        name: d.name.clone(),
                        built_in: false,
                        icon_key: "jdbc".into(),
                        adapter_id: "genericSql".into(),
                        default_driver_definition_id: d.id.clone(),
                    };
                    conn.execute(
                        "INSERT OR IGNORE INTO database_products VALUES (?1,?2)",
                        params![p.id, serde_json::to_string(&p)?],
                    )?;
                    products.push(p);
                }
                if !products.iter().any(|p| p.id == d.product_id) {
                    return Err(invalid("Imported driver product missing"));
                }
                d.built_in = false;
                upsert_driver_definition(&conn, d)?;
                drivers.push(d.clone());
            }
            for i in &mut bundle.installations {
                i.validation = None;
                if !drivers.iter().any(|d| {
                    d.id == i.driver_definition_id && matches!(d.backend, DriverBackend::Jdbc)
                }) {
                    return Err(invalid("Imported installation driver missing"));
                }
                if let Some(e) = installations.iter().find(|e| e.id == i.id) {
                    let mut local = e.clone();
                    local.validation = None;
                    if serde_json::to_string(&local)? != serde_json::to_string(i)? {
                        return Err(invalid("Installation identity conflict"));
                    }
                    continue;
                }
                // File presence/class-loading must be revalidated on the destination.
                conn.execute(
                    "INSERT INTO driver_installations VALUES (?1,?2,?3)",
                    params![i.id, i.driver_definition_id, serde_json::to_string(i)?],
                )?;
                installations.push(i.clone());
            }
            for g in &bundle.groups {
                conn.execute("INSERT OR IGNORE INTO data_source_groups(id,name,sort_order,created_at,updated_at) VALUES (?1,?2,?3,?4,?5)",params![g.id.to_string(),g.name,g.sort_order,g.created_at.to_rfc3339(),g.updated_at.to_rfc3339()])?;
            }
            for c in &mut bundle.connections {
                let legacy_input = c.product_id.is_none();
                c.password_encrypted = None;
                c.has_saved_password = false;
                if let Some(t) = &mut c.ssh_tunnel {
                    t.password_encrypted = None;
                    t.private_key_passphrase_encrypted = None;
                }
                let id = c
                    .driver_definition_id
                    .clone()
                    .filter(|s| !s.is_empty())
                    .unwrap_or_else(|| c.driver_type.to_string());
                c.driver_definition_id = Some(id.clone());
                if let Some(d) = drivers.iter().find(|d| d.id == id).cloned() {
                    if c.product_id.as_ref().is_some_and(|p| p != &d.product_id) {
                        return Err(invalid("Imported connection product mismatch"));
                    }
                    c.product_id = Some(d.product_id.clone());
                    if legacy_input
                        && matches!(d.backend, DriverBackend::Jdbc)
                        && c.driver_installation_id.is_none()
                    {
                        let mut effective = d;
                        if c.driver_class.as_deref().is_some_and(|s| !s.is_empty())
                            && c.driver_class != effective.jdbc_driver_class
                        {
                            effective.id = format!("legacy-connection:{}", c.id);
                            effective.jdbc_driver_class = c.driver_class.clone();
                            effective.built_in = false;
                            effective.default_installation_id = None;
                            upsert_driver_definition(&conn, &effective)?;
                            c.driver_definition_id = Some(effective.id.clone());
                        }
                        let paths = if c.driver_paths.is_empty() {
                            &effective.driver_artifacts
                        } else {
                            &c.driver_paths
                        };
                        c.driver_installation_id = if paths.is_empty() {
                            effective.default_installation_id
                        } else {
                            Some(legacy_installation(&conn, &effective.id, paths)?)
                        };
                    }
                    if let Some(i) = installations
                        .iter()
                        .find(|i| Some(&i.id) == c.driver_installation_id.as_ref())
                    {
                        if Some(&i.driver_definition_id) != c.driver_definition_id.as_ref() {
                            return Err(invalid("Imported installation belongs to another driver"));
                        }
                    }
                } // Explicit missing definitions remain repairable, never remapped.
                if c.connection_mode.is_none() {
                    c.connection_mode = Some(infer_connection_mode(
                        &c.driver_type.to_string(),
                        c.connection_url.as_deref(),
                    ));
                }
                if let Some(group) = c.group_id {
                    if !conn.query_row(
                        "SELECT EXISTS(SELECT 1 FROM data_source_groups WHERE id=?1)",
                        [group.to_string()],
                        |r| r.get::<_, bool>(0),
                    )? {
                        c.group_id = None;
                    }
                }
                let mut secrets = crate::utils::crypto::SecretOperation::new(self.config_dir());
                encrypt_driver_properties(&mut secrets, c, None)?;
                conn.execute("INSERT INTO connections(id,name,driver_definition_id,driver_type,driver_dialect,host,port,database_name,connection_url,username,password_encrypted,driver_class,driver_paths,ssl_mode,group_id,group_name,color_tag,ssh_tunnel_json,ssh_password_encrypted,ssh_private_key_passphrase_encrypted,created_at,updated_at,product_id,driver_installation_id,connection_mode,driver_properties_json,driver_property_secrets_json) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15,?16,?17,?18,?19,?20,?21,?22,?23,?24,?25,?26,?27)",params_from_config(c))?;
            }
            Ok::<_, AppError>(bundle.connections.len())
        })();
        match result {
            Ok(count) => {
                conn.execute_batch("COMMIT")?;
                Ok(count)
            }
            Err(e) => {
                let _ = conn.execute_batch("ROLLBACK");
                Err(e)
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    fn store() -> ConfigStore {
        ConfigStore::new(
            std::env::temp_dir().join(format!("vapor-config-bundle-{}", uuid::Uuid::new_v4())),
        )
        .unwrap()
    }
    #[test]
    fn new_and_legacy_configuration_round_trip_without_changing_uuid() {
        let source = store();
        let config:ConnectionConfig=serde_json::from_value(serde_json::json!({"id":uuid::Uuid::new_v4(),"name":"Legacy native","driverType":"postgres","driverPaths":[],"createdAt":chrono::Utc::now(),"updatedAt":chrono::Utc::now()})).unwrap();
        let id = config.id;
        source.create_connection(config, None, false).unwrap();
        let exported = serde_json::to_value(source.export_driver_configuration().unwrap()).unwrap();
        assert_eq!(exported["schemaVersion"], 13);
        assert!(exported["connections"][0]
            .get("passwordEncrypted")
            .is_none());
        let target = store();
        assert_eq!(
            target
                .import_driver_configuration(serde_json::from_value(exported).unwrap())
                .unwrap(),
            1
        );
        assert_eq!(
            target
                .get_connection(id)
                .unwrap()
                .unwrap()
                .driver_definition_id
                .as_deref(),
            Some("postgres")
        );
        let legacy = serde_json::json!({"connections":[{"id":uuid::Uuid::new_v4(),"name":"Old connection","driverType":"mysql","driverPaths":[],"createdAt":chrono::Utc::now(),"updatedAt":chrono::Utc::now()}]});
        assert_eq!(
            target
                .import_driver_configuration(serde_json::from_value(legacy).unwrap())
                .unwrap(),
            1
        );
    }
    #[test]
    fn import_collision_rolls_back_and_never_mutates_an_existing_connection() {
        let source = store();
        let mut bundle = source.export_driver_configuration().unwrap();
        let c:ConnectionConfig=serde_json::from_value(serde_json::json!({"id":uuid::Uuid::new_v4(),"name":"fixture","driverType":"postgres","driverPaths":[],"createdAt":chrono::Utc::now(),"updatedAt":chrono::Utc::now()})).unwrap();
        bundle.connections = vec![c.clone(), c];
        assert!(source.import_driver_configuration(bundle).is_err());
        assert!(source.list_connections().unwrap().is_empty());
    }
}
