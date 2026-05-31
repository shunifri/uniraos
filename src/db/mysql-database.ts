/**
 * MySQL Database Initialization and Migration System
 * 完整数据库 Schema 包含所有表、索引、备注和 Seed Data
 * 版本: v1 (合并原 SQLite v1-v8 所有变更)
 */

import { getMySQLAdapter } from './mysql-adapter.js';
import { log } from '../utils/logger.js';

interface Migration {
  version: number;
  name: string;
  up: string;
  down: string;
}

export const MIGRATIONS: Migration[] = [
  {
    version: 1,
    name: 'init_complete_schema',
    up: `
      -- ============================================
      -- 1. Schema 版本管理表
      -- ============================================
      CREATE TABLE IF NOT EXISTS schema_version (
        version INT PRIMARY KEY COMMENT '迁移版本号',
        name VARCHAR(100) NOT NULL COMMENT '迁移名称',
        applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP COMMENT '应用时间'
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='数据库迁移版本记录';

      -- ============================================
      -- 2. 部门表（树形结构，物化路径）
      -- ============================================
      CREATE TABLE IF NOT EXISTS departments (
        id VARCHAR(64) PRIMARY KEY COMMENT '部门ID',
        name VARCHAR(200) NOT NULL COMMENT '部门名称',
        parent_id VARCHAR(64) COMMENT '父部门ID',
        path VARCHAR(500) NOT NULL COMMENT '物化路径（如：/总部/技术部）',
        level INT NOT NULL DEFAULT 0 COMMENT '层级（0为根）',
        description TEXT COMMENT '部门描述',
        created_at BIGINT NOT NULL DEFAULT (UNIX_TIMESTAMP() * 1000) COMMENT '创建时间（毫秒）',
        updated_at BIGINT NOT NULL DEFAULT (UNIX_TIMESTAMP() * 1000) COMMENT '更新时间（毫秒）',
        INDEX idx_departments_parent (parent_id) COMMENT '父部门索引',
        INDEX idx_departments_path (path) COMMENT '路径索引',
        FOREIGN KEY (parent_id) REFERENCES departments(id) ON DELETE RESTRICT
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='部门表（树形结构）';

      -- ============================================
      -- 3. 用户表
      -- ============================================
      CREATE TABLE IF NOT EXISTS users (
        id VARCHAR(64) PRIMARY KEY COMMENT '用户ID（UUID）',
        username VARCHAR(100) NOT NULL UNIQUE COMMENT '用户名（登录用）',
        display_name VARCHAR(200) NOT NULL DEFAULT '' COMMENT '显示名称',
        password_hash VARCHAR(255) NOT NULL COMMENT '密码哈希（scrypt salt:hash格式）',
        avatar VARCHAR(500) DEFAULT '' COMMENT '头像URL',
        department_id VARCHAR(64) COMMENT '所属部门ID',
        phone VARCHAR(20) DEFAULT '' COMMENT '手机号',
        email VARCHAR(200) DEFAULT '' COMMENT '邮箱',
        status ENUM('active', 'disabled', 'deleted') NOT NULL DEFAULT 'active' COMMENT '状态：active-正常, disabled-禁用, deleted-已删除',
        created_at BIGINT NOT NULL DEFAULT (UNIX_TIMESTAMP() * 1000) COMMENT '创建时间（毫秒）',
        updated_at BIGINT NOT NULL DEFAULT (UNIX_TIMESTAMP() * 1000) COMMENT '更新时间（毫秒）',
        last_login_at BIGINT COMMENT '最后登录时间（毫秒）',
        INDEX idx_users_username (username) COMMENT '用户名索引',
        INDEX idx_users_status (status) COMMENT '状态索引',
        INDEX idx_users_department (department_id) COMMENT '部门索引',
        FOREIGN KEY (department_id) REFERENCES departments(id) ON DELETE SET NULL
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='用户表';

      -- ============================================
      -- 4. 角色表
      -- ============================================
      CREATE TABLE IF NOT EXISTS roles (
        id VARCHAR(64) PRIMARY KEY COMMENT '角色ID',
        name VARCHAR(100) NOT NULL UNIQUE COMMENT '角色名称（如：admin, user, anonymous）',
        description TEXT COMMENT '角色描述',
        is_system TINYINT NOT NULL DEFAULT 0 COMMENT '是否系统角色（1=是，不可删除）',
        agent_config JSON DEFAULT NULL COMMENT 'Agent 配置 JSON',
        created_at BIGINT NOT NULL DEFAULT (UNIX_TIMESTAMP() * 1000) COMMENT '创建时间（毫秒）',
        updated_at BIGINT NOT NULL DEFAULT (UNIX_TIMESTAMP() * 1000) COMMENT '更新时间（毫秒）',
        INDEX idx_roles_name (name) COMMENT '角色名索引'
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='角色表（RBAC）';

      -- ============================================
      -- 5. 资源表（RBAC - 可授权的资源）
      -- ============================================
      CREATE TABLE IF NOT EXISTS resources (
        id VARCHAR(64) PRIMARY KEY COMMENT '资源ID',
        name VARCHAR(200) NOT NULL UNIQUE COMMENT '资源名称（如：skills, files, menu:chat）',
        type ENUM('api', 'skill', 'menu', 'data') NOT NULL COMMENT '资源类型：api-接口, skill-技能, menu-菜单, data-数据',
        description TEXT COMMENT '资源描述',
        created_at BIGINT NOT NULL DEFAULT (UNIX_TIMESTAMP() * 1000) COMMENT '创建时间（毫秒）',
        INDEX idx_resources_type (type) COMMENT '类型索引',
        INDEX idx_resources_name (name) COMMENT '资源名索引'
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='资源表（RBAC）';

      -- ============================================
      -- 6. 权限表（RBAC - 资源+操作组合）
      -- ============================================
      CREATE TABLE IF NOT EXISTS permissions (
        id VARCHAR(64) PRIMARY KEY COMMENT '权限ID',
        name VARCHAR(200) NOT NULL UNIQUE COMMENT '权限名称（如：skills.read, files.write）',
        description TEXT COMMENT '权限描述',
        resource_id VARCHAR(64) NOT NULL COMMENT '所属资源ID',
        action ENUM('read', 'write', 'execute', 'manage', '*') NOT NULL COMMENT '操作类型：read-读, write-写, execute-执行, manage-管理, *-所有',
        created_at BIGINT NOT NULL DEFAULT (UNIX_TIMESTAMP() * 1000) COMMENT '创建时间（毫秒）',
        INDEX idx_permissions_resource (resource_id) COMMENT '资源索引',
        INDEX idx_permissions_name (name) COMMENT '权限名索引',
        FOREIGN KEY (resource_id) REFERENCES resources(id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='权限表（RBAC）';

      -- ============================================
      -- 7. 角色-权限关联表
      -- ============================================
      CREATE TABLE IF NOT EXISTS role_permissions (
        role_id VARCHAR(64) NOT NULL COMMENT '角色ID',
        permission_id VARCHAR(64) NOT NULL COMMENT '权限ID',
        created_at BIGINT NOT NULL DEFAULT (UNIX_TIMESTAMP() * 1000) COMMENT '授权时间（毫秒）',
        PRIMARY KEY (role_id, permission_id),
        FOREIGN KEY (role_id) REFERENCES roles(id) ON DELETE CASCADE,
        FOREIGN KEY (permission_id) REFERENCES permissions(id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='角色权限关联表';

      -- ============================================
      -- 8. 用户-角色关联表
      -- ============================================
      CREATE TABLE IF NOT EXISTS user_roles (
        user_id VARCHAR(64) NOT NULL COMMENT '用户ID',
        role_id VARCHAR(64) NOT NULL COMMENT '角色ID',
        created_at BIGINT NOT NULL DEFAULT (UNIX_TIMESTAMP() * 1000) COMMENT '授权时间（毫秒）',
        PRIMARY KEY (user_id, role_id),
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
        FOREIGN KEY (role_id) REFERENCES roles(id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='用户角色关联表';

      -- ============================================
      -- 9. 部门-资源关联表（数据范围控制）
      -- ============================================
      CREATE TABLE IF NOT EXISTS department_resources (
        department_id VARCHAR(64) NOT NULL COMMENT '部门ID',
        resource_id VARCHAR(64) NOT NULL COMMENT '资源ID',
        created_at BIGINT NOT NULL DEFAULT (UNIX_TIMESTAMP() * 1000) COMMENT '授权时间（毫秒）',
        PRIMARY KEY (department_id, resource_id),
        FOREIGN KEY (department_id) REFERENCES departments(id) ON DELETE CASCADE,
        FOREIGN KEY (resource_id) REFERENCES resources(id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='部门资源关联表（数据范围）';

      -- ============================================
      -- 10. 会话表（Token 管理）
      -- ============================================
      CREATE TABLE IF NOT EXISTS sessions (
        token VARCHAR(255) PRIMARY KEY COMMENT '会话Token（JWT）',
        user_id VARCHAR(64) NOT NULL COMMENT '用户ID',
        expires_at BIGINT NOT NULL COMMENT '过期时间（毫秒）',
        created_at BIGINT NOT NULL DEFAULT (UNIX_TIMESTAMP() * 1000) COMMENT '创建时间（毫秒）',
        INDEX idx_sessions_user (user_id) COMMENT '用户索引',
        INDEX idx_sessions_expires (expires_at) COMMENT '过期时间索引',
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='用户会话表';

      -- ============================================
      -- 11. 知识库文档表
      -- ============================================
      CREATE TABLE IF NOT EXISTS kb_documents (
        doc_id VARCHAR(100) PRIMARY KEY COMMENT '文档ID',
        name VARCHAR(500) NOT NULL COMMENT '文档名称（文件名）',
        source VARCHAR(500) DEFAULT '' COMMENT '来源路径/URL',
        owner_id VARCHAR(64) NOT NULL COMMENT '所有者用户ID',
        chunk_count INT DEFAULT 0 COMMENT '分块数量',
        total_tokens INT DEFAULT 0 COMMENT '总Token数',
        ingested_at BIGINT NOT NULL COMMENT '入库时间（毫秒）',
        updated_at BIGINT COMMENT '更新时间（毫秒）',
        version INT DEFAULT 1 COMMENT '版本号',
        tags JSON COMMENT '标签数组（JSON）',
        shared TINYINT DEFAULT 0 COMMENT '是否共享（1=是）',
        content_hash VARCHAR(64) DEFAULT '' COMMENT '内容哈希（去重用）',
        parsed_content LONGTEXT COMMENT '解析后的纯文本内容',
        layouts_json JSON COMMENT '版面布局信息（JSON）',
        segments_json JSON COMMENT '分段信息（JSON）',
        doc_mind_task_id VARCHAR(100) COMMENT 'DocMind解析任务ID',
        parsing_status VARCHAR(50) DEFAULT 'success' COMMENT '解析状态：success-成功, processing-处理中, failed-失败',
        parsing_progress DECIMAL(5,2) DEFAULT 100.00 COMMENT '解析进度（0-100）',
        media_type VARCHAR(50) DEFAULT 'document' COMMENT '媒体类型：document-文档, video-视频, audio-音频',
        duration_ms INT COMMENT '音视频时长（毫秒）',
        UNIQUE KEY uk_kb_documents_name_owner (name, owner_id) COMMENT '用户内文件名唯一',
        INDEX idx_kb_documents_owner (owner_id) COMMENT '所有者索引',
        INDEX idx_kb_documents_shared (shared) COMMENT '共享状态索引',
        INDEX idx_kb_documents_ingested (ingested_at) COMMENT '入库时间索引',
        FOREIGN KEY (owner_id) REFERENCES users(id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='知识库文档表';

      -- ============================================
      -- 11b. 知识库标签关联表
      -- ============================================
      CREATE TABLE IF NOT EXISTS kb_tags (
        tag VARCHAR(100) NOT NULL COMMENT '标签名',
        doc_id VARCHAR(100) NOT NULL COMMENT '文档ID',
        created_at BIGINT DEFAULT (unix_timestamp() * 1000) COMMENT '创建时间（毫秒）',
        PRIMARY KEY (tag, doc_id),
        INDEX idx_kb_tags_doc (doc_id) COMMENT '文档索引',
        INDEX idx_kb_tags_tag (tag) COMMENT '标签索引',
        FOREIGN KEY (doc_id) REFERENCES kb_documents(doc_id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='知识库标签关联表';

      -- ============================================
      -- 12. 知识库文档分块表
      -- ============================================
      CREATE TABLE IF NOT EXISTS kb_chunks (
        id BIGINT AUTO_INCREMENT PRIMARY KEY COMMENT '分块ID',
        doc_id VARCHAR(100) NOT NULL COMMENT '所属文档ID',
        chunk_index INT NOT NULL COMMENT '分块序号',
        content LONGTEXT NOT NULL COMMENT '分块文本内容',
        tokens INT DEFAULT 0 COMMENT 'Token数',
        vector BLOB COMMENT '向量数据（二进制）',
        page_number INT COMMENT '所在页码',
        bbox_data JSON COMMENT '边界框坐标（JSON）',
        segment_index INT COMMENT '段落索引',
        time_range VARCHAR(100) COMMENT '音视频时间范围（如：00:01:30-00:02:15）',
        frame_url VARCHAR(500) COMMENT '视频帧截图URL',
        asr_text TEXT COMMENT '语音识别文本',
        content_type VARCHAR(50) DEFAULT 'text' COMMENT '内容类型：text-文本, image-图片, audio-音频, video-视频',
        INDEX idx_kb_chunks_doc_id (doc_id) COMMENT '文档索引',
        INDEX idx_kb_chunks_content_type (content_type) COMMENT '内容类型索引',
        FOREIGN KEY (doc_id) REFERENCES kb_documents(doc_id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='知识库文档分块表';

      -- ============================================
      -- 13. 知识库版本历史表
      -- ============================================
      CREATE TABLE IF NOT EXISTS kb_versions (
        doc_id VARCHAR(100) NOT NULL COMMENT '文档ID',
        version INT NOT NULL COMMENT '版本号',
        content_hash VARCHAR(64) NOT NULL COMMENT '内容哈希',
        chunk_count INT DEFAULT 0 COMMENT '分块数量',
        total_tokens INT DEFAULT 0 COMMENT '总Token数',
        created_at BIGINT NOT NULL COMMENT '创建时间（毫秒）',
        PRIMARY KEY (doc_id, version),
        FOREIGN KEY (doc_id) REFERENCES kb_documents(doc_id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='知识库文档版本历史表';

      -- ============================================
      -- 14. 知识库关键词表（用于关键词搜索）
      -- ============================================
      CREATE TABLE IF NOT EXISTS kb_keywords (
        keyword VARCHAR(100) NOT NULL COMMENT '关键词',
        chunk_id BIGINT NOT NULL COMMENT '分块ID',
        tf DECIMAL(10, 8) DEFAULT 0 COMMENT '词频（TF值）',
        PRIMARY KEY (keyword, chunk_id),
        INDEX idx_kb_keywords_chunk (chunk_id) COMMENT '分块索引',
        INDEX idx_kb_keywords_keyword (keyword) COMMENT '关键词索引',
        FOREIGN KEY (chunk_id) REFERENCES kb_chunks(id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='知识库关键词索引表';

      -- ============================================
      -- 15. 共享规则表
      -- ============================================
      CREATE TABLE IF NOT EXISTS share_rules (
        id VARCHAR(64) PRIMARY KEY COMMENT '规则ID',
        resource_type ENUM('skill', 'kb_document', 'file') NOT NULL COMMENT '资源类型',
        resource_id VARCHAR(100) NOT NULL COMMENT '资源ID',
        owner_id VARCHAR(64) NOT NULL COMMENT '所有者用户ID',
        scope ENUM('all', 'role', 'department', 'user') NOT NULL COMMENT '共享范围：all-所有人, role-指定角色, department-指定部门, user-指定用户',
        target_id VARCHAR(64) COMMENT '目标ID（根据scope：role_id/dept_id/user_id，all时为空）',
        permission ENUM('read', 'execute', 'write') NOT NULL DEFAULT 'read' COMMENT '权限：read-读, execute-执行, write-写',
        created_at BIGINT NOT NULL DEFAULT (UNIX_TIMESTAMP() * 1000) COMMENT '创建时间（毫秒）',
        INDEX idx_share_rules_resource (resource_type, resource_id) COMMENT '资源索引',
        INDEX idx_share_rules_owner (owner_id) COMMENT '所有者索引',
        INDEX idx_share_rules_scope_target (scope, target_id) COMMENT '范围目标索引',
        FOREIGN KEY (owner_id) REFERENCES users(id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='资源共享规则表';

      -- ============================================
      -- 16. WAL（预写日志）表
      -- ============================================
      CREATE TABLE IF NOT EXISTS wal_entries (
        id BIGINT AUTO_INCREMENT PRIMARY KEY COMMENT '日志ID',
        sequence_number BIGINT NOT NULL UNIQUE COMMENT '序列号（全局递增）',
        operation_type ENUM('INSERT', 'UPDATE', 'DELETE') NOT NULL COMMENT '操作类型',
        table_name VARCHAR(100) NOT NULL COMMENT '表名',
        record_id VARCHAR(100) NOT NULL COMMENT '记录ID',
        old_data JSON COMMENT '变更前数据（JSON）',
        new_data JSON COMMENT '变更后数据（JSON）',
        timestamp BIGINT NOT NULL DEFAULT (UNIX_TIMESTAMP() * 1000) COMMENT '时间戳（毫秒）',
        transaction_id VARCHAR(64) COMMENT '事务ID',
        INDEX idx_wal_sequence (sequence_number) COMMENT '序列号索引',
        INDEX idx_wal_table_record (table_name, record_id) COMMENT '表记录索引',
        INDEX idx_wal_timestamp (timestamp) COMMENT '时间戳索引',
        INDEX idx_wal_transaction (transaction_id) COMMENT '事务索引'
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='预写日志表（WAL）';

      -- ============================================
      -- 17. 对话会话表
      -- ============================================
      CREATE TABLE IF NOT EXISTS conversations (
        id VARCHAR(64) PRIMARY KEY COMMENT '会话ID',
        user_id VARCHAR(64) NOT NULL COMMENT '用户ID',
        title VARCHAR(500) NOT NULL DEFAULT '' COMMENT '会话标题',
        created_at BIGINT NOT NULL DEFAULT (UNIX_TIMESTAMP() * 1000) COMMENT '创建时间（毫秒）',
        updated_at BIGINT NOT NULL DEFAULT (UNIX_TIMESTAMP() * 1000) COMMENT '更新时间（毫秒）',
        INDEX idx_conversations_user (user_id) COMMENT '用户索引',
        INDEX idx_conversations_updated (updated_at DESC) COMMENT '更新时间倒序索引',
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='对话会话表';

      -- ============================================
      -- 18. 对话消息表
      -- ============================================
      CREATE TABLE IF NOT EXISTS chat_messages (
        id BIGINT AUTO_INCREMENT PRIMARY KEY COMMENT '消息ID',
        conversation_id VARCHAR(64) NOT NULL COMMENT '所属会话ID',
        role ENUM('user', 'assistant', 'tool', 'system', 'thinking', 'strategy') NOT NULL COMMENT '角色：user-用户, assistant-助手, tool-工具, system-系统, thinking-思考, strategy-策略',
        content LONGTEXT NOT NULL COMMENT '消息内容',
        skill_name VARCHAR(100) COMMENT '调用的技能名称',
        status VARCHAR(50) COMMENT '状态',
        is_error TINYINT NOT NULL DEFAULT 0 COMMENT '是否错误（1=是）',
        extra JSON COMMENT '扩展数据（JSON，如chartOptions等）',
        created_at BIGINT NOT NULL DEFAULT (UNIX_TIMESTAMP() * 1000) COMMENT '创建时间（毫秒）',
        INDEX idx_chat_messages_conv (conversation_id) COMMENT '会话索引',
        INDEX idx_chat_messages_conv_created (conversation_id, created_at DESC) COMMENT '会话时间复合索引',
        FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='对话消息表';

      -- ============================================
      -- 19. 自定义PPTX主题表
      -- ============================================
      CREATE TABLE IF NOT EXISTS custom_pptx_themes (
        id VARCHAR(64) PRIMARY KEY COMMENT '主题ID',
        user_id VARCHAR(64) NOT NULL COMMENT '用户ID',
        name VARCHAR(200) NOT NULL COMMENT '主题名称',
        colors_json LONGTEXT NOT NULL COMMENT '颜色配置（JSON）',
        fonts_json LONGTEXT NOT NULL COMMENT '字体配置（JSON）',
        source_file VARCHAR(500) DEFAULT '' COMMENT '来源文件路径',
        created_at BIGINT NOT NULL DEFAULT (UNIX_TIMESTAMP() * 1000) COMMENT '创建时间（毫秒）',
        INDEX idx_custom_themes_user (user_id) COMMENT '用户索引',
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='自定义PPTX主题表（风格学习）';

      -- ============================================
      -- 20. 文件上传元数据表
      -- ============================================
      CREATE TABLE IF NOT EXISTS uploads (
        id VARCHAR(64) PRIMARY KEY COMMENT '上传ID',
        original_name VARCHAR(500) NOT NULL COMMENT '原始文件名',
        stored_name VARCHAR(500) NOT NULL COMMENT '存储文件名',
        path VARCHAR(500) NOT NULL COMMENT '相对路径',
        size BIGINT NOT NULL COMMENT '文件大小（字节）',
        mime_type VARCHAR(100) COMMENT 'MIME类型',
        uploaded_by VARCHAR(64) DEFAULT 'system' COMMENT '上传者',
        uploaded_at BIGINT NOT NULL DEFAULT (UNIX_TIMESTAMP() * 1000) COMMENT '上传时间（毫秒）',
        tags JSON COMMENT '标签（JSON数组）',
        description TEXT COMMENT '描述',
        INDEX idx_uploads_stored_name (stored_name) COMMENT '存储名索引',
        INDEX idx_uploads_uploaded_by (uploaded_by) COMMENT '上传者索引',
        INDEX idx_uploads_uploaded_at (uploaded_at) COMMENT '时间索引'
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='文件上传元数据表';

      -- ============================================
      -- 21. 知识图谱节点表
      -- ============================================
      CREATE TABLE IF NOT EXISTS kb_graph_nodes (
        id VARCHAR(64) PRIMARY KEY COMMENT '节点ID',
        owner_id VARCHAR(64) NOT NULL COMMENT '所有者用户ID',
        label VARCHAR(500) NOT NULL COMMENT '节点标签',
        type VARCHAR(50) NOT NULL COMMENT '节点类型',
        tags JSON COMMENT '标签数组（JSON）',
        properties JSON COMMENT '节点属性（JSON）',
        created_at BIGINT NOT NULL DEFAULT (UNIX_TIMESTAMP() * 1000) COMMENT '创建时间（毫秒）',
        INDEX idx_kb_graph_nodes_owner (owner_id) COMMENT '所有者索引',
        INDEX idx_kb_graph_nodes_label (owner_id, label) COMMENT '标签查询索引',
        INDEX idx_kb_graph_nodes_type (owner_id, type) COMMENT '类型索引',
        FOREIGN KEY (owner_id) REFERENCES users(id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='知识图谱节点表';

      -- ============================================
      -- 22. 知识图谱边表
      -- ============================================
      CREATE TABLE IF NOT EXISTS kb_graph_edges (
        id VARCHAR(64) PRIMARY KEY COMMENT '边ID',
        owner_id VARCHAR(64) NOT NULL COMMENT '所有者用户ID',
        source_id VARCHAR(64) NOT NULL COMMENT '源节点ID',
        target_id VARCHAR(64) NOT NULL COMMENT '目标节点ID',
        type VARCHAR(50) NOT NULL COMMENT '边类型',
        label VARCHAR(200) COMMENT '边标签',
        weight DECIMAL(5,4) DEFAULT 1.0 COMMENT '权重（0-1）',
        created_at BIGINT NOT NULL DEFAULT (UNIX_TIMESTAMP() * 1000) COMMENT '创建时间（毫秒）',
        INDEX idx_kb_graph_edges_owner (owner_id) COMMENT '所有者索引',
        INDEX idx_kb_graph_edges_source (owner_id, source_id) COMMENT '源节点索引',
        INDEX idx_kb_graph_edges_target (owner_id, target_id) COMMENT '目标节点索引',
        FOREIGN KEY (source_id) REFERENCES kb_graph_nodes(id) ON DELETE CASCADE,
        FOREIGN KEY (target_id) REFERENCES kb_graph_nodes(id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='知识图谱边表';

      -- ============================================
      -- 23. 长期记忆条目表
      -- ============================================
      CREATE TABLE IF NOT EXISTS kb_ltm_entries (
        id VARCHAR(64) PRIMARY KEY COMMENT '记忆ID',
        owner_id VARCHAR(64) NOT NULL COMMENT '所有者用户ID',
        entry_key VARCHAR(500) NOT NULL COMMENT '记忆键',
        value JSON NOT NULL COMMENT '记忆值（JSON）',
        tags JSON COMMENT '标签数组（JSON）',
        source VARCHAR(200) COMMENT '来源',
        summary TEXT COMMENT '摘要',
        access_count INT DEFAULT 0 COMMENT '访问次数',
        created_at BIGINT NOT NULL DEFAULT (UNIX_TIMESTAMP() * 1000) COMMENT '创建时间（毫秒）',
        updated_at BIGINT NOT NULL DEFAULT (UNIX_TIMESTAMP() * 1000) COMMENT '更新时间（毫秒）',
        last_accessed_at BIGINT DEFAULT (UNIX_TIMESTAMP() * 1000) COMMENT '最后访问时间（毫秒）',
        vector BLOB COMMENT '向量数据（二进制）',
        is_archived TINYINT DEFAULT 0 COMMENT '是否已归档（1=是）',
        INDEX idx_kb_ltm_owner (owner_id) COMMENT '所有者索引',
        INDEX idx_kb_ltm_key (owner_id, entry_key) COMMENT '键索引',
        INDEX idx_kb_ltm_access (owner_id, last_accessed_at) COMMENT '访问时间索引',
        INDEX idx_kb_ltm_archived (owner_id, is_archived) COMMENT '归档状态索引',
        FOREIGN KEY (owner_id) REFERENCES users(id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='长期记忆条目表';

      -- ============================================
      -- 24. 全文搜索索引（必须在表创建后执行）
      -- ============================================
      ALTER TABLE kb_documents ADD FULLTEXT INDEX ft_idx_kb_documents_name (name) COMMENT '文档名全文索引';
      ALTER TABLE kb_chunks ADD FULLTEXT INDEX ft_idx_kb_chunks_content (content) COMMENT '分块内容全文索引';

      -- ============================================
      -- Seed Data: 初始化数据
      -- ============================================

      -- 根部门
      INSERT INTO departments (id, name, parent_id, path, level, description) VALUES
        ('dept_root', '全体', NULL, '/全体', 0, '根部门，所有用户的默认归属');

      -- 系统角色（admin, user, anonymous）
      INSERT INTO roles (id, name, description, is_system) VALUES
        ('role_admin', 'admin', '系统管理员，拥有所有权限', 1),
        ('role_user', 'user', '普通用户，基础操作权限', 1),
        ('role_viewer', 'anonymous', '匿名用户（未登录），最小权限', 1);

      -- 菜单资源
      INSERT INTO resources (id, name, type, description) VALUES
        ('res_menu_skills', 'menu:skills', 'menu', '技能管理'),
        ('res_menu_chat', 'menu:chat', 'menu', '对话'),
        ('res_menu_knowledge', 'menu:knowledge', 'menu', '知识库'),
        ('res_menu_files', 'menu:files', 'menu', '文件管理'),
        ('res_menu_config', 'menu:config', 'menu', '系统配置'),
        ('res_menu_memory', 'menu:memory', 'menu', '记忆系统'),
        ('res_menu_evolution', 'menu:evolution', 'menu', '进化引擎'),
        ('res_menu_genealogy', 'menu:genealogy', 'menu', '族谱'),
        ('res_menu_federation', 'menu:federation', 'menu', '联邦'),
        ('res_menu_graph', 'menu:graph', 'menu', '知识图谱'),
        ('res_menu_admin', 'menu:admin', 'menu', '系统管理');

      -- API资源
      INSERT INTO resources (id, name, type, description) VALUES
        ('res_skills', 'skills', 'api', 'Skill列表与详情'),
        ('res_skills_exec', 'skills.exec', 'api', 'Skill执行'),
        ('res_skills_mgmt', 'skills.manage', 'api', 'Skill管理（增删）'),
        ('res_config', 'config', 'api', '系统配置查看'),
        ('res_config_write', 'config.write', 'api', '系统配置修改'),
        ('res_chat', 'chat', 'api', 'Agent对话'),
        ('res_chat_stream', 'chat.stream', 'api', 'Agent流式对话'),
        ('res_memory_read', 'memory.read', 'api', '记忆读取'),
        ('res_memory_write', 'memory.write', 'api', '记忆写入'),
        ('res_users', 'users', 'api', '用户管理'),
        ('res_roles', 'roles', 'api', '角色管理'),
        ('res_departments', 'departments', 'api', '部门管理'),
        ('res_plugins', 'plugins', 'api', '插件管理'),
        ('res_tasks', 'tasks', 'api', '异步任务管理'),
        ('res_knowledge', 'knowledge', 'api', '知识库管理'),
        ('res_files', 'files', 'api', '文件管理'),
        ('res_conversation', 'conversation', 'api', '对话管理'),
        ('res_system', 'system', 'api', '系统管理');

      -- 权限定义
      INSERT INTO permissions (id, name, description, resource_id, action) VALUES
        -- 技能权限
        ('perm_skills_read', 'skills.read', '查看Skill列表', 'res_skills', 'read'),
        ('perm_skills_exec', 'skills.execute', '执行Skill', 'res_skills_exec', 'execute'),
        ('perm_skills_manage', 'skills.manage', '管理Skill（增删）', 'res_skills_mgmt', 'manage'),
        -- 配置权限
        ('perm_config_read', 'config.read', '查看系统配置', 'res_config', 'read'),
        ('perm_config_write', 'config.write', '修改系统配置', 'res_config_write', 'write'),
        -- 对话权限
        ('perm_chat', 'chat', '使用Agent对话', 'res_chat', 'execute'),
        ('perm_chat_stream', 'chat.stream', '使用Agent流式对话', 'res_chat_stream', 'execute'),
        -- 记忆权限
        ('perm_memory_read', 'memory.read', '查看记忆', 'res_memory_read', 'read'),
        ('perm_memory_write', 'memory.write', '写入/删除记忆', 'res_memory_write', 'write'),
        -- 管理权限
        ('perm_users_manage', 'users.manage', '管理用户', 'res_users', 'manage'),
        ('perm_roles_manage', 'roles.manage', '管理角色和权限', 'res_roles', 'manage'),
        ('perm_dept_manage', 'departments.manage', '管理部门', 'res_departments', 'manage'),
        ('perm_plugins', 'plugins.manage', '管理插件', 'res_plugins', 'manage'),
        ('perm_tasks', 'tasks.read', '查看异步任务', 'res_tasks', 'read'),
        -- 知识库权限
        ('perm_knowledge_read', 'knowledge.read', '查看知识库', 'res_knowledge', 'read'),
        ('perm_knowledge_write', 'knowledge.write', '导入/删除文档', 'res_knowledge', 'write'),
        ('perm_knowledge_manage', 'knowledge.manage', '重建索引等管理', 'res_knowledge', 'manage'),
        -- 文件权限
        ('perm_files_read', 'files.read', '查看/下载文件', 'res_files', 'read'),
        ('perm_files_write', 'files.write', '上传/删除/移动文件', 'res_files', 'write'),
        -- 对话权限
        ('perm_conversation_read', 'conversation.read', '查看对话历史', 'res_conversation', 'read'),
        ('perm_conversation_write', 'conversation.write', '创建/删除对话', 'res_conversation', 'write'),
        -- 系统权限
        ('perm_system_manage', 'system.manage', 'WAL操作等系统管理', 'res_system', 'manage');

      -- 菜单权限（read）
      INSERT INTO permissions (id, name, description, resource_id, action) VALUES
        ('perm_menu_skills_read', 'menu:skills.read', '访问技能管理菜单', 'res_menu_skills', 'read'),
        ('perm_menu_chat_read', 'menu:chat.read', '访问对话菜单', 'res_menu_chat', 'read'),
        ('perm_menu_knowledge_read', 'menu:knowledge.read', '访问知识库菜单', 'res_menu_knowledge', 'read'),
        ('perm_menu_files_read', 'menu:files.read', '访问文件管理菜单', 'res_menu_files', 'read'),
        ('perm_menu_config_read', 'menu:config.read', '访问系统配置菜单', 'res_menu_config', 'read'),
        ('perm_menu_memory_read', 'menu:memory.read', '访问记忆系统菜单', 'res_menu_memory', 'read'),
        ('perm_menu_evolution_read', 'menu:evolution.read', '访问进化引擎菜单', 'res_menu_evolution', 'read'),
        ('perm_menu_genealogy_read', 'menu:genealogy.read', '访问族谱菜单', 'res_menu_genealogy', 'read'),
        ('perm_menu_federation_read', 'menu:federation.read', '访问联邦菜单', 'res_menu_federation', 'read'),
        ('perm_menu_graph_read', 'menu:graph.read', '访问知识图谱菜单', 'res_menu_graph', 'read'),
        ('perm_menu_admin_read', 'menu:admin.read', '访问系统管理菜单', 'res_menu_admin', 'read');

      -- 部门资源授权（根部门拥有所有资源）
      INSERT INTO department_resources (department_id, resource_id)
        SELECT 'dept_root', id FROM resources;

      -- admin角色：所有权限
      INSERT INTO role_permissions (role_id, permission_id)
        SELECT 'role_admin', id FROM permissions;

      -- user角色：基础权限
      INSERT INTO role_permissions (role_id, permission_id) VALUES
        ('role_user', 'perm_skills_read'),
        ('role_user', 'perm_skills_exec'),
        ('role_user', 'perm_chat'),
        ('role_user', 'perm_chat_stream'),
        ('role_user', 'perm_memory_read'),
        ('role_user', 'perm_memory_write'),
        ('role_user', 'perm_config_read'),
        ('role_user', 'perm_tasks'),
        ('role_user', 'perm_knowledge_read'),
        ('role_user', 'perm_knowledge_write'),
        ('role_user', 'perm_files_read'),
        ('role_user', 'perm_files_write'),
        ('role_user', 'perm_conversation_read'),
        ('role_user', 'perm_conversation_write'),
        ('role_user', 'perm_menu_skills_read'),
        ('role_user', 'perm_menu_chat_read'),
        ('role_user', 'perm_menu_knowledge_read'),
        ('role_user', 'perm_menu_files_read'),
        ('role_user', 'perm_menu_memory_read'),
        ('role_user', 'perm_menu_config_read');

      -- anonymous角色：只读权限
      INSERT INTO role_permissions (role_id, permission_id) VALUES
        ('role_viewer', 'perm_skills_read'),
        ('role_viewer', 'perm_chat'),
        ('role_viewer', 'perm_chat_stream'),
        ('role_viewer', 'perm_config_read'),
        ('role_viewer', 'perm_knowledge_read'),
        ('role_viewer', 'perm_files_read'),
        ('role_viewer', 'perm_conversation_read'),
        ('role_viewer', 'perm_menu_chat_read'),
        ('role_viewer', 'perm_menu_knowledge_read');

      -- 默认管理员用户由应用启动时的 ensureAdminExists() 创建，使用随机密码
      -- 避免在 migration 中硬编码密码
    `,
    down: `
      -- 删除所有表（按依赖顺序逆序）
      SET FOREIGN_KEY_CHECKS = 0;
      DROP TABLE IF EXISTS custom_pptx_themes;
      DROP TABLE IF EXISTS chat_messages;
      DROP TABLE IF EXISTS conversations;
      DROP TABLE IF EXISTS wal_entries;
      DROP TABLE IF EXISTS share_rules;
      DROP TABLE IF EXISTS kb_keywords;
      DROP TABLE IF EXISTS kb_versions;
      DROP TABLE IF EXISTS kb_chunks;
      DROP TABLE IF EXISTS kb_documents;
      DROP TABLE IF EXISTS kb_graph_edges;
      DROP TABLE IF EXISTS kb_graph_nodes;
      DROP TABLE IF EXISTS kb_ltm_entries;
      DROP TABLE IF EXISTS sessions;
      DROP TABLE IF EXISTS department_resources;
      DROP TABLE IF EXISTS user_roles;
      DROP TABLE IF EXISTS role_permissions;
      DROP TABLE IF EXISTS permissions;
      DROP TABLE IF EXISTS resources;
      DROP TABLE IF EXISTS roles;
      DROP TABLE IF EXISTS users;
      DROP TABLE IF EXISTS departments;
      DROP TABLE IF EXISTS schema_version;
      SET FOREIGN_KEY_CHECKS = 1;
    `
  },
  {
    version: 2,
    name: 'add_custom_skills_table',
    up: `
      -- ============================================
      -- 自定义 Skill 持久化表
      -- ============================================
      CREATE TABLE IF NOT EXISTS custom_skills (
        id VARCHAR(64) PRIMARY KEY COMMENT 'Skill ID',
        name VARCHAR(200) NOT NULL UNIQUE COMMENT 'Skill 名称',
        description TEXT COMMENT 'Skill 描述',
        version VARCHAR(20) NOT NULL DEFAULT '1.0.0' COMMENT '版本号',
        definition JSON NOT NULL COMMENT 'Skill 定义（JSON）',
        owner_id VARCHAR(64) NOT NULL COMMENT '创建者用户ID',
        is_system TINYINT NOT NULL DEFAULT 0 COMMENT '是否系统 Skill（0=否，1=是）',
        created_at BIGINT NOT NULL DEFAULT (UNIX_TIMESTAMP() * 1000) COMMENT '创建时间（毫秒）',
        updated_at BIGINT NOT NULL DEFAULT (UNIX_TIMESTAMP() * 1000) COMMENT '更新时间（毫秒）',
        INDEX idx_custom_skills_owner (owner_id) COMMENT '所有者索引',
        INDEX idx_custom_skills_name (name) COMMENT '名称索引',
        FOREIGN KEY (owner_id) REFERENCES users(id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='自定义 Skill 持久化表';
    `,
    down: `
      SET FOREIGN_KEY_CHECKS = 0;
      DROP TABLE IF EXISTS custom_skills;
      SET FOREIGN_KEY_CHECKS = 1;
    `
  },
  {
    version: 3,
    name: 'add_graph_and_ltm_tables',
    up: `
      -- Removed: kb_graph_nodes, kb_graph_edges, kb_ltm_entries are now created in v1
    `,
    down: `
      -- Removed: tables are managed by v1 migration
    `
  },
  {
    version: 4,
    name: 'add_roles_agent_config',
    up: `
      ALTER TABLE roles ADD COLUMN agent_config JSON DEFAULT NULL COMMENT 'Agent 配置 JSON';
    `,
    down: `
      ALTER TABLE roles DROP COLUMN agent_config;
    `
  },
  {
    version: 5,
    name: 'add_workflow_engine_tables',
    up: `
      CREATE TABLE IF NOT EXISTS workflow_definitions (
        id BIGINT AUTO_INCREMENT PRIMARY KEY COMMENT '流程定义ID',
        name VARCHAR(128) NOT NULL COMMENT '流程名称',
        \`key\` VARCHAR(64) NOT NULL UNIQUE COMMENT '流程标识',
        version INT NOT NULL DEFAULT 1 COMMENT '版本号',
        category VARCHAR(64) COMMENT '分类',
        definition JSON NOT NULL COMMENT '流程定义JSON',
        form_schema JSON COMMENT '表单定义JSON',
        created_by VARCHAR(64) COMMENT '创建人',
        created_at BIGINT NOT NULL DEFAULT (UNIX_TIMESTAMP() * 1000) COMMENT '创建时间',
        updated_at BIGINT NOT NULL DEFAULT (UNIX_TIMESTAMP() * 1000) COMMENT '更新时间',
        INDEX idx_workflow_def_key (\`key\`)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='工作流定义表';

      CREATE TABLE IF NOT EXISTS workflow_instances (
        id BIGINT AUTO_INCREMENT PRIMARY KEY COMMENT '流程实例ID',
        definition_id BIGINT NOT NULL COMMENT '流程定义ID',
        definition_version INT NOT NULL DEFAULT 1 COMMENT '定义版本',
        business_key VARCHAR(128) COMMENT '业务标识',
        starter VARCHAR(64) COMMENT '发起人',
        status VARCHAR(32) NOT NULL DEFAULT 'running' COMMENT '状态：running/completed/cancelled/suspended',
        current_node_id VARCHAR(64) COMMENT '当前节点ID',
        variables JSON COMMENT '流程变量',
        started_at BIGINT NOT NULL DEFAULT (UNIX_TIMESTAMP() * 1000) COMMENT '开始时间',
        completed_at BIGINT COMMENT '完成时间',
        INDEX idx_workflow_inst_status (status),
        INDEX idx_workflow_inst_starter (starter),
        INDEX idx_workflow_inst_def (definition_id),
        FOREIGN KEY (definition_id) REFERENCES workflow_definitions(id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='工作流实例表';

      CREATE TABLE IF NOT EXISTS workflow_tasks (
        id BIGINT AUTO_INCREMENT PRIMARY KEY COMMENT '任务ID',
        instance_id BIGINT COMMENT '流程实例ID',
        node_id VARCHAR(64) NOT NULL COMMENT '节点ID',
        node_name VARCHAR(128) COMMENT '节点名称',
        task_type VARCHAR(32) COMMENT '任务类型：user_task/service_task',
        assignee VARCHAR(64) COMMENT '执行人',
        candidate_users JSON COMMENT '候选人列表',
        candidate_groups JSON COMMENT '候选角色列表',
        status VARCHAR(32) NOT NULL DEFAULT 'pending' COMMENT '状态：pending/claimed/completed/cancelled',
        form_data JSON COMMENT '表单提交数据',
        comment TEXT COMMENT '审批意见',
        action VARCHAR(32) COMMENT '操作：approve/reject/transfer/delegate',
        due_date BIGINT COMMENT '截止时间',
        created_at BIGINT NOT NULL DEFAULT (UNIX_TIMESTAMP() * 1000) COMMENT '创建时间',
        claimed_at BIGINT COMMENT '认领时间',
        completed_at BIGINT COMMENT '完成时间',
        INDEX idx_workflow_task_instance (instance_id),
        INDEX idx_workflow_task_assignee (assignee),
        INDEX idx_workflow_task_status (status),
        FOREIGN KEY (instance_id) REFERENCES workflow_instances(id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='工作流任务表';

      CREATE TABLE IF NOT EXISTS workflow_variables (
        id BIGINT AUTO_INCREMENT PRIMARY KEY COMMENT '变量ID',
        instance_id BIGINT NOT NULL COMMENT '流程实例ID',
        name VARCHAR(128) NOT NULL COMMENT '变量名',
        value TEXT COMMENT '变量值',
        type VARCHAR(32) COMMENT '变量类型：string/number/boolean/json/date',
        INDEX idx_workflow_var_instance (instance_id),
        UNIQUE KEY idx_workflow_var_name (instance_id, name),
        FOREIGN KEY (instance_id) REFERENCES workflow_instances(id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='工作流变量表';

      CREATE TABLE IF NOT EXISTS connections (
        id BIGINT AUTO_INCREMENT PRIMARY KEY COMMENT '连接ID',
        name VARCHAR(128) NOT NULL COMMENT '连接名称',
        type VARCHAR(64) NOT NULL COMMENT '连接类型：smtp/ldap/calendar/im/kafka/...',
        config JSON NOT NULL COMMENT '连接配置JSON',
        credentials TEXT COMMENT '加密凭证',
        is_active TINYINT NOT NULL DEFAULT 1 COMMENT '是否启用',
        created_by VARCHAR(64) COMMENT '创建人',
        created_at BIGINT NOT NULL DEFAULT (UNIX_TIMESTAMP() * 1000) COMMENT '创建时间',
        updated_at BIGINT NOT NULL DEFAULT (UNIX_TIMESTAMP() * 1000) COMMENT '更新时间',
        INDEX idx_connections_type (type),
        INDEX idx_connections_name (name)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='连接配置中心';

      -- 添加权限资源
      INSERT IGNORE INTO resources (id, name, type, description) VALUES
        ('res_workflow', 'workflow', 'api', '工作流管理'),
        ('res_connection', 'connection', 'api', '连接配置管理');

      INSERT IGNORE INTO permissions (id, name, description, resource_id, action) VALUES
        ('perm_workflow_read', 'workflow.read', '查看工作流', 'res_workflow', 'read'),
        ('perm_workflow_write', 'workflow.write', '创建工作流', 'res_workflow', 'write'),
        ('perm_workflow_manage', 'workflow.manage', '管理工作流', 'res_workflow', 'manage'),
        ('perm_connection_read', 'connection.read', '查看连接配置', 'res_connection', 'read'),
        ('perm_connection_write', 'connection.write', '管理连接配置', 'res_connection', 'write');

      INSERT IGNORE INTO department_resources (department_id, resource_id) VALUES
        ('dept_root', 'res_workflow'),
        ('dept_root', 'res_connection');

      INSERT IGNORE INTO role_permissions (role_id, permission_id)
        SELECT 'role_admin', id FROM permissions WHERE name IN ('workflow.read', 'workflow.write', 'workflow.manage', 'connection.read', 'connection.write');

      INSERT IGNORE INTO role_permissions (role_id, permission_id)
        SELECT 'role_user', id FROM permissions WHERE name IN ('workflow.read', 'workflow.write', 'connection.read');

      INSERT IGNORE INTO role_permissions (role_id, permission_id)
        SELECT 'role_viewer', id FROM permissions WHERE name IN ('workflow.read', 'connection.read');
    `,
    down: `
      DROP TABLE IF EXISTS workflow_variables;
      DROP TABLE IF EXISTS workflow_tasks;
      DROP TABLE IF EXISTS workflow_instances;
      DROP TABLE IF EXISTS workflow_definitions;
      DROP TABLE IF EXISTS connections;
    `
  },
  {
    version: 6,
    name: 'workflow_tasks_instance_id_nullable',
    up: `
      ALTER TABLE workflow_tasks MODIFY instance_id BIGINT NULL COMMENT '流程实例ID';
    `,
    down: `
      ALTER TABLE workflow_tasks MODIFY instance_id BIGINT NOT NULL COMMENT '流程实例ID';
    `
  },
  {
    version: 7,
    name: 'form_engine_tables',
    up: `
      CREATE TABLE IF NOT EXISTS form_definitions (
        id VARCHAR(36) PRIMARY KEY COMMENT '表单定义ID',
        \`key\` VARCHAR(64) NOT NULL UNIQUE COMMENT '表单标识',
        name VARCHAR(128) NOT NULL COMMENT '表单名称',
        description TEXT COMMENT '表单描述',
        category_id VARCHAR(36) COMMENT '分类ID',
        schema_json JSON NOT NULL COMMENT '表单Schema JSON',
        version INT DEFAULT 1 COMMENT '版本号',
        status VARCHAR(20) DEFAULT 'draft' COMMENT '状态',
        created_by VARCHAR(36) NOT NULL COMMENT '创建人',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP COMMENT '更新时间',
        published_at DATETIME COMMENT '发布时间',
        deprecated_at DATETIME COMMENT '废弃时间'
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='表单定义表';

      CREATE TABLE IF NOT EXISTS form_categories (
        id VARCHAR(36) PRIMARY KEY COMMENT '分类ID',
        name VARCHAR(64) NOT NULL COMMENT '分类名称',
        code VARCHAR(64) NOT NULL UNIQUE COMMENT '分类编码',
        parent_id VARCHAR(36) COMMENT '父分类ID',
        sort_order INT DEFAULT 0 COMMENT '排序号',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间'
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='表单分类表';

      CREATE TABLE IF NOT EXISTS form_instances (
        id VARCHAR(36) PRIMARY KEY COMMENT '表单实例ID',
        definition_id VARCHAR(36) NOT NULL COMMENT '表单定义ID',
        definition_version INT DEFAULT 1 COMMENT '定义版本',
        data_json JSON NOT NULL COMMENT '表单数据JSON',
        status VARCHAR(20) DEFAULT 'draft' COMMENT '状态',
        submitted_by VARCHAR(36) COMMENT '提交人',
        submitted_at DATETIME COMMENT '提交时间',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP COMMENT '更新时间'
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='表单实例表';

      CREATE TABLE IF NOT EXISTS workflow_form_bindings (
        id VARCHAR(36) PRIMARY KEY COMMENT '绑定ID',
        \`definition_key\` VARCHAR(64) NOT NULL COMMENT '流程定义标识',
        node_id VARCHAR(64) NOT NULL COMMENT '节点ID',
        form_id VARCHAR(36) NOT NULL COMMENT '表单ID',
        form_version INT DEFAULT -1 COMMENT '表单版本',
        is_required BOOLEAN DEFAULT true COMMENT '是否必填',
        mapping_json JSON COMMENT '字段映射JSON',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
        UNIQUE(definition_key, node_id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='表单与流程关联表';

      CREATE TABLE IF NOT EXISTS workflow_form_instances (
        id VARCHAR(36) PRIMARY KEY COMMENT '快照ID',
        instance_id BIGINT UNSIGNED NOT NULL COMMENT '流程实例ID',
        task_id BIGINT UNSIGNED COMMENT '任务ID',
        form_id VARCHAR(36) NOT NULL COMMENT '表单ID',
        form_version INT NOT NULL COMMENT '表单版本',
        schema_snapshot JSON NOT NULL COMMENT 'Schema快照',
        data_json JSON NOT NULL COMMENT '表单数据',
        submitted_by VARCHAR(36) COMMENT '提交人',
        submitted_at DATETIME COMMENT '提交时间',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间'
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT '流程表单实例快照表';

      ALTER TABLE connections ADD COLUMN db_config JSON COMMENT '数据库配置JSON';
      ALTER TABLE connections ADD COLUMN test_query VARCHAR(256) COMMENT '测试查询语句';
    `,
    down: `
      DROP TABLE IF EXISTS workflow_form_instances;
      DROP TABLE IF EXISTS workflow_form_bindings;
      DROP TABLE IF EXISTS form_instances;
      DROP TABLE IF EXISTS form_categories;
      DROP TABLE IF EXISTS form_definitions;
      ALTER TABLE connections DROP COLUMN db_config;
      ALTER TABLE connections DROP COLUMN test_query;
    `
  },
  {
    version: 8,
    name: 'chat_messages_role_user_confirm',
    up: `
      ALTER TABLE chat_messages MODIFY COLUMN role ENUM('user', 'assistant', 'tool', 'system', 'thinking', 'strategy', 'user_confirm') NOT NULL COMMENT '角色：user-用户, assistant-助手, tool-工具, system-系统, thinking-思考, strategy-策略, user_confirm-用户确认卡片';
    `,
    down: `
      ALTER TABLE chat_messages MODIFY COLUMN role ENUM('user', 'assistant', 'tool', 'system', 'thinking', 'strategy') NOT NULL COMMENT '角色：user-用户, assistant-助手, tool-工具, system-系统, thinking-思考, strategy-策略';
    `
  },
  {
    version: 9,
    name: 'add_graph_node_community_id',
    up: `
      ALTER TABLE kb_graph_nodes ADD COLUMN community_id INT DEFAULT NULL COMMENT '社区ID（由Louvain算法分配）' AFTER properties;
      ALTER TABLE kb_graph_nodes ADD INDEX idx_kb_graph_nodes_community (owner_id, community_id) COMMENT '社区索引';
    `,
    down: `
      ALTER TABLE kb_graph_nodes DROP INDEX idx_kb_graph_nodes_community;
      ALTER TABLE kb_graph_nodes DROP COLUMN community_id;
    `
  },
  {
    version: 10,
    name: 'add_conversation_history_table',
    up: `
      CREATE TABLE IF NOT EXISTS conversation_history (
        id BIGINT AUTO_INCREMENT PRIMARY KEY COMMENT '记录ID',
        user_id VARCHAR(64) NOT NULL COMMENT '用户ID',
        conversation_id VARCHAR(64) NOT NULL COMMENT '会话ID',
        role ENUM('user', 'assistant', 'tool', 'system') NOT NULL COMMENT '角色',
        content LONGTEXT COMMENT '内容',
        tool_calls TEXT COMMENT '工具调用JSON',
        created_at BIGINT NOT NULL COMMENT '创建时间（毫秒）',
        INDEX idx_conversation_history_user (user_id, conversation_id, created_at) COMMENT '用户会话索引'
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='对话历史表';
    `,
    down: `
      DROP TABLE IF EXISTS conversation_history;
    `
  },
  {
    version: 11,
    name: 'add_sign_group_to_workflow_tasks',
    up: `
      ALTER TABLE workflow_tasks ADD COLUMN sign_group VARCHAR(64) DEFAULT NULL COMMENT '会签组' AFTER due_date;
    `,
    down: `
      ALTER TABLE workflow_tasks DROP COLUMN sign_group;
    `
  },
  {
    version: 12,
    name: 'add_app_designs_table',
    up: `
      CREATE TABLE IF NOT EXISTS app_designs (
        id VARCHAR(64) PRIMARY KEY COMMENT '设计ID',
        name VARCHAR(200) NOT NULL COMMENT '应用名称',
        description TEXT COMMENT '应用描述',
        version INT DEFAULT 1 COMMENT '版本号',
        requirement TEXT NOT NULL COMMENT '需求描述',
        design_json LONGTEXT NOT NULL COMMENT '设计JSON',
        components LONGTEXT COMMENT '组件列表JSON',
        status ENUM('draft', 'applied', 'archived') DEFAULT 'draft' COMMENT '状态：draft-草稿, applied-已应用, archived-已归档',
        owner_id VARCHAR(64) NOT NULL COMMENT '所有者ID',
        created_at BIGINT NOT NULL DEFAULT (UNIX_TIMESTAMP() * 1000) COMMENT '创建时间（毫秒）',
        updated_at BIGINT NOT NULL DEFAULT (UNIX_TIMESTAMP() * 1000) COMMENT '更新时间（毫秒）',
        INDEX idx_app_designs_owner (owner_id) COMMENT '所有者索引',
        INDEX idx_app_designs_status (status) COMMENT '状态索引'
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='应用设计方案表';
    `,
    down: `
      DROP TABLE IF EXISTS app_designs;
    `
  },
  {
    version: 13,
    name: 'allow_null_instance_id_in_workflow_tasks',
    up: `
      SET FOREIGN_KEY_CHECKS = 0;
      ALTER TABLE workflow_tasks MODIFY COLUMN instance_id BIGINT COMMENT '流程实例ID';
      SET FOREIGN_KEY_CHECKS = 1;
    `,
    down: `
      SET FOREIGN_KEY_CHECKS = 0;
      ALTER TABLE workflow_tasks MODIFY COLUMN instance_id BIGINT NOT NULL COMMENT '流程实例ID';
      SET FOREIGN_KEY_CHECKS = 1;
    `
  },
  {
    version: 14,
    name: 'add_kb_collections',
    up: `
      -- 1. 创建知识库集合表
      CREATE TABLE IF NOT EXISTS kb_collections (
        id VARCHAR(64) PRIMARY KEY COMMENT '集合ID',
        name VARCHAR(200) NOT NULL COMMENT '集合名称',
        description VARCHAR(500) DEFAULT '' COMMENT '集合描述',
        owner_id VARCHAR(64) NOT NULL COMMENT '所有者ID',
        created_at BIGINT NOT NULL COMMENT '创建时间',
        updated_at BIGINT COMMENT '更新时间',
        INDEX idx_kb_collections_owner (owner_id) COMMENT '所有者索引',
        UNIQUE KEY uk_kb_collections_name_owner (name, owner_id) COMMENT '用户内集合名唯一'
      ) COMMENT='知识库集合';

      -- 2. 给 kb_documents 添加 collection_id 列
      ALTER TABLE kb_documents
        ADD COLUMN collection_id VARCHAR(64) DEFAULT NULL COMMENT '所属知识库集合ID' AFTER owner_id,
        ADD INDEX idx_kb_documents_collection (collection_id) COMMENT '集合索引',
        ADD FOREIGN KEY (collection_id) REFERENCES kb_collections(id) ON DELETE SET NULL;

      -- 3. 为每个现有 owner 创建默认知识库
      INSERT INTO kb_collections (id, name, description, owner_id, created_at)
      SELECT DISTINCT CONCAT('kb_default_', owner_id), '默认知识库', '系统自动创建的默认知识库', owner_id, UNIX_TIMESTAMP() * 1000
      FROM kb_documents;

      -- 4. 将现有文档关联到默认知识库
      UPDATE kb_documents d
      JOIN kb_collections c ON c.owner_id = d.owner_id AND c.name = '默认知识库'
      SET d.collection_id = c.id;
    `,
    down: `
      ALTER TABLE kb_documents DROP FOREIGN KEY fk_kb_documents_collection;
      ALTER TABLE kb_documents DROP COLUMN collection_id;
      DROP TABLE IF EXISTS kb_collections;
    `
  },
  {
    version: 15,
    name: 'add_pending_confirms',
    up: `
      CREATE TABLE IF NOT EXISTS pending_confirms (
        confirm_id VARCHAR(32) PRIMARY KEY COMMENT '确认ID',
        conversation_id VARCHAR(64) NOT NULL COMMENT '对话ID',
        user_id VARCHAR(64) NOT NULL COMMENT '用户ID',
        confirm_data JSON NOT NULL COMMENT '确认数据（表单定义等）',
        response_data JSON DEFAULT NULL COMMENT '用户响应数据',
        status VARCHAR(20) NOT NULL DEFAULT 'pending' COMMENT '状态: pending/resolved/expired',
        created_at BIGINT NOT NULL DEFAULT (UNIX_TIMESTAMP() * 1000) COMMENT '创建时间（毫秒）',
        resolved_at BIGINT DEFAULT NULL COMMENT '解决时间（毫秒）',
        INDEX idx_pending_confirms_conv (conversation_id) COMMENT '对话索引',
        INDEX idx_pending_confirms_user (user_id) COMMENT '用户索引',
        INDEX idx_pending_confirms_status (status) COMMENT '状态索引'
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='待处理的用户确认';
    `,
    down: `
      DROP TABLE IF EXISTS pending_confirms;
    `
  },
  {
    version: 16,
    name: 'add_evolution_tables',
    up: `
      CREATE TABLE IF NOT EXISTS evolution_generations (
        id VARCHAR(36) PRIMARY KEY COMMENT '生成记录ID',
        skill_name VARCHAR(200) NOT NULL COMMENT 'Skill名称',
        generated_by VARCHAR(200) NOT NULL COMMENT '生成者',
        depth INT NOT NULL COMMENT '生成深度',
        created_at BIGINT NOT NULL COMMENT '创建时间（毫秒）',
        approved TINYINT NOT NULL DEFAULT 0 COMMENT '是否已审批',
        data TEXT COMMENT '扩展数据JSON',
        INDEX idx_ev_gen_skill (skill_name) COMMENT 'Skill索引',
        INDEX idx_ev_gen_created (created_at) COMMENT '时间索引'
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='Skill生成历史';

      CREATE TABLE IF NOT EXISTS evolution_violations (
        id VARCHAR(36) PRIMARY KEY COMMENT '违规记录ID',
        constraint_id VARCHAR(200) NOT NULL COMMENT '约束ID',
        description TEXT NOT NULL COMMENT '违规描述',
        blocking TINYINT NOT NULL DEFAULT 1 COMMENT '是否阻断',
        skill_name VARCHAR(200) NOT NULL COMMENT 'Skill名称',
        detected_at BIGINT NOT NULL COMMENT '检测时间（毫秒）',
        INDEX idx_ev_viol_constraint (constraint_id) COMMENT '约束索引',
        INDEX idx_ev_viol_detected (detected_at) COMMENT '时间索引'
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='Red Line违规记录';

      CREATE TABLE IF NOT EXISTS evolution_approvals (
        id VARCHAR(36) PRIMARY KEY COMMENT '审批记录ID',
        name VARCHAR(200) NOT NULL COMMENT 'Skill名称',
        description TEXT NOT NULL COMMENT '描述',
        code LONGTEXT COMMENT '代码',
        capabilities TEXT COMMENT '能力列表JSON',
        generated_by VARCHAR(200) NOT NULL COMMENT '生成者',
        depth INT NOT NULL COMMENT '生成深度',
        created_at BIGINT NOT NULL COMMENT '创建时间（毫秒）',
        status VARCHAR(20) NOT NULL DEFAULT 'pending' COMMENT '状态: pending/approved/rejected',
        status_updated_at BIGINT COMMENT '状态更新时间（毫秒）',
        INDEX idx_ev_app_status (status) COMMENT '状态索引',
        INDEX idx_ev_app_created (created_at) COMMENT '时间索引'
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='Skill审批记录';
    `,
    down: `
      DROP TABLE IF EXISTS evolution_approvals;
      DROP TABLE IF EXISTS evolution_violations;
      DROP TABLE IF EXISTS evolution_generations;
    `
  },
  {
    version: 17,
    name: 'add_pending_confirms_expires_and_missing_indexes',
    up: `
      ALTER TABLE pending_confirms ADD COLUMN expires_at BIGINT DEFAULT NULL COMMENT '过期时间（毫秒）';
      CREATE INDEX idx_pending_confirms_expires ON pending_confirms(expires_at);
      CREATE INDEX idx_workflow_tasks_instance ON workflow_tasks(instance_id);
      CREATE INDEX idx_workflow_tasks_node ON workflow_tasks(instance_id, node_id, status);
      CREATE INDEX idx_form_instances_def ON form_instances(definition_id);
    `,
    down: `
      ALTER TABLE pending_confirms DROP COLUMN expires_at;
      DROP INDEX idx_pending_confirms_expires ON pending_confirms;
      DROP INDEX idx_workflow_tasks_instance ON workflow_tasks;
      DROP INDEX idx_workflow_tasks_node ON workflow_tasks;
      DROP INDEX idx_form_instances_def ON form_instances;
    `
  }
];

