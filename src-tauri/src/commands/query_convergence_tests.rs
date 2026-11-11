use super::*;
use crate::models::{connection::ConnectionConfig, driver_catalog::DriverDefinition};
use crate::services::connection_manager::create_active_connection;
use std::sync::Arc;

fn evidence_directory(
    path: &std::path::Path,
    repository: &std::path::Path,
) -> Result<std::path::PathBuf, String> {
    use std::{fs, io::Write, path::Component};
    if !path.is_absolute()
        || path
            .components()
            .any(|part| matches!(part, Component::ParentDir))
    {
        return Err("QA_EVIDENCE_DIR must be an absolute path without parent components".into());
    }
    let repository = repository
        .canonicalize()
        .map_err(|_| "cannot resolve repository for evidence isolation")?;
    let mut ancestor = path;
    let mut missing = Vec::new();
    while !ancestor.exists() {
        missing.push(ancestor.file_name().ok_or("invalid QA_EVIDENCE_DIR")?);
        ancestor = ancestor.parent().ok_or("invalid QA_EVIDENCE_DIR")?;
    }
    let mut resolved = ancestor
        .canonicalize()
        .map_err(|_| "cannot resolve QA_EVIDENCE_DIR")?;
    for component in missing.iter().rev() {
        resolved.push(component);
    }
    if resolved.starts_with(&repository) {
        return Err("QA_EVIDENCE_DIR must be outside the repository".into());
    }
    let mut builder = fs::DirBuilder::new();
    builder.recursive(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::DirBuilderExt;
        builder.mode(0o700);
    }
    builder
        .create(&resolved)
        .map_err(|_| "cannot create QA_EVIDENCE_DIR")?;
    let resolved = resolved
        .canonicalize()
        .map_err(|_| "cannot resolve QA_EVIDENCE_DIR")?;
    if resolved.starts_with(repository) || !resolved.is_dir() {
        return Err("QA_EVIDENCE_DIR is not an isolated directory".into());
    }
    let probe = resolved.join(format!(".write-probe-{}", Uuid::new_v4()));
    let mut options = fs::OpenOptions::new();
    options.write(true).create_new(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    let mut file = options
        .open(&probe)
        .map_err(|_| "QA_EVIDENCE_DIR is not writable")?;
    let writable = file.write_all(b"preflight").and_then(|()| file.sync_all());
    drop(file);
    let removed = fs::remove_file(probe);
    writable
        .and(removed)
        .map_err(|_| "QA_EVIDENCE_DIR write probe failed")?;
    Ok(resolved)
}

#[test]
fn evidence_preflight_rejects_output_inside_the_repository() {
    let repository = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .unwrap();
    assert!(
        evidence_directory(&repository.join("artifacts/private-evidence"), repository).is_err()
    );
}

// Unix opt-in regressions only: pgrep/ps/kill and local proxy fault injection
// have not been validated on Windows. No .env loading or endpoint defaults.
// Every setting is snapshotted before connecting, including output isolation.
// Required: QA_PRODUCT/URL/JAR/USER/PASSWORD/DATABASE/EVIDENCE_DIR; PG and
// Oracle also need QA_SCHEMA, Oracle QA_SERVICE. CSV/recovery require
// QA_ALLOW_WRITES=1 and QA_RUN_PREFIX; recovery needs QA_ALLOW_FAULT_INJECTION=1.
#[derive(Clone, Copy)]
pub(crate) enum LiveKind {
    MysqlContext,
    Csv,
    Recovery,
}

pub(crate) struct LiveSettings {
    pub(crate) product: String,
    url: String,
    jar: String,
    user: String,
    password: String,
    pub(crate) database: String,
    pub(crate) schema: String,
    service: Option<String>,
    prefix: Option<String>,
    pub(crate) evidence: std::path::PathBuf,
}

impl LiveSettings {
    pub(crate) fn load(kind: LiveKind) -> Self {
        let repository = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("..");
        Self::from_lookup(kind, |key| std::env::var(key).ok(), &repository, cfg!(unix))
            .unwrap_or_else(|error| panic!("live regression preflight refused: {error}"))
    }

    fn from_lookup(
        kind: LiveKind,
        mut lookup: impl FnMut(&str) -> Option<String>,
        repository: &std::path::Path,
        unix: bool,
    ) -> Result<Self, String> {
        if !unix {
            return Err(
                "these are Unix opt-in regressions; other platforms are unsupported".into(),
            );
        }
        let mut get = |key: &str| {
            lookup(key)
                .filter(|v| !v.trim().is_empty())
                .ok_or_else(|| format!("missing required test setting: {key}"))
        };
        let product = get("QA_PRODUCT")?;
        match (kind, product.as_str()) {
            (LiveKind::MysqlContext, "mysql")
            | (LiveKind::Csv, "mysql" | "postgres")
            | (LiveKind::Recovery, "mysql" | "postgres" | "oracle") => (),
            _ => return Err("unsupported product for this live regression".into()),
        }
        let url = get("QA_URL")?;
        let jar = get("QA_JAR")?;
        let user = get("QA_USER")?;
        let password = get("QA_PASSWORD")?;
        let database = get("QA_DATABASE")?;
        let schema = if product == "mysql" {
            database.clone()
        } else {
            get("QA_SCHEMA")?
        };
        let service = if product == "oracle" {
            Some(get("QA_SERVICE")?)
        } else {
            None
        };
        let directory = get("QA_EVIDENCE_DIR")?;
        let prefix = if matches!(kind, LiveKind::Csv | LiveKind::Recovery) {
            if get("QA_ALLOW_WRITES")? != "1" {
                return Err("QA_ALLOW_WRITES must explicitly equal 1".into());
            }
            Some(get("QA_RUN_PREFIX")?)
        } else {
            None
        };
        if matches!(kind, LiveKind::Recovery) && get("QA_ALLOW_FAULT_INJECTION")? != "1" {
            return Err("QA_ALLOW_FAULT_INJECTION must explicitly equal 1".into());
        }
        if !valid_identifier(&database) || !valid_identifier(&schema) {
            return Err("QA_DATABASE and QA_SCHEMA must be simple ASCII identifiers".into());
        }
        if prefix
            .as_ref()
            .is_some_and(|v| !valid_identifier(v) || v.len() > 10)
        {
            return Err("QA_RUN_PREFIX must be an ASCII identifier of at most 10 bytes".into());
        }
        let expected = match product.as_str() {
            "mysql" => "jdbc:mysql://",
            "postgres" => "jdbc:postgresql://",
            _ => "jdbc:oracle:thin:",
        };
        if !url.starts_with(expected) {
            return Err("QA_URL does not match QA_PRODUCT".into());
        }
        if product != "oracle"
            && !url::Url::parse(&url[5..]).is_ok_and(|url| url.host_str().is_some())
        {
            return Err("QA_URL is not a valid explicit endpoint".into());
        }
        if !std::path::Path::new(&jar).is_file() {
            return Err("QA_JAR must name an existing local file".into());
        }
        // All required settings/flags are validated before even creating the
        // output directory or its non-sensitive, immediately removed write probe.
        let evidence = evidence_directory(std::path::Path::new(&directory), repository)?;
        Ok(Self {
            product,
            url,
            jar,
            user,
            password,
            database,
            schema,
            service,
            prefix,
            evidence,
        })
    }

    pub(crate) fn config(
        &self,
        native: bool,
    ) -> (ConnectionConfig, Option<DriverDefinition>, String) {
        let id = match self.product.as_str() {
            "mysql" => "jdbc-mysql",
            "postgres" => "jdbc-postgresql",
            _ => "oracle",
        };
        let definition = crate::services::driver_catalog::driver_definitions()
            .into_iter()
            .find(|d| d.id == id)
            .unwrap();
        let config = serde_json::from_value(serde_json::json!({
            "id":Uuid::new_v4(), "name":"Explicit live regression endpoint", "driverType":if native { self.product.as_str() } else { "jdbc" },
            "productId":self.product, "driverClass":definition.jdbc_driver_class,
            "driverPaths":[self.jar], "connectionUrl":if native {&self.url[5..]} else {&self.url},
            "username":self.user, "createdAt":chrono::Utc::now(), "updatedAt":chrono::Utc::now()
        })).unwrap();
        (
            config,
            if native { None } else { Some(definition) },
            self.password.clone(),
        )
    }

    pub(crate) fn owned_table_name(&self, suffix: &str) -> String {
        let prefix = self
            .prefix
            .as_ref()
            .expect("preflight must authorize writes");
        checked_identifier(suffix);
        assert!(suffix.len() <= 8);
        format!(
            "{prefix}_{suffix}_{}",
            &Uuid::new_v4().simple().to_string()[..8]
        )
    }

    pub(crate) async fn verify_write_target(
        &self,
        driver: Arc<dyn crate::drivers::trait_def::DatabaseDriver>,
    ) {
        let product = self.product.as_str();
        let sql = match product {
            "mysql" => "SELECT DATABASE()",
            "postgres" => "SELECT current_database(), current_schema",
            "oracle" => "SELECT sys_context('USERENV','DB_NAME'),sys_context('USERENV','SERVICE_NAME'),sys_context('USERENV','SESSION_USER'),sys_context('USERENV','CURRENT_SCHEMA') FROM dual",
            _ => panic!("unsupported test product"),
        };
        let row = driver
            .execute_query(sql, None)
            .await
            .unwrap()
            .rows
            .remove(0);
        let same = |index: usize, expected: &str| {
            row[index].as_str().is_some_and(|actual| {
                if product == "oracle" {
                    actual.eq_ignore_ascii_case(expected)
                } else {
                    actual == expected
                }
            })
        };
        assert!(
            same(0, &self.database),
            "actual database does not match QA_DATABASE; refusing writes"
        );
        if product == "postgres" {
            assert!(
                same(1, &self.schema),
                "actual schema does not match QA_SCHEMA; refusing writes"
            );
        } else if product == "oracle" {
            assert!(
                same(1, self.service.as_deref().unwrap()),
                "actual service does not match QA_SERVICE; refusing writes"
            );
            assert!(
                same(2, &self.user),
                "actual login does not match QA_USER; refusing writes"
            );
            assert!(
                same(3, &self.schema),
                "actual schema does not match QA_SCHEMA; refusing writes"
            );
        }
    }
}

fn required_value(key: &str, value: Option<String>) -> String {
    value
        .filter(|v| !v.trim().is_empty())
        .unwrap_or_else(|| panic!("missing required test setting: {key}"))
}
fn valid_identifier(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 63
        && value.as_bytes()[0].is_ascii_alphabetic()
        && value
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'_')
}
fn checked_identifier(value: &str) -> &str {
    assert!(valid_identifier(value), "test identifiers must start with an ASCII letter and contain only letters, digits or underscores");
    value
}
pub(crate) fn unset_mysql_config(mut config: ConnectionConfig) -> ConnectionConfig {
    clear_mysql_connection_database(&mut config).unwrap();
    config
}

