-- ============================================
-- Migration v9: Inbox + Scheduler
-- ============================================

-- scheduled_events 表: 定时任务/提醒/截止
CREATE TABLE IF NOT EXISTS scheduled_events (
  id            VARCHAR(64) PRIMARY KEY,
  user_id       VARCHAR(64) NOT NULL,
  type          ENUM('reminder', 'deadline', 'recurring', 'conditional') NOT NULL,
  trigger_config JSON NOT NULL,
  action_config  JSON NOT NULL,
  escalation_config JSON,
  source        VARCHAR(50) NOT NULL,
  source_id     VARCHAR(64),
  status        ENUM('pending', 'triggered', 'completed', 'cancelled', 'failed') DEFAULT 'pending',
  retry_count   INT DEFAULT 0,
  created_at    BIGINT NOT NULL,
  triggered_at  BIGINT,
  completed_at  BIGINT,
  INDEX idx_user_status (user_id, status),
  INDEX idx_trigger_at (triggered_at),
  INDEX idx_source (source, source_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- inbox_items 表: 统一收件箱
CREATE TABLE IF NOT EXISTS inbox_items (
  id              VARCHAR(64) PRIMARY KEY,
  user_id         VARCHAR(64) NOT NULL,
  type            ENUM('approval', 'notification', 'task', 'alert') NOT NULL,
  category        VARCHAR(50) NOT NULL,
  source          VARCHAR(50) NOT NULL,
  source_id       VARCHAR(64),
  title           VARCHAR(255) NOT NULL,
  description     TEXT,
  priority        ENUM('low', 'normal', 'high', 'urgent') DEFAULT 'normal',
  status          ENUM('unread', 'read', 'pending', 'completed', 'dismissed') DEFAULT 'unread',
  payload         JSON,
  ai_suggestion   JSON,
  aggregate_group_id VARCHAR(64),
  aggregate_count    INT DEFAULT 1,
  conversation_id    VARCHAR(64),
  scheduled_at       BIGINT,
  due_at             BIGINT,
  created_at         BIGINT NOT NULL,
  completed_at       BIGINT,
  INDEX idx_user_status (user_id, status),
  INDEX idx_conversation (conversation_id),
  INDEX idx_aggregate (aggregate_group_id),
  INDEX idx_due (due_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
