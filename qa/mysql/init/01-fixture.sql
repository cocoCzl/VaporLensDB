-- VaporLensDB disposable local QA fixture. Never use outside this Compose stack.
CREATE USER IF NOT EXISTS 'vaporlensdb_qa'@'%' IDENTIFIED BY 'vaporlensdb_qa_local_only';
GRANT SELECT, INSERT, UPDATE, DELETE, CREATE, ALTER, DROP, INDEX, REFERENCES,
  CREATE VIEW, SHOW VIEW, TRIGGER ON vaporlensdb_qa.* TO 'vaporlensdb_qa'@'%';
CREATE DATABASE vaporlensdb_qa_alt;
GRANT SELECT ON vaporlensdb_qa_alt.* TO 'vaporlensdb_qa'@'%';
FLUSH PRIVILEGES;

USE vaporlensdb_qa_alt;
CREATE TABLE vaporlensdb_qa_marker (
  environment VARCHAR(64) NOT NULL PRIMARY KEY,
  fixture_version INT NOT NULL
);
INSERT INTO vaporlensdb_qa_marker (environment, fixture_version)
VALUES ('disposable_qa_alt', 1);
CREATE TABLE context_marker (context_name VARCHAR(64) NOT NULL PRIMARY KEY);
INSERT INTO context_marker VALUES ('vaporlensdb_qa_alt');

USE vaporlensdb_qa;

CREATE TABLE vaporlensdb_qa_marker (
  environment VARCHAR(64) NOT NULL PRIMARY KEY,
  fixture_version INT NOT NULL
);
INSERT INTO vaporlensdb_qa_marker (environment, fixture_version)
VALUES ('disposable_qa', 1);

CREATE TABLE parent_items (
  id INT NOT NULL PRIMARY KEY,
  code VARCHAR(32) NOT NULL,
  created_at DATETIME NOT NULL
);

CREATE TABLE child_items (
  id INT NOT NULL PRIMARY KEY,
  parent_id INT NOT NULL,
  nullable_note VARCHAR(128) NULL,
  quantity DECIMAL(12,2) NOT NULL,
  body_text TEXT NOT NULL,
  occurred_at DATETIME NOT NULL,
  enabled TINYINT(1) NOT NULL,
  CONSTRAINT fk_child_parent FOREIGN KEY (parent_id) REFERENCES parent_items(id),
  INDEX idx_child_parent (parent_id)
);

CREATE VIEW child_item_view AS
SELECT id, parent_id, nullable_note, quantity, enabled FROM child_items;

INSERT INTO parent_items (id, code, created_at) VALUES
  (1, 'PARENT-A', '2026-01-01 09:00:00'),
  (2, 'PARENT-B', '2026-01-02 10:00:00');
INSERT INTO child_items (id, parent_id, nullable_note, quantity, body_text, occurred_at, enabled) VALUES
  (1, 1, NULL, 12.50, 'fixture text A', '2026-01-03 11:00:00', 1),
  (2, 2, 'optional note', 7.25, 'fixture text B', '2026-01-04 12:00:00', 0);