/// Uses the same real driver as the fixture creator, and verifies absence via
/// a successful catalog read, never by treating an arbitrary SELECT error as absence.
pub(crate) struct DriverTableActions {
    pub(crate) driver: Arc<dyn crate::drivers::trait_def::DatabaseDriver>,
    pub(crate) product: String,
    pub(crate) schema: String,
    pub(crate) name: String,
}
#[async_trait::async_trait]
impl OwnedTableActions for DriverTableActions {
    async fn create(&self, table: &str) -> Result<(), String> {
        self.driver
            .execute_query(
                &format!("CREATE TABLE {table} (id INTEGER PRIMARY KEY, note VARCHAR(100))"),
                None,
            )
            .await
            .map(|_| ())
            .map_err(|_| "CREATE failed; outcome must be independently checked".into())
    }
    async fn drop_owned(&self, table: &str) -> Result<(), String> {
        self.driver
            .execute_query(&format!("DROP TABLE {table}"), None)
            .await
            .map(|_| ())
            .map_err(|_| "DROP failed; cleanup unconfirmed".into())
    }
    async fn verify_absent(&self, _table: &str) -> Result<(), String> {
        let schema = checked_identifier(&self.schema);
        let name = checked_identifier(&self.name);
        let sql = if self.product == "oracle" {
            format!(
                "SELECT COUNT(*) FROM all_tables WHERE owner='{}' AND table_name='{}'",
                schema.to_ascii_uppercase(),
                name.to_ascii_uppercase()
            )
        } else {
            format!("SELECT COUNT(*) FROM information_schema.tables WHERE table_schema='{schema}' AND table_name='{name}'")
        };
        let result = self
            .driver
            .execute_query(&sql, None)
            .await
            .map_err(|_| "catalog absence check failed; cleanup unconfirmed")?;
        let count = result.rows.first().and_then(|r| r.first());
        if count.is_some_and(|v| v.as_i64() == Some(0) || v.as_str() == Some("0")) {
            Ok(())
        } else {
            Err("owned object still present or catalog result invalid; cleanup unconfirmed".into())
        }
    }
}