/**
 * Get current schema version from database
 */
async function getCurrentVersion(): Promise<number> {
  const adapter = getMySQLAdapter();
  try {
    const rows = await adapter.query<{ version: number }>(
      'SELECT MAX(version) as version FROM schema_version'
    );
    return rows[0]?.version ?? 0;
  } catch (error) {
    // Table doesn't exist yet
    return 0;
  }
}

/**
 * Get migration status
 */
export async function getMigrationStatus(): Promise<{ currentVersion: number; latestVersion: number; pendingMigrations: string[] }> {
  const currentVersion = await getCurrentVersion();
  const pending = MIGRATIONS.filter(m => m.version > currentVersion).map(m => m.name);
  return {
    currentVersion,
    latestVersion: MIGRATIONS.length,
    pendingMigrations: pending,
  };
}

/**
 * Check if database is initialized
 */
export async function isDatabaseInitialized(): Promise<boolean> {
  return (await getCurrentVersion()) > 0;
}

/**
 * Migrate to a specific version
 */
export async function migrateToVersion(targetVersion: number): Promise<void> {
  const currentVersion = await getCurrentVersion();
  const adapter = getMySQLAdapter();

  if (targetVersion < currentVersion) {
    // Rollback
    for (const migration of [...MIGRATIONS].reverse()) {
      if (migration.version <= currentVersion && migration.version > targetVersion) {
        const statements = parseSQLStatements(migration.down);
        for (const statement of statements) {
          try {
            await adapter.execute(statement);
          } catch {
            // Ignore rollback errors
          }
        }
        try {
          await adapter.execute('DELETE FROM schema_version WHERE version = ?', [migration.version]);
        } catch {
          // Table may have been dropped by the down migration
        }
      }
    }
  } else if (targetVersion > currentVersion) {
    // Forward
    for (const migration of MIGRATIONS) {
      if (migration.version > currentVersion && migration.version <= targetVersion) {
        try {
          // Execute migration inside a transaction for atomic rollback on DML
          await adapter.transaction(async (connection) => {
            const statements = parseSQLStatements(migration.up);
            for (const statement of statements) {
              try {
                await connection.execute(statement);
              } catch (error) {
                const err = error as { errno?: number; code?: string };
                if ([1826, 1050, 1061, 1062, 1060].includes(err.errno ?? 0)) continue;
                throw error;
              }
            }
          });

          // Only record version after all statements succeed
          await adapter.execute(
            'INSERT INTO schema_version (version, name) VALUES (?, ?) ON DUPLICATE KEY UPDATE name = VALUES(name), applied_at = CURRENT_TIMESTAMP',
            [migration.version, migration.name]
          );
        } catch (error) {
          log('error', 'mysql_database_migration_failed', {
            version: migration.version,
            name: migration.name,
            error: error instanceof Error ? (error as Error).message : String(error),
          });
          // HALT - do not continue to next version
          throw error;
        }
      }
    }
  }
}

