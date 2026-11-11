//! Contract regression: both MySQL implementations permit server-level sessions.
fn assert_server_level(id: &str) {
    let definition = vapor_lens_db_lib::services::driver_catalog::driver_definitions()
        .into_iter()
        .find(|d| d.id == id)
        .unwrap();
    let host = definition
        .connection_variants
        .iter()
        .find(|v| v.id == "hostPort")
        .unwrap();
    assert!(
        !host.required_fields.iter().any(|field| field == "database"),
        "{id}: MySQL must allow choosing the database after connecting"
    );
}
#[test]
fn native_mysql_host_port_allows_server_level_connections() {
    assert_server_level("mysql");
}
#[test]
fn jdbc_mysql_host_port_allows_server_level_connections() {
    assert_server_level("jdbc-mysql");
}

#[test]
fn postgres_keeps_required_database_and_url_requirements() {
    for id in ["postgres", "jdbc-postgresql"] {
        let definition = vapor_lens_db_lib::services::driver_catalog::driver_definitions()
            .into_iter()
            .find(|d| d.id == id)
            .unwrap();
        let host = definition
            .connection_variants
            .iter()
            .find(|v| v.id == "hostPort")
            .unwrap();
        assert!(host.required_fields.iter().any(|f| f == "database"));
        let url = definition
            .connection_variants
            .iter()
            .find(|v| v.id == "urlOnly")
            .unwrap();
        assert_eq!(url.required_fields, ["connectionUrl"]);
    }
}