#[test]
fn missing_or_empty_environment_values_refuse_instead_of_using_defaults() {
    for value in [None, Some(String::new()), Some("   ".to_string())] {
        assert!(std::panic::catch_unwind(|| required_value("QA_URL", value)).is_err());
    }
    assert_eq!(
        required_value("QA_USER", Some("fixture_user".into())),
        "fixture_user"
    );
}

#[test]
fn test_target_identifiers_reject_sql_fragments_and_empty_values() {
    for invalid in ["", "qa;DROP TABLE x", "qa.schema", "qa'", "1qa", "qa space"] {
        assert!(std::panic::catch_unwind(|| checked_identifier(invalid)).is_err());
    }
    assert_eq!(checked_identifier("fixture_schema_1"), "fixture_schema_1");
}

#[test]
fn mysql_context_changes_must_use_the_tab_selector() {
    assert!(validate_execution_context_sql(
        DriverType::Mysql,
        "SELECT 1; /* explanation */ USE fixture_catalog; SELECT 2"
    )
    .is_err());
    assert!(validate_execution_context_sql(
        DriverType::Mysql,
        "SELECT 'USE fixture_catalog', 1 /* USE other */"
    )
    .is_ok());
}

#[tokio::test]
#[ignore = "Unix opt-in; explicit authorized MySQL endpoint; context/cancel/reconnect only, no table writes"]
async fn mysql_auto_unset_target_uses_a_distinct_physical_session() {
    let settings = LiveSettings::load(LiveKind::MysqlContext);
    assert_eq!(settings.product, "mysql");
    let selected_database = settings.database.clone();
    for native in [true, false] {
        let path = if native { "native" } else { "jdbc" };
        let (config, definition, password) = settings.config(native);
        let id = config.id;
        let mut manager = ConnectionManager::new();
        manager.begin_connect(id).unwrap();
        manager
            .finish_connect(
                id,
                Ok(
                    create_active_connection(&config, Some(&password), definition.as_ref())
                        .await
                        .unwrap(),
                ),
            )
            .unwrap();
        let generation = manager.connection_generation(id).unwrap();
        let mut empty_config = config.clone();
        clear_mysql_connection_database(&mut empty_config).unwrap();
        manager
            .install_mysql_empty_session(
                id,
                generation,
                create_active_connection(&empty_config, Some(&password), definition.as_ref())
                    .await
                    .unwrap(),
            )
            .unwrap();
        let mut empty_id = serde_json::Value::Null;
        for turn in 0..3 {
            let empty = manager
                .begin_context_query_operation(id, &format!("empty-{turn}"), true)
                .unwrap()
                .wait()
                .await
                .unwrap();
            let selected = manager
                .begin_query_operation(id, &format!("chosen-{turn}"))
                .unwrap()
                .wait()
                .await
                .unwrap();
            let (a, b) = tokio::join!(
                async {
                    apply_execution_context(empty.driver.clone(), DriverType::Mysql, None, None)
                        .await
                        .unwrap();
                    empty
                        .driver
                        .execute_query("SELECT DATABASE(), CONNECTION_ID(), 1", None)
                        .await
                        .unwrap()
                },
                async {
                    apply_execution_context(
                        selected.driver.clone(),
                        DriverType::Mysql,
                        Some(selected_database.as_str()),
                        None,
                    )
                    .await
                    .unwrap();
                    selected
                        .driver
                        .execute_query("SELECT DATABASE(), CONNECTION_ID(), 1", None)
                        .await
                        .unwrap()
                }
            );
            assert!(a.rows[0][0].is_null());
            assert_eq!(b.rows[0][0], serde_json::json!(selected_database));
            assert_ne!(a.rows[0][1], b.rows[0][1]);
            empty_id = a.rows[0][1].clone();
            println!(
                "QA_CONTEXT {path} turn={turn} empty={:?} chosen={:?}",
                a.rows, b.rows
            );
            assert!(empty
                .driver
                .execute_query("SELECT * FROM fixture_missing_default_probe", None)
                .await
                .unwrap_err()
                .safe_message()
                .contains("No database selected"));
            assert!(manager.disconnect(id).is_err());
        }
        let empty = manager
            .begin_context_query_operation(id, "cancel-empty", true)
            .unwrap()
            .wait()
            .await
            .unwrap();
        let (tx, mut rx) = tokio::sync::mpsc::channel(2);
        let cancel_driver = manager.query_driver(id, "cancel-empty").unwrap();
        let (result, cancel, ()) = tokio::join!(
            empty
                .driver
                .execute_query_stream("SELECT SLEEP(1)", "cancel-empty", 10, Some(1), tx),
            async {
                tokio::time::sleep(std::time::Duration::from_millis(100)).await;
                cancel_driver.cancel_query("cancel-empty").await
            },
            async { while rx.recv().await.is_some() {} }
        );
        assert_eq!(cancel.is_ok(), !native);
        assert_eq!(result.is_ok(), native);
        apply_execution_context(empty.driver.clone(), DriverType::Mysql, None, None)
            .await
            .unwrap();
        assert!(empty
            .driver
            .execute_query("SELECT DATABASE()", None)
            .await
            .unwrap()
            .rows[0][0]
            .is_null());
        drop(empty);
        // Manual is not reset or replaced when its unset target is unsafe.
        manager
            .install_console_session(
                id,
                "manual".into(),
                create_active_connection(&config, Some(&password), definition.as_ref())
                    .await
                    .unwrap(),
            )
            .unwrap();
        let manual = manager
            .begin_console_operation(id, "manual", Some("manual-proof"))
            .unwrap();
        manual.driver.begin_transaction().await.unwrap();
        manager.set_console_phase(id, "manual", ConsoleTransactionPhase::Active);
        assert!(
            apply_execution_context(manual.driver.clone(), DriverType::Mysql, None, None)
                .await
                .is_err()
        );
        assert!(manager.disconnect(id).is_err());
        manual.driver.rollback_transaction().await.unwrap();
        manager.set_console_phase(id, "manual", ConsoleTransactionPhase::Idle);
        drop(manual);
        manager.disconnect(id).unwrap();
        manager.begin_connect(id).unwrap();
        manager
            .finish_connect(
                id,
                Ok(
                    create_active_connection(&empty_config, Some(&password), definition.as_ref())
                        .await
                        .unwrap(),
                ),
            )
            .unwrap();
        let reconnected = manager
            .begin_query_operation(id, "reconnected")
            .unwrap()
            .wait()
            .await
            .unwrap();
        let fresh = reconnected
            .driver
            .execute_query("SELECT DATABASE(), CONNECTION_ID()", None)
            .await
            .unwrap();
        assert!(fresh.rows[0][0].is_null());
        assert_ne!(fresh.rows[0][1], empty_id);
        assert_ne!(reconnected.generation, generation);
        drop(reconnected);
        manager.disconnect(id).unwrap();
        println!("QA_CONTEXT_CANCEL_RECONNECT_MANUAL_GUARD_PASSED {path}");
    }
}

