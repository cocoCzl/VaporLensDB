use crate::models::{
    connection::DriverType,
    driver_catalog::{DriverBackend, DriverDefinition, DriverDefinitionCapabilities, DriverStatus},
};

pub fn driver_definitions() -> Vec<DriverDefinition> {
    vec![
        DriverDefinition {
            id: DriverType::Postgres,
            name: "PostgreSQL".to_string(),
            backend: DriverBackend::NativeRust,
            status: DriverStatus::Ready,
            default_port: Some(5432),
            default_username: Some("postgres".to_string()),
            default_database: Some("postgres".to_string()),
            jdbc_driver_class: None,
            url_template: None,
            driver_artifact: None,
            user_driver_required: false,
            built_in: true,
            notes: Some("内置 tokio-postgres，支持真实取消和流式结果。".to_string()),
            capabilities: ready_capabilities(true),
        },
        DriverDefinition {
            id: DriverType::Mysql,
            name: "MySQL / MariaDB".to_string(),
            backend: DriverBackend::NativeRust,
            status: DriverStatus::Ready,
            default_port: Some(3306),
            default_username: Some("root".to_string()),
            default_database: None,
            jdbc_driver_class: None,
            url_template: None,
            driver_artifact: None,
            user_driver_required: false,
            built_in: true,
            notes: Some("内置 mysql_async，支持查询、流式结果和基础元数据。".to_string()),
            capabilities: DriverDefinitionCapabilities {
                can_connect: true,
                can_query: true,
                can_stream: true,
                can_read_metadata: true,
                can_cancel: false,
                can_generate_ddl: true,
            },
        },
        DriverDefinition {
            id: DriverType::Oracle,
            name: "Oracle".to_string(),
            backend: DriverBackend::Jdbc,
            status: DriverStatus::Configurable,
            default_port: Some(1521),
            default_username: Some("system".to_string()),
            default_database: Some("ORCLPDB1".to_string()),
            jdbc_driver_class: Some("oracle.jdbc.OracleDriver".to_string()),
            url_template: Some("jdbc:oracle:thin:@//{host}:{port}/{database}".to_string()),
            driver_artifact: Some("ojdbc11.jar".to_string()),
            user_driver_required: true,
            built_in: true,
            notes: Some("预置 Oracle 模板；因授权原因不内置 ojdbc，用户需导入 jar。".to_string()),
            capabilities: jdbc_basic_capabilities(),
        },
        DriverDefinition {
            id: DriverType::Jdbc,
            name: "自定义 JDBC".to_string(),
            backend: DriverBackend::Jdbc,
            status: DriverStatus::Configurable,
            default_port: None,
            default_username: None,
            default_database: None,
            jdbc_driver_class: None,
            url_template: Some("jdbc:vendor://{host}:{port}/{database}".to_string()),
            driver_artifact: Some("*.jar".to_string()),
            user_driver_required: true,
            built_in: false,
            notes: Some("用于用户自行导入厂商 JDBC 驱动，JDBC bridge 接入后执行。".to_string()),
            capabilities: jdbc_basic_capabilities(),
        },
        DriverDefinition {
            id: DriverType::Odbc,
            name: "自定义 ODBC".to_string(),
            backend: DriverBackend::Odbc,
            status: DriverStatus::Configurable,
            default_port: None,
            default_username: None,
            default_database: None,
            jdbc_driver_class: None,
            url_template: Some(
                "Driver={name};Server={host};Port={port};Database={database};".to_string(),
            ),
            driver_artifact: Some("系统 ODBC 驱动".to_string()),
            user_driver_required: true,
            built_in: false,
            notes: Some("用于系统已安装 ODBC 驱动的数据库，ODBC bridge 接入后执行。".to_string()),
            capabilities: external_pending_capabilities(),
        },
        planned_definition(
            DriverType::Sqlite,
            "SQLite",
            Some("本地文件数据库，后续用 rusqlite 接入。"),
        ),
        planned_definition(
            DriverType::Mssql,
            "SQL Server",
            Some("后续用 tiberius 原生驱动接入。"),
        ),
        planned_definition(
            DriverType::Mongo,
            "MongoDB",
            Some("后续用官方 mongodb Rust driver 接入。"),
        ),
        planned_definition(DriverType::Redis, "Redis", Some("后续用 redis-rs 接入。")),
    ]
}

fn ready_capabilities(can_cancel: bool) -> DriverDefinitionCapabilities {
    DriverDefinitionCapabilities {
        can_connect: true,
        can_query: true,
        can_stream: true,
        can_read_metadata: true,
        can_cancel,
        can_generate_ddl: true,
    }
}

fn external_pending_capabilities() -> DriverDefinitionCapabilities {
    DriverDefinitionCapabilities {
        can_connect: false,
        can_query: false,
        can_stream: false,
        can_read_metadata: false,
        can_cancel: false,
        can_generate_ddl: false,
    }
}

fn jdbc_basic_capabilities() -> DriverDefinitionCapabilities {
    DriverDefinitionCapabilities {
        can_connect: true,
        can_query: true,
        can_stream: false,
        can_read_metadata: false,
        can_cancel: false,
        can_generate_ddl: false,
    }
}

fn planned_definition(id: DriverType, name: &str, notes: Option<&str>) -> DriverDefinition {
    DriverDefinition {
        id,
        name: name.to_string(),
        backend: DriverBackend::Planned,
        status: DriverStatus::Planned,
        default_port: None,
        default_username: None,
        default_database: None,
        jdbc_driver_class: None,
        url_template: None,
        driver_artifact: None,
        user_driver_required: false,
        built_in: true,
        notes: notes.map(str::to_string),
        capabilities: DriverDefinitionCapabilities {
            can_connect: false,
            can_query: false,
            can_stream: false,
            can_read_metadata: false,
            can_cancel: false,
            can_generate_ddl: false,
        },
    }
}
