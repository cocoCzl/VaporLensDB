#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
COMPOSE=(docker compose --project-name vaporlensdb-qa --file "$ROOT_DIR/docker-compose.qa.yml")

usage() {
  cat <<'EOF'
Usage: ./scripts/qa-db.sh <up|status|verify|reset|down|env> [--volumes]

Local disposable MySQL 8.4 and PostgreSQL 16 QA environment only.
  up                Create containers and wait for health checks.
  status            Show only VaporLensDB QA services.
  verify            Verify the disposable marker and shared fixture.
  reset             Recreate only VaporLensDB QA volumes and fixture baseline.
  down              Stop/remove only VaporLensDB QA containers; retain volumes.
  down --volumes    Also remove only VaporLensDB QA named volumes.
  env               Print shell exports for explicit live integration.
EOF
}

wait_for_health() {
  local service container health attempt
  for attempt in {1..60}; do
    local ready=1
    for service in mysql postgres; do
      container="$("${COMPOSE[@]}" ps -q "$service")"
      if [[ -z "$container" ]]; then
        ready=0
        continue
      fi
      health="$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}missing{{end}}' "$container")"
      if [[ "$health" != "healthy" ]]; then
        ready=0
      fi
    done
    [[ "$ready" == "1" ]] && return 0
    sleep 1
  done

  "${COMPOSE[@]}" ps >&2
  printf 'Timed out waiting for VaporLensDB QA services to become healthy.\n' >&2
  return 1
}

verify() {
  "${COMPOSE[@]}" exec -T -e MYSQL_PWD=vaporlensdb_qa_admin_local_only mysql mysql --protocol=tcp -h 127.0.0.1 -uroot vaporlensdb_qa \
    -Nse "SELECT CONCAT(environment, ':', fixture_version) FROM vaporlensdb_qa_marker WHERE environment = 'disposable_qa'" \
    | grep -qx 'disposable_qa:1'
  "${COMPOSE[@]}" exec -T -e MYSQL_PWD=vaporlensdb_qa_admin_local_only mysql mysql --protocol=tcp -h 127.0.0.1 -uroot vaporlensdb_qa \
    -Nse "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema = 'vaporlensdb_qa' AND table_name IN ('parent_items', 'child_items', 'child_item_view')" \
    | grep -qx '3'
  "${COMPOSE[@]}" exec -T postgres psql -U vaporlensdb_qa_admin -d vaporlensdb_qa -Atqc \
    "SELECT environment || ':' || fixture_version FROM vaporlensdb_qa_marker WHERE environment = 'disposable_qa'" \
    | grep -qx 'disposable_qa:1'
  "${COMPOSE[@]}" exec -T postgres psql -U vaporlensdb_qa_admin -d vaporlensdb_qa -Atqc \
    "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema = 'public' AND table_name IN ('parent_items', 'child_items', 'child_item_view')" \
    | grep -qx '3'
  "${COMPOSE[@]}" exec -T -e MYSQL_PWD=vaporlensdb_qa_local_only mysql mysql --protocol=tcp -h 127.0.0.1 -uvaporlensdb_qa vaporlensdb_qa \
    -Nse "SELECT environment FROM vaporlensdb_qa_marker WHERE environment = 'disposable_qa'" \
    | grep -qx 'disposable_qa'
  "${COMPOSE[@]}" exec -T -e PGPASSWORD=vaporlensdb_qa_local_only postgres psql -U vaporlensdb_qa -d vaporlensdb_qa -Atqc \
    "SELECT environment FROM vaporlensdb_qa_marker WHERE environment = 'disposable_qa'" \
    | grep -qx 'disposable_qa'
  "${COMPOSE[@]}" exec -T postgres psql -U vaporlensdb_qa_admin -d vaporlensdb_qa -Atqc \
    "SELECT rolcreatedb FROM pg_roles WHERE rolname = 'vaporlensdb_qa'" \
    | grep -qx 'f'
  "${COMPOSE[@]}" exec -T -e MYSQL_PWD=vaporlensdb_qa_admin_local_only mysql mysql --protocol=tcp -h 127.0.0.1 -uroot \
    -Nse "SHOW GRANTS FOR 'vaporlensdb_qa'@'%'" \
    | grep -Fqx 'GRANT SELECT, INSERT, UPDATE, DELETE, CREATE, DROP, REFERENCES, INDEX, ALTER, CREATE VIEW, SHOW VIEW, TRIGGER ON `vaporlensdb_qa`.* TO `vaporlensdb_qa`@`%`'
  printf 'VaporLensDB QA markers and fixtures verified.\n'
}