#[tokio::test]
#[ignore = "Unix opt-in; authorized exact targets, own tables and own local proxy/bridge only"]
async fn lost_manual_console_explicit_recovery_and_observer() {
    use crate::drivers::trait_def::DatabaseDriver;
    use std::{collections::BTreeSet, sync::Arc};
    fn children() -> BTreeSet<u32> {
        let out = std::process::Command::new("pgrep")
            .args(["-P", &std::process::id().to_string()])
            .output()
            .unwrap();
        String::from_utf8(out.stdout)
            .unwrap()
            .lines()
            .filter_map(|x| x.parse().ok())
            .collect()
    }
    async fn count(observer: &Arc<dyn DatabaseDriver>, table: &str, id: i32) -> i64 {
        let value = observer
            .execute_query(&format!("SELECT COUNT(*) FROM {table} WHERE id={id}"), None)
            .await
            .unwrap()
            .rows[0][0]
            .clone();
        value
            .as_i64()
            .unwrap_or_else(|| value.as_str().unwrap().parse().unwrap())
    }
    let settings = LiveSettings::load(LiveKind::Recovery);
    let product = settings.product.clone();
    let selected_database = settings.database.clone();
    let selected_schema = settings.schema.clone();
    let table_name = settings.owned_table_name("recover");
    let table = format!("{selected_schema}.{table_name}");
    let table = table.as_str();
    let mut ledger = ObjectLedger::open(&settings.evidence, &product, &settings.database, table)
        .expect("prepare ownership ledger before connecting");
    let (cfg, def, password) = settings.config(false);
    let observer = create_active_connection(&cfg, Some(&password), def.as_ref())
        .await
        .unwrap()
        .driver();
    settings.verify_write_target(observer.clone()).await;
    let actions = DriverTableActions {
        driver: observer.clone(),
        product: product.clone(),
        schema: selected_schema.clone(),
        name: table_name.clone(),
    };
    let run = run_owned_table(&actions, &mut ledger, || async {
        for native in if product=="oracle" {vec![false]} else {vec![true,false]} {
            let (cfg,def,password) = settings.config(native);
            let id=cfg.id;
            let mut manager=ConnectionManager::new();
            manager.begin_connect(id).unwrap();
            manager.finish_connect(id,Ok(create_active_connection(&cfg,Some(&password),def.as_ref()).await.unwrap())).unwrap();
            manager.install_console_session(id,"other".into(),create_active_connection(&cfg,Some(&password),def.as_ref()).await.unwrap()).unwrap();
            let other = manager.begin_console_operation(id,"other",None).unwrap();
            other.driver.begin_transaction().await.unwrap();
            other.driver.execute_query(&format!("INSERT INTO {table} (id,note) VALUES (2,'other pending')"),None).await.unwrap();
            manager.set_console_phase(id,"other",ConsoleTransactionPhase::Active);
            drop(other);
            let before=children();
            let mut victim_cfg=cfg.clone();
            let mut proxy=None;
            if native {
                let url=url::Url::parse(cfg.connection_url.as_deref().unwrap()).unwrap();
                let remote=(url.host_str().unwrap().to_string(), url.port().unwrap());
                let listener=tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
                let port=listener.local_addr().unwrap().port();
                let mut local=url.clone();local.set_host(Some("127.0.0.1")).unwrap();local.set_port(Some(port)).unwrap();
                victim_cfg.connection_url=Some(local.to_string());
                proxy=Some(tokio::spawn(async move {
                    let (mut inbound,_)=listener.accept().await.unwrap();
                    let mut outbound=tokio::net::TcpStream::connect(remote).await.unwrap();
                    let _=tokio::io::copy_bidirectional(&mut inbound,&mut outbound).await;
                }));
            }
            manager.install_console_session(id,"lost".into(),create_active_connection(&victim_cfg,Some(&password),def.as_ref()).await.unwrap()).unwrap();
            let victim=manager.begin_console_operation(id,"lost",None).unwrap();
            victim.driver.begin_transaction().await.unwrap();
            victim.driver.execute_query(&format!("INSERT INTO {table} (id,note) VALUES (1,'never replay')"),None).await.unwrap();
            manager.set_console_phase(id,"lost",ConsoleTransactionPhase::Active);
            assert_eq!(count(&observer,table,1).await,0);assert_eq!(count(&observer,table,2).await,0);
            assert!(manager.begin_console_operation(id,"lost",None).is_err());
            if let Some(proxy)=proxy { proxy.abort(); let _=proxy.await; println!("QA_FAULT native={native} own_proxy_closed"); }
            else {
                let after=children();let owned:Vec<_>=after.difference(&before).copied().collect();assert_eq!(owned.len(),1);
                let pid=owned[0];let out=std::process::Command::new("ps").args(["-p",&pid.to_string(),"-o","pid=,ppid=,command="]).output().unwrap();
                let identity=String::from_utf8(out.stdout).unwrap();assert!(identity.contains("com.vaporlensdb.jdbcbridge.JdbcBridge server"));println!("QA_OWNED_BRIDGE pid={pid} verified_child=true");
                assert!(std::process::Command::new("kill").args(["-TERM",&pid.to_string()]).status().unwrap().success());
            }
            let failure=tokio::time::timeout(std::time::Duration::from_secs(8),victim.driver.execute_query("SELECT 1",None)).await.unwrap();
            assert!(failure.is_err());
            assert_eq!(manager.console_transaction_state(id,"lost").phase,ConsoleTransactionPhase::Lost);
            assert!(ensure_query_transaction_usable(ConsoleTransactionPhase::Lost).is_err());
            assert!(victim.driver.rollback_transaction().await.is_err(),"never report old rollback on a new connection");
            assert_eq!(count(&observer,table,1).await,0);
            drop(victim);
            let lease=manager.begin_console_operation(id,"lost",None).unwrap();
            let replacement=create_active_connection(&cfg,Some(&password),def.as_ref()).await.unwrap();
            let dialect=match product.as_str(){"mysql"=>DriverType::Mysql,"postgres"=>DriverType::Postgres,_=>DriverType::Jdbc};
            if product!="oracle" { apply_execution_context(replacement.driver(),dialect,Some(selected_database.as_str()),if product=="postgres" {Some(selected_schema.as_str())} else {None}).await.unwrap(); }
            manager.replace_lost_console_session(id,"lost","fresh".into(),&lease,replacement).unwrap();
            assert_eq!(manager.console_transaction_state(id,"fresh").phase,ConsoleTransactionPhase::Idle);
            assert!(manager.console_driver(id,"lost").is_err(),"historical source cannot attach to new physical console");
            assert_eq!(manager.console_transaction_state(id,"other").phase,ConsoleTransactionPhase::Active);
            let fresh=manager.console_driver(id,"fresh").unwrap();assert_eq!(count(&fresh,table,1).await,0);assert_eq!(count(&fresh,table,2).await,0);
            let other=manager.begin_console_operation(id,"other",None).unwrap();assert_eq!(count(&other.driver,table,2).await,1);
            other.driver.commit_transaction().await.unwrap();manager.set_console_phase(id,"other",ConsoleTransactionPhase::Idle);drop(other);
            assert_eq!(count(&observer,table,2).await,1);
            fresh.begin_transaction().await.unwrap();fresh.execute_query(&format!("INSERT INTO {table} (id,note) VALUES (3,'fresh only')"),None).await.unwrap();assert_eq!(count(&observer,table,3).await,0);fresh.rollback_transaction().await.unwrap();assert_eq!(count(&observer,table,3).await,0);
            observer.execute_query(&format!("DELETE FROM {table} WHERE id=2"),None).await.unwrap();
            println!("QA_RECOVERY native={native} old_rollback_independently_observed=0 ui_outcome_remains_unknown other_pending_preserved=1 other_commit_observed=1 fresh_rollback_observed=0 no_replay");
            drop(lease);manager.remove_console_session(id,"fresh").unwrap();manager.remove_console_session(id,"other").unwrap();manager.disconnect(id).unwrap();
        }
    }).await;
    assert!(run.is_ok(), "recovery fixture failed: {run:?}");
    assert!(observer
        .execute_query(&format!("SELECT * FROM {table}"), None)
        .await
        .is_err());
}