/**
 * Initialize MySQL database by running all pending migrations
 */
export async function initMySQLDatabase(): Promise<void> {
  const adapter = getMySQLAdapter();

  // P0 安全修复：分布式锁防止多实例并发执行迁移
  const lockName = 'raos_migration_lock';
  const lockTimeoutSec = 60;
  const lockResult = await adapter.query<{ get_lock: number }>(`SELECT GET_LOCK(?, ?) as get_lock`, [lockName, lockTimeoutSec]);
  if (!lockResult[0]?.get_lock) {
    throw new Error('Failed to acquire migration lock. Another instance may be running migrations.');
  }

  try {
    const currentVersion = await getCurrentVersion();
    
    log('info', 'mysql_database_init_start', { currentVersion, targetVersion: MIGRATIONS.length });

    // Run pending migrations
    for (const migration of MIGRATIONS) {
    if (migration.version > currentVersion) {
      try {
        log('info', 'mysql_database_migration_start', { 
          version: migration.version, 
          name: migration.name 
        });

        // Execute migration inside a transaction for atomic rollback on DML.
        // Note: MySQL DDL statements cause implicit commits, so DDL cannot be
        // rolled back, but DML within the migration is protected.
        await adapter.transaction(async (connection) => {
          const statements = parseSQLStatements(migration.up);
          for (const statement of statements) {
            try {
              await connection.execute(statement);
            } catch (error) {
              // Ignore duplicate errors
              const err = error as { errno?: number; code?: string };
              if (err.errno === 1826 || err.code === 'ER_FK_DUP_NAME') {
                log('debug', 'mysql_migration_fk_exists_skipped', { statement: statement.substring(0, 100) });
                continue;
              }
              if (err.errno === 1050 || err.code === 'ER_TABLE_EXISTS_ERROR') {
                log('debug', 'mysql_migration_table_exists_skipped', { statement: statement.substring(0, 100) });
                continue;
              }
              if (err.errno === 1061 || err.code === 'ER_DUP_KEYNAME') {
                log('debug', 'mysql_migration_index_exists_skipped', { statement: statement.substring(0, 100) });
                continue;
              }
              if (err.errno === 1062 || err.code === 'ER_DUP_ENTRY') {
                log('debug', 'mysql_migration_dup_entry_skipped', { statement: statement.substring(0, 100) });
                continue;
              }
              if (err.errno === 1060 || err.code === 'ER_DUP_FIELDNAME') {
                log('debug', 'mysql_migration_column_exists_skipped', { statement: statement.substring(0, 100) });
                continue;
              }
              // Log the actual error for debugging
              log('error', 'mysql_migration_statement_failed', { 
                statement: statement.substring(0, 200),
                error: err.code || String(error)
              });
              throw error;
            }
          }
        });

        // Record version ONLY after all statements succeed
        await adapter.execute(
          'INSERT INTO schema_version (version, name) VALUES (?, ?) ON DUPLICATE KEY UPDATE name = VALUES(name), applied_at = CURRENT_TIMESTAMP',
          [migration.version, migration.name]
        );

        log('info', 'mysql_database_migration_complete', { 
          version: migration.version, 
          name: migration.name 
        });
      } catch (error) {
        log('error', 'mysql_database_migration_failed', { 
          version: migration.version, 
          name: migration.name,
          error: error instanceof Error ? (error as Error).message : String(error)
        });
        // HALT - do not continue to next version
        throw error;
      }
    }
  }

    log('info', 'mysql_database_init_complete', { version: MIGRATIONS.length });
  } finally {
    await adapter.query(`SELECT RELEASE_LOCK(?)`, [lockName]);
  }
}