print_env() {
  local mysql_port="${VAPORLENSDB_QA_MYSQL_PORT:-13306}"
  local postgres_port="${VAPORLENSDB_QA_POSTGRES_PORT:-15432}"
  cat <<EOF
# Synthetic local-only QA values. Do not add them to a shared or production .env.
export QA_MYSQL_HOST=127.0.0.1
export QA_MYSQL_PORT=${mysql_port}
export QA_MYSQL_DATABASE=vaporlensdb_qa
export QA_MYSQL_USER=vaporlensdb_qa
export QA_POSTGRES_HOST=127.0.0.1
export QA_POSTGRES_PORT=${postgres_port}
export QA_POSTGRES_DATABASE=vaporlensdb_qa
export QA_POSTGRES_USER=vaporlensdb_qa
export VAPORLENSDB_QA_ENVIRONMENT=1

# For explicit JDBC live tests, separately export locally installed JDBC JAR paths.
export TEST_MYSQL_JDBC_URL='jdbc:mysql://127.0.0.1:${mysql_port}/vaporlensdb_qa'
export TEST_MYSQL_USER='vaporlensdb_qa'
export TEST_MYSQL_PASSWORD='vaporlensdb_qa_local_only'
export TEST_MYSQL_DATABASE='vaporlensdb_qa'
export TEST_PG_JDBC_URL='jdbc:postgresql://127.0.0.1:${postgres_port}/vaporlensdb_qa'
export TEST_PG_USER='vaporlensdb_qa'
export TEST_PG_PASSWORD='vaporlensdb_qa_local_only'
export TEST_PG_DATABASE='vaporlensdb_qa'
# TEST_MYSQL_JDBC_DRIVER_PATH=/absolute/path/to/mysql-connector-j.jar
# TEST_PG_JDBC_DRIVER_PATH=/absolute/path/to/postgresql.jar

# Destructive CREATE/DROP DATABASE checks are separate and require both this
# local admin URL and VAPORLENSDB_ALLOW_DESTRUCTIVE_INTEGRATION=1.
export VAPORLENSDB_TEST_MYSQL_URL='mysql://root:vaporlensdb_qa_admin_local_only@127.0.0.1:${mysql_port}/vaporlensdb_qa'
export VAPORLENSDB_TEST_POSTGRES_URL='host=127.0.0.1 port=${postgres_port} dbname=vaporlensdb_qa user=vaporlensdb_qa_admin password=vaporlensdb_qa_admin_local_only'
EOF
}

case "${1:-}" in
  up)
    "${COMPOSE[@]}" up --detach
    wait_for_health
    verify
    ;;
  status)
    "${COMPOSE[@]}" ps
    ;;
  verify)
    verify
    ;;
  reset)
    "${COMPOSE[@]}" down --volumes --remove-orphans
    "${COMPOSE[@]}" up --detach
    wait_for_health
    verify
    ;;
  down)
    if [[ "${2:-}" == "--volumes" ]]; then
      "${COMPOSE[@]}" down --volumes --remove-orphans
    elif [[ -z "${2:-}" ]]; then
      "${COMPOSE[@]}" down --remove-orphans
    else
      usage >&2
      exit 2
    fi
    ;;
  env)
    print_env
    ;;
  *)
    usage >&2
    exit 2
    ;;
esac