/// A durable, unique plan is written before CREATE. Never remove this ledger,
/// including when later journal writes or database cleanup fail.
pub(crate) struct ObjectLedger {
    path: std::path::PathBuf,
    file: std::fs::File,
    product: String,
    database: String,
    table: String,
    owned: bool,
    fail_states: std::collections::BTreeSet<&'static str>,
}

impl ObjectLedger {
    pub(crate) fn open(
        directory: &std::path::Path,
        product: &str,
        database: &str,
        table: &str,
    ) -> Result<Self, String> {
        let path = directory.join(format!("objects-{}.jsonl", Uuid::new_v4()));
        let mut options = std::fs::OpenOptions::new();
        options.create_new(true).write(true);
        #[cfg(unix)]
        {
            use std::os::unix::fs::OpenOptionsExt;
            options.mode(0o600);
        }
        let file = options
            .open(&path)
            .map_err(|_| "cannot open object ledger before CREATE")?;
        let mut ledger = Self {
            path,
            file,
            product: product.into(),
            database: database.into(),
            table: table.into(),
            owned: false,
            fail_states: Default::default(),
        };
        ledger.record("planned").map_err(|error| {
            format!(
                "{error}; no CREATE attempted; retained ledger={}",
                ledger.path.display()
            )
        })?;
        Ok(ledger)
    }