/**
 * Parse SQL migration script into individual statements
 * Handles multi-line statements, comments, and string literals
 */
function parseSQLStatements(sql: string): string[] {
  const statements: string[] = [];
  let current = '';
  let inString = false;
  let stringChar = '';
  let inComment = false;
  
  const lines = sql.split('\n');
  
  for (const line of lines) {
    const trimmed = line.trim();
    
    // Skip empty lines and single-line comments
    if (!trimmed || trimmed.startsWith('--')) {
      continue;
    }
    
    // Process character by character
    for (let i = 0; i < line.length; i++) {
      const char = line[i];
      const nextChar = line[i + 1] || '';
      
      // Handle string literals
      if (!inComment && !inString && (char === "'" || char === '"' || char === '`')) {
        inString = true;
        stringChar = char;
        current += char;
        continue;
      }
      
      if (inString && char === stringChar) {
        // Check for escaped quotes
        if (line[i - 1] !== '\\') {
          inString = false;
          stringChar = '';
        }
        current += char;
        continue;
      }
      
      // Handle multi-line comments
      if (!inString && char === '/' && nextChar === '*') {
        inComment = true;
        i++; // Skip next char
        continue;
      }
      
      if (inComment && char === '*' && nextChar === '/') {
        inComment = false;
        i++; // Skip next char
        continue;
      }
      
      if (inComment) {
        continue;
      }
      
      // Handle statement termination
      if (!inString && char === ';') {
        current = current.trim();
        if (current) {
          statements.push(current + ';');
        }
        current = '';
        continue;
      }
      
      current += char;
    }
    
    // Add newline if we're in the middle of a statement
    if (current.trim()) {
      current += '\n';
    }
  }
  
  // Handle last statement without semicolon
  current = current.trim();
  if (current) {
    statements.push(current + ';');
  }
  
  return statements.filter(s => s.length > 1);
}

