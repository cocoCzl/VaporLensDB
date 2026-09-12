-- VaporLensDB disposable local QA fixture. Never use outside this Compose stack.
CREATE ROLE vaporlensdb_qa LOGIN PASSWORD 'vaporlensdb_qa_local_only';
GRANT CONNECT, TEMP, CREATE ON DATABASE vaporlensdb_qa TO vaporlensdb_qa;
GRANT USAGE, CREATE ON SCHEMA public TO vaporlensdb_qa;

CREATE TABLE vaporlensdb_qa_marker (
  environment TEXT PRIMARY KEY,
  fixture_version INTEGER NOT NULL
);
INSERT INTO vaporlensdb_qa_marker (environment, fixture_version)
VALUES ('disposable_qa', 1);

CREATE TABLE parent_items (
  id INTEGER PRIMARY KEY,
  code VARCHAR(32) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL
);

CREATE TABLE child_items (
  id INTEGER PRIMARY KEY,
  parent_id INTEGER NOT NULL REFERENCES parent_items(id),
  nullable_note VARCHAR(128),
  quantity NUMERIC(12,2) NOT NULL,
  body_text TEXT NOT NULL,
  occurred_at TIMESTAMPTZ NOT NULL,
  enabled BOOLEAN NOT NULL
);
CREATE INDEX idx_child_parent ON child_items(parent_id);
CREATE VIEW child_item_view AS
SELECT id, parent_id, nullable_note, quantity, enabled FROM child_items;

INSERT INTO parent_items (id, code, created_at) VALUES
  (1, 'PARENT-A', '2026-01-01 09:00:00+00'),
  (2, 'PARENT-B', '2026-01-02 10:00:00+00');
INSERT INTO child_items (id, parent_id, nullable_note, quantity, body_text, occurred_at, enabled) VALUES
  (1, 1, NULL, 12.50, 'fixture text A', '2026-01-03 11:00:00+00', true),
  (2, 2, 'optional note', 7.25, 'fixture text B', '2026-01-04 12:00:00+00', false);

GRANT SELECT, INSERT, UPDATE, DELETE, REFERENCES, TRIGGER ON ALL TABLES IN SCHEMA public TO vaporlensdb_qa;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO vaporlensdb_qa;