    fn record(&mut self, state: &'static str) -> Result<(), String> {
        use std::io::Write;
        if self.fail_states.contains(state) {
            return Err(format!("injected ledger write failure at {state}"));
        }
        let line = serde_json::json!({"product":self.product,"database":self.database,"table":self.table,"state":state,"owned":self.owned,"at":chrono::Utc::now()}).to_string() + "\n";
        self.file
            .write_all(line.as_bytes())
            .and_then(|()| self.file.sync_all())
            .map_err(|_| format!("object ledger write failed at {state}"))
    }
}

#[async_trait::async_trait]
pub(crate) trait OwnedTableActions {
    async fn create(&self, exact_table: &str) -> Result<(), String>;
    async fn drop_owned(&self, exact_table: &str) -> Result<(), String>;
    async fn verify_absent(&self, exact_table: &str) -> Result<(), String>;
}

async fn guarded<F, T>(phase: &str, seconds: u64, future: F) -> Result<T, String>
where
    F: std::future::Future<Output = Result<T, String>>,
{
    use futures_util::FutureExt;
    match tokio::time::timeout(
        std::time::Duration::from_secs(seconds),
        std::panic::AssertUnwindSafe(future).catch_unwind(),
    )
    .await
    {
        Ok(Ok(result)) => result,
        Ok(Err(_)) => Err(format!("{phase} panicked")),
        Err(_) => Err(format!("{phase} timed out; outcome unknown")),
    }
}

pub(crate) async fn run_owned_table<F, Fut>(
    actions: &impl OwnedTableActions,
    ledger: &mut ObjectLedger,
    body: F,
) -> Result<(), String>
where
    F: FnOnce() -> Fut,
    Fut: std::future::Future<Output = ()>,
{
    let mut failures = Vec::new();
    // A CREATE failure/timeout never grants ownership, even for a matching prefix.
    // The pre-written plan remains available for independent investigation.
    if let Err(error) = guarded("CREATE", 20, actions.create(&ledger.table)).await {
        let journal_error = ledger.record("create-failed-or-unknown").err();
        return Err(format!(
            "{error}; no ownership acquired, no DROP attempted; journal error={journal_error:?}; ledger={}",
            ledger.path.display()
        ));
    }
    ledger.owned = true; // Record exact in-memory ownership before fallible journal/body work.
    let work = guarded("fixture body", 120, async {
        ledger.record("created")?;
        body().await;
        Ok(())
    })
    .await;
    if let Err(error) = work {
        failures.push(error);
        if let Err(error) = ledger.record("body-failed") {
            failures.push(error);
        }
    }
    // Journal failure must not skip DROP or the independent absence check.
    if let Err(error) = ledger.record("drop-attempted") {
        failures.push(error);
    }
    let dropped = guarded("DROP", 20, actions.drop_owned(&ledger.table)).await;
    let drop_ok = dropped.is_ok();
    if let Err(error) = dropped {
        failures.push(error);
    }
    if let Err(error) = ledger.record(if drop_ok {
        "dropped"
    } else {
        "drop-failed-or-unknown"
    }) {
        failures.push(error);
    }
    let absent = guarded(
        "absence verification",
        20,
        actions.verify_absent(&ledger.table),
    )
    .await;
    let absent_ok = absent.is_ok();
    if let Err(error) = absent {
        failures.push(error);
    }
    let state = if drop_ok && absent_ok {
        "absence-verified"
    } else {
        "cleanup-unconfirmed"
    };
    if let Err(error) = ledger.record(state) {
        failures.push(error);
    }
    if failures.is_empty() {
        return Ok(());
    }
    // Keep the plan, all successful events and exact identity even if the disk
    // cannot record further events. Do not describe uncertain cleanup as success.
    Err(format!("{}; DROP confirmed={drop_ok}, absence confirmed={absent_ok}; retained ledger={}; exact owned object={}", failures.join("; "), ledger.path.display(), ledger.table))
}

struct OfflineArea(std::path::PathBuf);
impl OfflineArea {
    fn new() -> Self {
        let path =
            std::env::temp_dir().join(format!("vapor-fixture-regression-{}", Uuid::new_v4()));
        std::fs::create_dir(&path).unwrap();
        Self(path)
    }
}
impl Drop for OfflineArea {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.0);
    }
}

#[derive(Default)]
struct InjectedTableActions {
    calls: std::sync::Mutex<Vec<String>>,
    fail: Option<&'static str>,
    panic_at: Option<&'static str>,
}
impl InjectedTableActions {
    fn action(&self, stage: &'static str, exact_table: &str) -> Result<(), String> {
        self.calls
            .lock()
            .unwrap()
            .push(format!("{stage}:{exact_table}"));
        assert_ne!(self.panic_at, Some(stage), "injected {stage} panic");
        if self.fail == Some(stage) {
            return Err(format!("injected {stage} error"));
        }
        Ok(())
    }
}
#[async_trait::async_trait]
impl OwnedTableActions for InjectedTableActions {
    async fn create(&self, table: &str) -> Result<(), String> {
        self.action("create", table)
    }
    async fn drop_owned(&self, table: &str) -> Result<(), String> {
        self.action("drop", table)
    }
    async fn verify_absent(&self, table: &str) -> Result<(), String> {
        self.action("verify", table)
    }
}

#[tokio::test]
async fn observer_failure_after_create_still_attempts_exact_owned_cleanup() {
    use futures_util::FutureExt;
    let area = OfflineArea::new();
    let mut ledger = ObjectLedger::open(
        &area.0,
        "fixture",
        "fixture_database",
        "fixture_schema.owned_unique",
    )
    .unwrap();
    let actions = InjectedTableActions::default();
    let result = std::panic::AssertUnwindSafe(run_owned_table(&actions, &mut ledger, || async {
        panic!("injected observation connection initialization failure");
    }))
    .catch_unwind()
    .await;
    assert!(result.is_err() || result.unwrap().is_err());
    assert_eq!(
        *actions.calls.lock().unwrap(),
        [
            "create:fixture_schema.owned_unique",
            "drop:fixture_schema.owned_unique",
            "verify:fixture_schema.owned_unique"
        ]
    );
    assert!(ledger.path.exists(), "never discard the ownership trail");
}