/**
 * Reset MySQL database by running down migrations and re-initializing
 * WARNING: This will delete all data!
 */
export async function resetMySQLDatabase(): Promise<void> {
  const adapter = getMySQLAdapter();
  const currentVersion = await getCurrentVersion();
  
  log('warn', 'mysql_database_reset_start', { currentVersion });

  // Run down migrations in reverse order
  for (const migration of [...MIGRATIONS].reverse()) {
    if (migration.version <= currentVersion) {
      try {
        log('info', 'mysql_database_rollback_start', { 
          version: migration.version, 
          name: migration.name 
        });

        const statements = parseSQLStatements(migration.down);

        for (const statement of statements) {
          try {
            await adapter.execute(`${statement};`);
          } catch (error) {
            // Ignore errors during rollback
            log('debug', 'mysql_rollback_statement_skipped', { 
              statement: statement.substring(0, 100),
              error: String(error)
            });
          }
        }

        log('info', 'mysql_database_rollback_complete', { 
          version: migration.version, 
          name: migration.name 
        });
      } catch (error) {
        log('error', 'mysql_database_rollback_failed', { 
          version: migration.version, 
          name: migration.name,
          error: error instanceof Error ? (error as Error).message : String(error)
        });
      }
    }
  }

  log('info', 'mysql_database_reset_complete');
}
