-- 表单定义表
CREATE TABLE IF NOT EXISTS form_definitions (
  id              VARCHAR(36) PRIMARY KEY,
  key             VARCHAR(64) UNIQUE NOT NULL,
  name            VARCHAR(128) NOT NULL,
  description     TEXT,
  category_id     VARCHAR(36),
  schema_json     JSON NOT NULL,
  version         INT DEFAULT 1,
  status          VARCHAR(20) DEFAULT 'draft',
  created_by      VARCHAR(36) NOT NULL,
  created_at      DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at      DATETIME DEFAULT CURRENT_TIMESTAMP,
  published_at    DATETIME,
  deprecated_at   DATETIME
);

-- 表单分类表
CREATE TABLE IF NOT EXISTS form_categories (
  id          VARCHAR(36) PRIMARY KEY,
  name        VARCHAR(64) NOT NULL,
  code        VARCHAR(64) UNIQUE NOT NULL,
  parent_id   VARCHAR(36),
  sort_order  INT DEFAULT 0,
  created_at  DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 表单实例表
CREATE TABLE IF NOT EXISTS form_instances (
  id              VARCHAR(36) PRIMARY KEY,
  definition_id   VARCHAR(36) NOT NULL,
  definition_version INT DEFAULT 1,
  data_json       JSON NOT NULL,
  status          VARCHAR(20) DEFAULT 'draft',
  submitted_by    VARCHAR(36),
  submitted_at    DATETIME,
  created_at      DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at      DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 表单与流程关联表
CREATE TABLE IF NOT EXISTS workflow_form_bindings (
  id              VARCHAR(36) PRIMARY KEY,
  definition_key  VARCHAR(64) NOT NULL,
  node_id         VARCHAR(64) NOT NULL,
  form_id         VARCHAR(36) NOT NULL,
  form_version    INT DEFAULT -1,
  is_required     BOOLEAN DEFAULT true,
  mapping_json    JSON,
  created_at      DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(definition_key, node_id)
);

-- 表单数据与流程实例关联（快照）
CREATE TABLE IF NOT EXISTS workflow_form_instances (
  id              VARCHAR(36) PRIMARY KEY,
  instance_id     VARCHAR(36) NOT NULL,
  task_id         VARCHAR(36),
  form_id         VARCHAR(36) NOT NULL,
  form_version    INT NOT NULL,
  schema_snapshot JSON NOT NULL,
  data_json       JSON NOT NULL,
  submitted_by    VARCHAR(36),
  submitted_at    DATETIME,
  created_at      DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 扩展现有 connections 表
ALTER TABLE connections ADD COLUMN IF NOT EXISTS db_config JSON;
ALTER TABLE connections ADD COLUMN IF NOT EXISTS test_query VARCHAR(256);