#[tokio::test]
async fn journal_write_failures_never_skip_drop_or_absence_check() {
    for state in [
        "created",
        "body-failed",
        "drop-attempted",
        "dropped",
        "absence-verified",
    ] {
        let area = OfflineArea::new();
        let mut ledger = ObjectLedger::open(
            &area.0,
            "fixture",
            "fixture_database",
            "fixture_schema.owned_unique",
        )
        .unwrap();
        ledger.fail_states.insert(state);
        let actions = InjectedTableActions::default();
        let result = run_owned_table(&actions, &mut ledger, || async {
            assert_ne!(state, "body-failed", "injected assertion failure");
        })
        .await;
        assert!(
            result.is_err(),
            "journal failure must fail the test, even if DROP succeeds"
        );
        assert_eq!(
            *actions.calls.lock().unwrap(),
            [
                "create:fixture_schema.owned_unique",
                "drop:fixture_schema.owned_unique",
                "verify:fixture_schema.owned_unique"
            ]
        );
        let retained = std::fs::read_to_string(&ledger.path).unwrap();
        assert!(retained.contains("planned") && retained.contains("fixture_schema.owned_unique"));
        assert!(!retained.contains(&format!("\"state\":\"{state}\"")));
    }
}

#[tokio::test]
async fn real_journal_io_error_retains_plan_and_still_attempts_cleanup() {
    let area = OfflineArea::new();
    let mut ledger = ObjectLedger::open(
        &area.0,
        "fixture",
        "fixture_database",
        "fixture_schema.owned_unique",
    )
    .unwrap();
    ledger.file = std::fs::File::open(&ledger.path).unwrap(); // Actual read-only descriptor: writes fail on any uid.
    let actions = InjectedTableActions::default();
    let result = run_owned_table(&actions, &mut ledger, || async {
        panic!("body must not run without created journal");
    })
    .await;
    let error = result.unwrap_err();
    assert!(error.contains("ledger write failed") && error.contains("retained ledger="));
    assert_eq!(
        *actions.calls.lock().unwrap(),
        [
            "create:fixture_schema.owned_unique",
            "drop:fixture_schema.owned_unique",
            "verify:fixture_schema.owned_unique"
        ]
    );
    let retained = std::fs::read_to_string(&ledger.path).unwrap();
    assert!(retained.contains("planned"));
    assert!(!retained.contains("dropped") && !retained.contains("absence-verified"));
}

#[tokio::test]
async fn cleanup_errors_and_panics_are_reported_without_false_absence() {
    for stage in ["drop", "verify"] {
        for panic in [false, true] {
            let area = OfflineArea::new();
            let mut ledger = ObjectLedger::open(
                &area.0,
                "fixture",
                "fixture_database",
                "fixture_schema.owned_unique",
            )
            .unwrap();
            let actions = InjectedTableActions {
                fail: if panic { None } else { Some(stage) },
                panic_at: if panic { Some(stage) } else { None },
                ..Default::default()
            };
            let error = run_owned_table(&actions, &mut ledger, || async {})
                .await
                .unwrap_err();
            assert!(error.contains(if stage == "drop" {
                "DROP confirmed=false"
            } else {
                "absence confirmed=false"
            }));
            assert_eq!(
                *actions.calls.lock().unwrap(),
                [
                    "create:fixture_schema.owned_unique",
                    "drop:fixture_schema.owned_unique",
                    "verify:fixture_schema.owned_unique"
                ]
            );
            let retained = std::fs::read_to_string(&ledger.path).unwrap();
            assert!(retained.contains("cleanup-unconfirmed"));
            assert!(!retained.contains("absence-verified"));
        }
    }
}

#[tokio::test]
async fn failed_create_never_grants_ownership_or_drops_a_preexisting_object() {
    let area = OfflineArea::new();
    let mut ledger = ObjectLedger::open(
        &area.0,
        "fixture",
        "fixture_database",
        "fixture_schema.owned_unique",
    )
    .unwrap();
    let actions = InjectedTableActions {
        fail: Some("create"),
        ..Default::default()
    };
    let error = run_owned_table(&actions, &mut ledger, || async {
        panic!("CREATE did not succeed");
    })
    .await
    .unwrap_err();
    assert!(error.contains("no ownership acquired, no DROP attempted"));
    assert!(!ledger.owned);
    assert_eq!(
        *actions.calls.lock().unwrap(),
        ["create:fixture_schema.owned_unique"]
    );
    assert!(std::fs::read_to_string(&ledger.path)
        .unwrap()
        .contains("create-failed-or-unknown"));
}

#[test]
fn journal_open_failure_cannot_start_a_fixture() {
    let area = OfflineArea::new();
    let blocked = area.0.join("not-a-directory");
    std::fs::write(&blocked, b"fixture").unwrap();
    assert!(ObjectLedger::open(
        &blocked,
        "fixture",
        "fixture_database",
        "fixture_schema.owned_unique"
    )
    .is_err());
    assert_eq!(std::fs::read(&blocked).unwrap(), b"fixture");
}

fn offline_settings(
    area: &OfflineArea,
    kind: LiveKind,
    product: &str,
) -> std::collections::BTreeMap<String, String> {
    std::fs::create_dir_all(area.0.join("repository")).unwrap();
    let jar = area.0.join("fixture.jar");
    std::fs::write(&jar, b"not loaded by offline preflight").unwrap();
    let url = match product {
        "mysql" => "jdbc:mysql://db.invalid/fixture_database",
        "postgres" => "jdbc:postgresql://db.invalid/fixture_database",
        _ => "jdbc:oracle:thin:@//db.invalid:1521/fixture_service",
    };
    let mut values: std::collections::BTreeMap<_, _> = [
        ("QA_PRODUCT", product.to_string()),
        ("QA_URL", url.to_string()),
        ("QA_JAR", jar.to_string_lossy().into_owned()),
        ("QA_USER", "fixture_user".into()),
        ("QA_PASSWORD", "fixture_password".into()),
        ("QA_DATABASE", "fixture_database".into()),
        (
            "QA_EVIDENCE_DIR",
            area.0.join("private-output").to_string_lossy().into_owned(),
        ),
    ]
    .into_iter()
    .map(|(k, v)| (k.into(), v))
    .collect();
    if product != "mysql" {
        values.insert("QA_SCHEMA".into(), "fixture_schema".into());
    }
    if product == "oracle" {
        values.insert("QA_SERVICE".into(), "fixture_service".into());
    }
    if matches!(kind, LiveKind::Csv | LiveKind::Recovery) {
        values.insert("QA_ALLOW_WRITES".into(), "1".into());
        values.insert("QA_RUN_PREFIX".into(), "fixture".into());
    }
    if matches!(kind, LiveKind::Recovery) {
        values.insert("QA_ALLOW_FAULT_INJECTION".into(), "1".into());
    }
    values
}

#[test]
fn every_missing_or_empty_live_setting_refuses_before_connection_or_private_output() {
    for (kind, product) in [
        (LiveKind::MysqlContext, "mysql"),
        (LiveKind::Csv, "mysql"),
        (LiveKind::Csv, "postgres"),
        (LiveKind::Recovery, "mysql"),
        (LiveKind::Recovery, "postgres"),
        (LiveKind::Recovery, "oracle"),
    ] {
        let area = OfflineArea::new();
        let values = offline_settings(&area, kind, product);
        for key in values.keys() {
            for empty in [false, true] {
                let mut incomplete = values.clone();
                if empty {
                    incomplete.insert(key.clone(), "   ".into());
                } else {
                    incomplete.remove(key);
                }
                let attempts = std::cell::Cell::new(0);
                let result = LiveSettings::from_lookup(
                    kind,
                    |k| incomplete.get(k).cloned(),
                    &area.0.join("repository"),
                    true,
                )
                .map(|_| attempts.set(attempts.get() + 1));
                assert!(result.is_err(), "must reject missing/empty {key}");
                assert_eq!(
                    attempts.get(),
                    0,
                    "validated settings are required before connection construction"
                );
                assert!(!area.0.join("private-output").exists());
            }
        }
    }
}

#[test]
fn preflight_creates_isolated_writable_output_only_after_all_settings_pass() {
    let area = OfflineArea::new();
    let values = offline_settings(&area, LiveKind::Recovery, "oracle");
    let settings = LiveSettings::from_lookup(
        LiveKind::Recovery,
        |k| values.get(k).cloned(),
        &area.0.join("repository"),
        true,
    )
    .unwrap();
    assert!(settings.evidence.is_dir());
    assert!(!settings.evidence.starts_with(area.0.join("repository")));
    assert_eq!(
        std::fs::read_dir(&settings.evidence).unwrap().count(),
        0,
        "write probe must be removed"
    );
    assert_eq!(settings.product, "oracle");
    assert!(settings
        .config(false)
        .0
        .connection_url
        .unwrap()
        .contains("db.invalid"));
}

#[test]
fn preflight_rejects_non_unix_invalid_flags_and_missing_jar_without_output() {
    let area = OfflineArea::new();
    let values = offline_settings(&area, LiveKind::Recovery, "postgres");
    assert!(LiveSettings::from_lookup(
        LiveKind::Recovery,
        |k| values.get(k).cloned(),
        &area.0.join("repository"),
        false
    )
    .is_err());
    for key in [
        "QA_ALLOW_WRITES",
        "QA_ALLOW_FAULT_INJECTION",
        "QA_RUN_PREFIX",
        "QA_URL",
        "QA_JAR",
    ] {
        let mut invalid = values.clone();
        invalid.insert(
            key.into(),
            if key == "QA_RUN_PREFIX" {
                "invalid;name"
            } else {
                "invalid"
            }
            .into(),
        );
        assert!(LiveSettings::from_lookup(
            LiveKind::Recovery,
            |k| invalid.get(k).cloned(),
            &area.0.join("repository"),
            true
        )
        .is_err());
        assert!(!area.0.join("private-output").exists());
    }
}

#[test]
fn evidence_directory_creation_failure_and_relative_path_are_safe_errors() {
    let area = OfflineArea::new();
    let repository = area.0.join("repository");
    std::fs::create_dir(&repository).unwrap();
    let file = area.0.join("blocked");
    std::fs::write(&file, b"fixture").unwrap();
    assert!(evidence_directory(&file.join("child"), &repository).is_err());
    assert!(evidence_directory(std::path::Path::new("relative-evidence"), &repository).is_err());
    assert!(!file.join("child").exists());
}

#[cfg(unix)]
#[test]
fn evidence_preflight_rejects_symlink_back_into_repository_before_mkdir() {
    let area = OfflineArea::new();
    let repository = area.0.join("repository");
    std::fs::create_dir(&repository).unwrap();
    let link = area.0.join("looks-external");
    std::os::unix::fs::symlink(&repository, &link).unwrap();
    assert!(evidence_directory(&link.join("private-output"), &repository).is_err());
    assert!(!repository.join("private-output").exists());
}

pub(crate) async fn assert_setup_failure_cleans_exact_owned_table(phase: &str) {
    let area = OfflineArea::new();
    let mut ledger = ObjectLedger::open(
        &area.0,
        "fixture",
        "fixture_database",
        "fixture_schema.csv_unique",
    )
    .unwrap();
    let actions = InjectedTableActions::default();
    let error = run_owned_table(&actions, &mut ledger, || async {
        panic!("injected {phase} failure");
    })
    .await
    .unwrap_err();
    assert!(error.contains("fixture body panicked"));
    assert_eq!(
        *actions.calls.lock().unwrap(),
        [
            "create:fixture_schema.csv_unique",
            "drop:fixture_schema.csv_unique",
            "verify:fixture_schema.csv_unique"
        ]
    );
    let retained = std::fs::read_to_string(&ledger.path).unwrap();
    assert!(
        retained.contains("created")
            && retained.contains("body-failed")
            && retained.contains("absence-verified")
    );
}
