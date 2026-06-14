/**
 * 数据库初始化与 Schema 管理
 * 支持 SQLite (better-sqlite3) 和 MySQL 切换
 *
 * 完整 schema：departments → users → roles → user_roles → resources → permissions → role_permissions → department_resources → sessions
 */
import Database from "better-sqlite3";
import { join } from "path";
import { mkdirSync } from "fs";
import { dbConfig } from "../config/db-config.js";

let db: Database.Database | null = null;

/** 数据库类型 */
export type DatabaseType = 'sqlite' | 'mysql';

/** 获取当前数据库类型 */
export function getDatabaseType(): DatabaseType {
  return process.env.USE_MYSQL === 'true' ? 'mysql' : 'sqlite';
}

/** 检查是否使用 MySQL */
export function isMySQL(): boolean {
  return getDatabaseType() === 'mysql';
}

/** 检查是否使用 SQLite */
export function isSQLite(): boolean {
  return getDatabaseType() === 'sqlite';
}

/** 获取数据库实例（单例）- SQLite 模式 */
export function getDb(): Database.Database {
  if (isMySQL()) {
    throw new Error("MySQL mode is active. Use getMySQLAdapter() from mysql-adapter.js instead.");
  }
  if (!db) throw new Error("Database not initialized. Call initDatabase() first.");
  return db;
}

/** 初始化数据库 */
export function initDatabase(dbPath?: string): Database.Database {
  if (isMySQL()) {
    throw new Error("MySQL mode is active. Use initDatabaseAsync() instead.");
  }
  if (db) return db;

  const finalPath = dbPath ?? join(process.cwd(), ".raos", "raos.db");
  mkdirSync(join(finalPath, ".."), { recursive: true });

  db = new Database(finalPath);

  // 性能优化（P2 修复：配置化 pragma）
  const sqliteCfg = dbConfig.sqlite;
  db.pragma(`journal_mode = ${sqliteCfg.journalMode}`);
  db.pragma(`synchronous = ${sqliteCfg.synchronous}`);
  db.pragma(`cache_size = ${sqliteCfg.cacheSize}`);
  db.pragma(`busy_timeout = ${sqliteCfg.busyTimeout}`);
  db.pragma("foreign_keys = ON");

  runMigrations(db);

  return db;
}

/** 异步初始化数据库（支持 MySQL） */
export async function initDatabaseAsync(dbPath?: string): Promise<void> {
  if (isMySQL()) {
    // MySQL 初始化 - 从 mysql-database.ts 导入
    const { initMySQLDatabase } = await import('./mysql-database.js');
    await initMySQLDatabase();
    console.log('   MySQL database initialized');
  } else {
    // SQLite 初始化
    initDatabase(dbPath);
  }
}

/** 关闭数据库 */
export function closeDatabase(): void {
  if (db) {
    db.close();
    db = null;
  }
}

/** Schema 迁移 */
function runMigrations(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_version (
      version INTEGER PRIMARY KEY
    );
  `);

  const current = db.prepare("SELECT MAX(version) as v FROM schema_version").get() as { v: number | null };
  const version = current?.v ?? 0;

  const migrations: Array<() => void> = [
    // v1: 完整 schema + seed data（用户+角色+部门 交叉控制权限体系）
    () => {
      db.exec(`
        -- ===== 部门表（树形，物化路径） =====
        CREATE TABLE departments (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          parent_id TEXT REFERENCES departments(id) ON DELETE RESTRICT,
          path TEXT NOT NULL,
          level INTEGER NOT NULL DEFAULT 0,
          description TEXT DEFAULT '',
          created_at INTEGER NOT NULL DEFAULT (unixepoch()),
          updated_at INTEGER NOT NULL DEFAULT (unixepoch())
        );
        CREATE INDEX idx_departments_parent ON departments(parent_id);
        CREATE INDEX idx_departments_path ON departments(path);

        -- ===== 用户表 =====
        CREATE TABLE users (
          id TEXT PRIMARY KEY,
          username TEXT NOT NULL UNIQUE COLLATE NOCASE,
          display_name TEXT NOT NULL DEFAULT '',
          password_hash TEXT NOT NULL,
          avatar TEXT DEFAULT '',
          department_id TEXT REFERENCES departments(id) ON DELETE SET NULL,
          status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','disabled','deleted')),
          created_at INTEGER NOT NULL DEFAULT (unixepoch()),
          updated_at INTEGER NOT NULL DEFAULT (unixepoch()),
          last_login_at INTEGER
        );
        CREATE INDEX idx_users_username ON users(username);
        CREATE INDEX idx_users_status ON users(status);
        CREATE INDEX idx_users_department ON users(department_id);

        -- ===== 角色表 =====
        CREATE TABLE roles (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL UNIQUE,
          description TEXT DEFAULT '',
          is_system INTEGER NOT NULL DEFAULT 0,
          agent_config TEXT DEFAULT NULL,
          created_at INTEGER NOT NULL DEFAULT (unixepoch())
        );

        -- ===== 用户-角色关联 =====
        CREATE TABLE user_roles (
          user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          role_id TEXT NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
          granted_at INTEGER NOT NULL DEFAULT (unixepoch()),
          PRIMARY KEY (user_id, role_id)
        );
        CREATE INDEX idx_user_roles_user ON user_roles(user_id);

        -- ===== 资源注册表 =====
        CREATE TABLE resources (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL UNIQUE,
          type TEXT NOT NULL CHECK(type IN ('api','skill','menu','data')),
          description TEXT DEFAULT '',
          created_at INTEGER NOT NULL DEFAULT (unixepoch())
        );
        CREATE INDEX idx_resources_type ON resources(type);
        CREATE INDEX idx_resources_name ON resources(name);

        -- ===== 权限表（resource_id + action） =====
        CREATE TABLE permissions (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL UNIQUE,
          description TEXT DEFAULT '',
          resource_id TEXT NOT NULL REFERENCES resources(id) ON DELETE CASCADE,
          action TEXT NOT NULL CHECK(action IN ('read','write','execute','manage','*')),
          UNIQUE(resource_id, action)
        );

        -- ===== 角色-权限关联 =====
        CREATE TABLE role_permissions (
          role_id TEXT NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
          permission_id TEXT NOT NULL REFERENCES permissions(id) ON DELETE CASCADE,
          PRIMARY KEY (role_id, permission_id)
        );
        CREATE INDEX idx_role_permissions_role ON role_permissions(role_id);

        -- ===== 部门-资源关联（部门可访问的资源范围） =====
        CREATE TABLE department_resources (
          department_id TEXT NOT NULL REFERENCES departments(id) ON DELETE CASCADE,
          resource_id TEXT NOT NULL REFERENCES resources(id) ON DELETE CASCADE,
          granted_at INTEGER NOT NULL DEFAULT (unixepoch()),
          PRIMARY KEY (department_id, resource_id)
        );
        CREATE INDEX idx_dept_resources_dept ON department_resources(department_id);
        CREATE INDEX idx_dept_resources_resource ON department_resources(resource_id);

        -- ===== 会话 token 表 =====
        CREATE TABLE sessions (
          token TEXT PRIMARY KEY,
          user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          created_at INTEGER NOT NULL DEFAULT (unixepoch()),
          expires_at INTEGER NOT NULL
        );
        CREATE INDEX idx_sessions_user ON sessions(user_id);
        CREATE INDEX idx_sessions_expires ON sessions(expires_at);
      `);

      // ===== Seed Data =====

      // 根部门
      db.exec(`
        INSERT INTO departments (id, name, parent_id, path, level, description) VALUES
          ('dept_root', '全体', NULL, '/全体', 0, '根部门，所有用户的默认归属');
      `);

      // 系统角色
      db.exec(`
        INSERT INTO roles (id, name, description, is_system) VALUES
          ('role_admin', 'admin', '系统管理员，拥有所有权限，跳过部门检查', 1),
          ('role_user', 'user', '普通用户，基础操作权限', 1),
          ('role_viewer', 'viewer', '只读用户，仅可查看', 1);
      `);

      // API 资源（14 个）
      db.exec(`
        INSERT INTO resources (id, name, type, description) VALUES
          ('res_skills',       'skills',       'api', 'Skill 列表与详情'),
          ('res_skills_exec',  'skills.exec',  'api', 'Skill 执行'),
          ('res_skills_mgmt',  'skills.manage','api', 'Skill 管理（增删）'),
          ('res_config',       'config',       'api', '系统配置查看'),
          ('res_config_write', 'config.write', 'api', '系统配置修改'),
          ('res_chat',         'chat',         'api', 'Agent 对话'),
          ('res_chat_stream',  'chat.stream',  'api', 'Agent 流式对话'),
          ('res_memory_read',  'memory.read',  'api', '记忆读取'),
          ('res_memory_write', 'memory.write', 'api', '记忆写入'),
          ('res_users',        'users',        'api', '用户管理'),
          ('res_roles',        'roles',        'api', '角色管理'),
          ('res_departments',  'departments',  'api', '部门管理'),
          ('res_plugins',      'plugins',      'api', '插件管理'),
          ('res_tasks',        'tasks',        'api', '异步任务管理');
      `);

      // 权限（资源+操作组合，14 个）
      db.exec(`
        INSERT INTO permissions (id, name, description, resource_id, action) VALUES
          ('perm_skills_read',   'skills.read',     '查看 Skill 列表',     'res_skills',       'read'),
          ('perm_skills_exec',   'skills.execute',  '执行 Skill',          'res_skills_exec',  'execute'),
          ('perm_skills_manage', 'skills.manage',   '管理 Skill（增删）',  'res_skills_mgmt',  'manage'),
          ('perm_config_read',   'config.read',     '查看系统配置',        'res_config',       'read'),
          ('perm_config_write',  'config.write',    '修改系统配置',        'res_config_write', 'write'),
          ('perm_chat',          'chat',            '使用 Agent 对话',     'res_chat',         'execute'),
          ('perm_chat_stream',   'chat.stream',     '使用 Agent 流式对话', 'res_chat_stream',  'execute'),
          ('perm_memory_read',   'memory.read',     '查看记忆',            'res_memory_read',  'read'),
          ('perm_memory_write',  'memory.write',    '写入/删除记忆',       'res_memory_write', 'write'),
          ('perm_users_manage',  'users.manage',    '管理用户',            'res_users',        'manage'),
          ('perm_roles_manage',  'roles.manage',    '管理角色和权限',      'res_roles',        'manage'),
          ('perm_dept_manage',   'departments.manage','管理部门',           'res_departments',  'manage'),
          ('perm_plugins',       'plugins.manage',  '管理插件',            'res_plugins',      'manage'),
          ('perm_tasks',         'tasks.read',      '查看异步任务',        'res_tasks',        'read');
      `);

      // admin: 所有权限
      db.exec(`
        INSERT INTO role_permissions (role_id, permission_id)
          SELECT 'role_admin', id FROM permissions;
      `);

      // user: 对话 + 执行 + 记忆读写 + 查看技能 + 查看配置 + 查看任务
      db.exec(`
        INSERT INTO role_permissions (role_id, permission_id) VALUES
          ('role_user', 'perm_skills_read'),
          ('role_user', 'perm_skills_exec'),
          ('role_user', 'perm_chat'),
          ('role_user', 'perm_chat_stream'),
          ('role_user', 'perm_memory_read'),
          ('role_user', 'perm_memory_write'),
          ('role_user', 'perm_config_read'),
          ('role_user', 'perm_tasks');
      `);

      // viewer: 只读
      db.exec(`
        INSERT INTO role_permissions (role_id, permission_id) VALUES
          ('role_viewer', 'perm_skills_read'),
          ('role_viewer', 'perm_memory_read'),
          ('role_viewer', 'perm_config_read'),
          ('role_viewer', 'perm_tasks');
      `);

      // 根部门拥有所有资源
      db.exec(`
        INSERT INTO department_resources (department_id, resource_id)
          SELECT 'dept_root', id FROM resources;
      `);
    },
    // v2: 聊天会话与消息持久化
    () => {
      db.exec(`
        CREATE TABLE conversations (
          id TEXT PRIMARY KEY,
          user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          title TEXT NOT NULL DEFAULT '',
          created_at INTEGER NOT NULL DEFAULT (unixepoch()),
          updated_at INTEGER NOT NULL DEFAULT (unixepoch())
        );
        CREATE INDEX idx_conversations_user ON conversations(user_id);
        CREATE INDEX idx_conversations_updated ON conversations(updated_at DESC);

        CREATE TABLE chat_messages (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
          role TEXT NOT NULL CHECK(role IN ('user','assistant','tool','system','thinking','strategy')),
          content TEXT NOT NULL DEFAULT '',
          skill_name TEXT,
          status TEXT,
          is_error INTEGER NOT NULL DEFAULT 0,
          created_at INTEGER NOT NULL DEFAULT (unixepoch())
        );
        CREATE INDEX idx_chat_messages_conv ON chat_messages(conversation_id);
        CREATE INDEX idx_chat_messages_conv_created ON chat_messages(conversation_id, created_at DESC);
      `);
    },
    // v3: chat_messages 增加 extra JSON 列（存储 chartOptions 等扩展数据）
    () => {
      db.exec(`ALTER TABLE chat_messages ADD COLUMN extra TEXT DEFAULT NULL`);
    },
    // v4: 自定义 PPTX 主题表（风格学习功能）
    () => {
      db.exec(`
        CREATE TABLE custom_pptx_themes (
          id TEXT PRIMARY KEY,
          user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          name TEXT NOT NULL,
          colors_json TEXT NOT NULL,
          fonts_json TEXT NOT NULL,
          source_file TEXT DEFAULT '',
          created_at INTEGER NOT NULL DEFAULT (unixepoch())
        );
        CREATE INDEX idx_custom_themes_user ON custom_pptx_themes(user_id);
      `);
    },
    // v5: 用户表增加 phone/email 列 + 菜单资源与权限
    () => {
      // Add phone and email columns to users table
      try { db.exec(`ALTER TABLE users ADD COLUMN phone TEXT DEFAULT ''`); } catch (_) { /* column may already exist */ }
      try { db.exec(`ALTER TABLE users ADD COLUMN email TEXT DEFAULT ''`); } catch (_) { /* column may already exist */ }

      // Menu resources for all top-level navigation items
      const MENU_RESOURCES = [
        { id: "res_menu_skills", name: "menu:skills", description: "技能管理" },
        { id: "res_menu_chat", name: "menu:chat", description: "对话" },
        { id: "res_menu_knowledge", name: "menu:knowledge", description: "知识库" },
        { id: "res_menu_files", name: "menu:files", description: "文件管理" },
        { id: "res_menu_config", name: "menu:config", description: "系统配置" },
        { id: "res_menu_memory", name: "menu:memory", description: "记忆系统" },
        { id: "res_menu_evolution", name: "menu:evolution", description: "进化引擎" },
        { id: "res_menu_genealogy", name: "menu:genealogy", description: "族谱" },
        { id: "res_menu_federation", name: "menu:federation", description: "联邦" },
        { id: "res_menu_graph", name: "menu:graph", description: "知识图谱" },
        { id: "res_menu_admin", name: "menu:admin", description: "系统管理" },
      ];

      const insertResource = db.prepare(`
        INSERT OR IGNORE INTO resources (id, name, type, description) VALUES (?, ?, 'menu', ?)
      `);
      const insertPermission = db.prepare(`
        INSERT OR IGNORE INTO permissions (id, name, description, resource_id, action) VALUES (?, ?, ?, ?, 'read')
      `);
      const assignToRoot = db.prepare(`
        INSERT OR IGNORE INTO department_resources (department_id, resource_id) VALUES ('dept_root', ?)
      `);
      const assignToAdmin = db.prepare(`
        INSERT OR IGNORE INTO role_permissions (role_id, permission_id) VALUES ('role_admin', ?)
      `);
      const assignToUser = db.prepare(`
        INSERT OR IGNORE INTO role_permissions (role_id, permission_id) VALUES ('role_user', ?)
      `);
      const assignToViewer = db.prepare(`
        INSERT OR IGNORE INTO role_permissions (role_id, permission_id) VALUES ('role_viewer', ?)
      `);

      // Basic menus visible to all roles (user & viewer)
      const basicMenus = ["skills", "chat", "knowledge", "files", "config"];

      for (const res of MENU_RESOURCES) {
        insertResource.run(res.id, res.name, res.description);
        const permId = `perm_${res.name.replace(":", "_")}_read`;
        const permName = `${res.name}.read`;
        insertPermission.run(permId, permName, `访问${res.description}菜单`, res.id);
        assignToRoot.run(res.id);
        assignToAdmin.run(permId);

        const menuKey = res.name.replace("menu:", "");
        if (basicMenus.includes(menuKey)) {
          assignToUser.run(permId);
          assignToViewer.run(permId);
        }
      }
    },
    // v6: 共享规则表
    () => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS share_rules (
          id TEXT PRIMARY KEY,
          resource_type TEXT NOT NULL CHECK(resource_type IN ('skill','kb_document','file')),
          resource_id TEXT NOT NULL,
          owner_id TEXT NOT NULL,
          scope TEXT NOT NULL CHECK(scope IN ('all','role','department','user')),
          target_id TEXT,
          permission TEXT NOT NULL CHECK(permission IN ('read','execute','write')) DEFAULT 'read',
          created_at INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_share_rules_resource ON share_rules(resource_type, resource_id);
        CREATE INDEX IF NOT EXISTS idx_share_rules_owner ON share_rules(owner_id);
        CREATE INDEX IF NOT EXISTS idx_share_rules_target ON share_rules(scope, target_id);
      `);
    },
    // v7: 角色权限重构 — viewer→anonymous，重新分配 role_user 和 role_viewer(anonymous) 权限
    () => {
      // 1. 重命名 viewer → anonymous（保留 id 为 role_viewer，改名称和描述）
      db.exec(`
        UPDATE roles SET name = 'anonymous', description = '匿名用户（未登录）' WHERE id = 'role_viewer';
      `);

      // 2. 清除 role_user 和 role_viewer 的现有权限
      db.exec(`
        DELETE FROM role_permissions WHERE role_id IN ('role_user', 'role_viewer');
      `);

      // 3. 重新分配 role_user 权限
      // API 权限: chat.execute, chat.stream, memory.read, memory.write, config.read, skills.read, skills.execute, tasks.read
      db.exec(`
        INSERT OR IGNORE INTO role_permissions (role_id, permission_id)
          SELECT 'role_user', id FROM permissions WHERE name IN (
            'chat', 'chat.stream',
            'memory.read', 'memory.write',
            'config.read',
            'skills.read', 'skills.execute',
            'tasks.read'
          );
      `);

      // role_user 菜单权限: menu:chat, menu:knowledge, menu:files, menu:memory, menu:skills, menu:config (read-only)
      db.exec(`
        INSERT OR IGNORE INTO role_permissions (role_id, permission_id)
          SELECT 'role_user', id FROM permissions WHERE name IN (
            'menu:chat.read', 'menu:knowledge.read', 'menu:files.read',
            'menu:memory.read', 'menu:skills.read', 'menu:config.read'
          );
      `);

      // role_user Skill 权限（从配置文件加载）
      // 注意：这里保留硬编码列表以支持独立的 migration，但生产代码应使用 skill-permissions.ts
      const userAllowedSkills = [
        // 知识库
        'kb_search', 'kb_ingest', 'kb_list', 'kb_delete', 'kb_share',
        // 记忆
        'stm_store', 'stm_retrieve', 'stm_forget', 'ltm_store', 'ltm_search', 'ltm_delete', 'ltm_list',
        // 图表
        'chart_recommend', 'chart_generate', 'chart_multi',
        // 文档
        'doc_read', 'doc_read_csv',
        // 网络搜索
        'web_search', 'web_fetch',
        // 知识图谱
        'graph_query', 'graph_path', 'graph_communities',
        // 交互
        'user_confirm',
        // 规划
        'plan_and_execute',
      ];

      const insertUserSkill = db.prepare(`
        INSERT OR IGNORE INTO role_permissions (role_id, permission_id)
          SELECT 'role_user', id FROM permissions WHERE name = ?
      `);
      for (const skill of userAllowedSkills) {
        insertUserSkill.run(`skill:${skill}.execute`);
      }

      // 4. 重新分配 role_viewer (anonymous) 权限
      // API 权限: chat.execute, chat.stream, skills.read, config.read
      db.exec(`
        INSERT OR IGNORE INTO role_permissions (role_id, permission_id)
          SELECT 'role_viewer', id FROM permissions WHERE name IN (
            'chat', 'chat.stream',
            'skills.read', 'config.read'
          );
      `);

      // anonymous 菜单权限: menu:chat, menu:knowledge
      db.exec(`
        INSERT OR IGNORE INTO role_permissions (role_id, permission_id)
          SELECT 'role_viewer', id FROM permissions WHERE name IN (
            'menu:chat.read', 'menu:knowledge.read'
          );
      `);

      // anonymous Skill 权限（最小集）
      const anonAllowedSkills = [
        'user_confirm',
        'kb_search', 'kb_list',
        'chart_recommend', 'chart_generate',
        'web_search', 'web_fetch',
        'doc_read',
      ];

      const insertAnonSkill = db.prepare(`
        INSERT OR IGNORE INTO role_permissions (role_id, permission_id)
          SELECT 'role_viewer', id FROM permissions WHERE name = ?
      `);
      for (const skill of anonAllowedSkills) {
        insertAnonSkill.run(`skill:${skill}.execute`);
      }
    },
    // v8: 自定义 Skill 持久化表
    () => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS custom_skills (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL UNIQUE,
          description TEXT,
          version TEXT NOT NULL DEFAULT '1.0.0',
          definition TEXT NOT NULL,
          owner_id TEXT NOT NULL,
          is_system INTEGER NOT NULL DEFAULT 0,
          created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
          updated_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
          FOREIGN KEY (owner_id) REFERENCES users(id) ON DELETE CASCADE
        );
        CREATE INDEX idx_custom_skills_owner ON custom_skills(owner_id);
        CREATE INDEX idx_custom_skills_name ON custom_skills(name);
      `);
    },
    // v9: 新增权限资源类型 - knowledge, files, conversation, system
    () => {
      // 1. 新增资源
      const newResources = [
        { id: 'res_knowledge', name: 'knowledge', type: 'api', description: '知识库管理' },
        { id: 'res_files', name: 'files', type: 'api', description: '文件管理' },
        { id: 'res_conversation', name: 'conversation', type: 'api', description: '对话管理' },
        { id: 'res_system', name: 'system', type: 'api', description: '系统管理' },
      ];
      
      const insertResource = db.prepare(`
        INSERT OR IGNORE INTO resources (id, name, type, description) VALUES (?, ?, ?, ?)
      `);
      for (const res of newResources) {
        insertResource.run(res.id, res.name, res.type, res.description);
      }

      // 2. 新增权限
      const newPermissions = [
        // Knowledge
        { id: 'perm_knowledge_read', name: 'knowledge.read', resource_id: 'res_knowledge', action: 'read', desc: '查看知识库' },
        { id: 'perm_knowledge_write', name: 'knowledge.write', resource_id: 'res_knowledge', action: 'write', desc: '导入/删除文档' },
        { id: 'perm_knowledge_manage', name: 'knowledge.manage', resource_id: 'res_knowledge', action: 'manage', desc: '重建索引等管理' },
        // Files
        { id: 'perm_files_read', name: 'files.read', resource_id: 'res_files', action: 'read', desc: '查看/下载文件' },
        { id: 'perm_files_write', name: 'files.write', resource_id: 'res_files', action: 'write', desc: '上传/删除/移动文件' },
        // Conversation
        { id: 'perm_conversation_read', name: 'conversation.read', resource_id: 'res_conversation', action: 'read', desc: '查看对话历史' },
        { id: 'perm_conversation_write', name: 'conversation.write', resource_id: 'res_conversation', action: 'write', desc: '创建/删除对话' },
        // System
        { id: 'perm_system_manage', name: 'system.manage', resource_id: 'res_system', action: 'manage', desc: 'WAL操作等系统管理' },
      ];
      
      const insertPermission = db.prepare(`
        INSERT OR IGNORE INTO permissions (id, name, description, resource_id, action) VALUES (?, ?, ?, ?, ?)
      `);
      for (const perm of newPermissions) {
        insertPermission.run(perm.id, perm.name, perm.desc, perm.resource_id, perm.action);
      }

      // 3. 分配给根部门
      const assignToRoot = db.prepare(`
        INSERT OR IGNORE INTO department_resources (department_id, resource_id) VALUES ('dept_root', ?)
      `);
      for (const res of newResources) {
        assignToRoot.run(res.id);
      }

      // 4. 分配权限给角色
      // admin: 所有新权限
      db.exec(`
        INSERT OR IGNORE INTO role_permissions (role_id, permission_id)
          SELECT 'role_admin', id FROM permissions 
          WHERE name IN ('knowledge.read', 'knowledge.write', 'knowledge.manage', 'files.read', 'files.write', 
                         'conversation.read', 'conversation.write', 'system.manage');
      `);
      
      // user: knowledge + files + conversation
      db.exec(`
        INSERT OR IGNORE INTO role_permissions (role_id, permission_id)
          SELECT 'role_user', id FROM permissions 
          WHERE name IN ('knowledge.read', 'knowledge.write', 'files.read', 'files.write', 
                         'conversation.read', 'conversation.write');
      `);
      
      // anonymous: 只读
      db.exec(`
        INSERT OR IGNORE INTO role_permissions (role_id, permission_id)
          SELECT 'role_viewer', id FROM permissions 
          WHERE name IN ('knowledge.read', 'files.read', 'conversation.read');
      `);
    },
    // v2: 添加 roles.agent_config 列
    () => {
      try {
        db.exec(`ALTER TABLE roles ADD COLUMN agent_config TEXT DEFAULT NULL;`);
      } catch {
        // 列已存在则忽略
      }
    },
    // v11: Workflow Engine Lite 核心表 + Connection 配置中心
    () => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS workflow_definitions (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          name TEXT NOT NULL,
          key TEXT NOT NULL UNIQUE,
          version INTEGER NOT NULL DEFAULT 1,
          category TEXT,
          definition TEXT NOT NULL,
          form_schema TEXT,
          created_by TEXT,
          created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
          updated_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
        );
        CREATE INDEX IF NOT EXISTS idx_workflow_def_key ON workflow_definitions(key);

        CREATE TABLE IF NOT EXISTS workflow_instances (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          definition_id INTEGER NOT NULL,
          definition_version INTEGER NOT NULL DEFAULT 1,
          business_key TEXT,
          starter TEXT,
          status TEXT NOT NULL DEFAULT 'running',
          current_node_id TEXT,
          variables TEXT,
          started_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
          completed_at INTEGER,
          FOREIGN KEY (definition_id) REFERENCES workflow_definitions(id) ON DELETE CASCADE
        );
        CREATE INDEX IF NOT EXISTS idx_workflow_inst_status ON workflow_instances(status);
        CREATE INDEX IF NOT EXISTS idx_workflow_inst_starter ON workflow_instances(starter);
        CREATE INDEX IF NOT EXISTS idx_workflow_inst_def ON workflow_instances(definition_id);

        CREATE TABLE IF NOT EXISTS workflow_tasks (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          instance_id INTEGER,
          node_id TEXT NOT NULL,
          node_name TEXT,
          task_type TEXT,
          assignee TEXT,
          candidate_users TEXT,
          candidate_groups TEXT,
          status TEXT NOT NULL DEFAULT 'pending',
          form_data TEXT,
          comment TEXT,
          action TEXT,
          due_date INTEGER,
          sign_group TEXT,
          created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
          claimed_at INTEGER,
          completed_at INTEGER,
          FOREIGN KEY (instance_id) REFERENCES workflow_instances(id) ON DELETE CASCADE
        );
        CREATE INDEX IF NOT EXISTS idx_workflow_task_instance ON workflow_tasks(instance_id);
        CREATE INDEX IF NOT EXISTS idx_workflow_task_assignee ON workflow_tasks(assignee);
        CREATE INDEX IF NOT EXISTS idx_workflow_task_status ON workflow_tasks(status);

        CREATE TABLE IF NOT EXISTS workflow_variables (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          instance_id INTEGER NOT NULL,
          name TEXT NOT NULL,
          value TEXT,
          type TEXT,
          FOREIGN KEY (instance_id) REFERENCES workflow_instances(id) ON DELETE CASCADE
        );
        CREATE INDEX IF NOT EXISTS idx_workflow_var_instance ON workflow_variables(instance_id);
        CREATE UNIQUE INDEX IF NOT EXISTS idx_workflow_var_name ON workflow_variables(instance_id, name);

        CREATE TABLE IF NOT EXISTS connections (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          name TEXT NOT NULL,
          type TEXT NOT NULL,
          config TEXT NOT NULL,
          credentials TEXT,
          is_active INTEGER NOT NULL DEFAULT 1,
          created_by TEXT,
          created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
          updated_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
        );
        CREATE INDEX IF NOT EXISTS idx_connections_type ON connections(type);
        CREATE INDEX IF NOT EXISTS idx_connections_name ON connections(name);

        -- 添加权限资源
        INSERT OR IGNORE INTO resources (id, name, type, description) VALUES
          ('res_workflow', 'workflow', 'api', '工作流管理'),
          ('res_connection', 'connection', 'api', '连接配置管理');

        INSERT OR IGNORE INTO permissions (id, name, description, resource_id, action) VALUES
          ('perm_workflow_read', 'workflow.read', '查看工作流', 'res_workflow', 'read'),
          ('perm_workflow_write', 'workflow.write', '创建工作流', 'res_workflow', 'write'),
          ('perm_workflow_manage', 'workflow.manage', '管理工作流', 'res_workflow', 'manage'),
          ('perm_connection_read', 'connection.read', '查看连接配置', 'res_connection', 'read'),
          ('perm_connection_write', 'connection.write', '管理连接配置', 'res_connection', 'write');

        INSERT OR IGNORE INTO department_resources (department_id, resource_id) VALUES
          ('dept_root', 'res_workflow'),
          ('dept_root', 'res_connection');

        INSERT OR IGNORE INTO role_permissions (role_id, permission_id)
          SELECT 'role_admin', id FROM permissions WHERE name IN ('workflow.read', 'workflow.write', 'workflow.manage', 'connection.read', 'connection.write');

        INSERT OR IGNORE INTO role_permissions (role_id, permission_id)
          SELECT 'role_user', id FROM permissions WHERE name IN ('workflow.read', 'workflow.write', 'connection.read');

        INSERT OR IGNORE INTO role_permissions (role_id, permission_id)
          SELECT 'role_viewer', id FROM permissions WHERE name IN ('workflow.read', 'connection.read');
      `);
    },
    // v12: 允许 workflow_tasks 的 instance_id 为 NULL（支持独立任务）
    () => {
      db.exec(`
        PRAGMA foreign_keys = OFF;

        CREATE TABLE workflow_tasks_new (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          instance_id INTEGER,
          node_id TEXT NOT NULL,
          node_name TEXT,
          task_type TEXT,
          assignee TEXT,
          candidate_users TEXT,
          candidate_groups TEXT,
          status TEXT NOT NULL DEFAULT 'pending',
          form_data TEXT,
          comment TEXT,
          action TEXT,
          due_date INTEGER,
          sign_group TEXT,
          created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
          claimed_at INTEGER,
          completed_at INTEGER,
          FOREIGN KEY (instance_id) REFERENCES workflow_instances(id) ON DELETE CASCADE
        );

        INSERT INTO workflow_tasks_new SELECT * FROM workflow_tasks;

        DROP TABLE workflow_tasks;

        ALTER TABLE workflow_tasks_new RENAME TO workflow_tasks;

        CREATE INDEX IF NOT EXISTS idx_workflow_task_instance ON workflow_tasks(instance_id);
        CREATE INDEX IF NOT EXISTS idx_workflow_task_assignee ON workflow_tasks(assignee);
        CREATE INDEX IF NOT EXISTS idx_workflow_task_status ON workflow_tasks(status);

        PRAGMA foreign_keys = ON;
      `);
    },
    // v13: 添加 workflow_tasks.sign_group 字段（会签支持）
    () => {
      try {
        db.exec(`ALTER TABLE workflow_tasks ADD COLUMN sign_group TEXT`);
      } catch {
        // 列已存在则忽略（v12 已包含该字段时）
      }
    },
    // v14: 表单引擎表
    () => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS form_definitions (
          id TEXT PRIMARY KEY,
          key TEXT UNIQUE NOT NULL,
          name TEXT NOT NULL,
          description TEXT,
          category_id TEXT,
          schema_json TEXT NOT NULL,
          version INTEGER DEFAULT 1,
          status TEXT DEFAULT 'draft',
          created_by TEXT NOT NULL,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          published_at DATETIME,
          deprecated_at DATETIME
        );

        CREATE TABLE IF NOT EXISTS form_categories (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          code TEXT UNIQUE NOT NULL,
          parent_id TEXT,
          sort_order INTEGER DEFAULT 0,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS form_instances (
          id TEXT PRIMARY KEY,
          definition_id TEXT NOT NULL,
          definition_version INTEGER DEFAULT 1,
          data_json TEXT NOT NULL,
          status TEXT DEFAULT 'draft',
          submitted_by TEXT,
          submitted_at DATETIME,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS workflow_form_bindings (
          id TEXT PRIMARY KEY,
          definition_key TEXT NOT NULL,
          node_id TEXT NOT NULL,
          form_id TEXT NOT NULL,
          form_version INTEGER DEFAULT -1,
          is_required INTEGER DEFAULT 1,
          mapping_json TEXT,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          UNIQUE(definition_key, node_id)
        );

        CREATE TABLE IF NOT EXISTS workflow_form_instances (
          id TEXT PRIMARY KEY,
          instance_id INTEGER NOT NULL,
          task_id INTEGER,
          form_id TEXT NOT NULL,
          form_version INTEGER NOT NULL,
          schema_snapshot TEXT NOT NULL,
          data_json TEXT NOT NULL,
          submitted_by TEXT,
          submitted_at DATETIME,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );
      `);
      try { db.exec(`ALTER TABLE connections ADD COLUMN db_config TEXT`); } catch (_) { }
      try { db.exec(`ALTER TABLE connections ADD COLUMN test_query TEXT`); } catch (_) { }
    },
    // v15: chat_messages role 增加 user_confirm（修复刷新后 ConfirmCard 不渲染）
    () => {
      db.exec(`
        PRAGMA foreign_keys = OFF;

        CREATE TABLE chat_messages_new (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
          role TEXT NOT NULL CHECK(role IN ('user','assistant','tool','system','thinking','strategy','user_confirm')),
          content TEXT NOT NULL DEFAULT '',
          skill_name TEXT,
          status TEXT,
          is_error INTEGER NOT NULL DEFAULT 0,
          extra TEXT DEFAULT NULL,
          created_at INTEGER NOT NULL DEFAULT (unixepoch())
        );

        INSERT INTO chat_messages_new
          SELECT id, conversation_id, role, content, skill_name, status, is_error, extra, created_at
          FROM chat_messages;

        DROP TABLE chat_messages;

        ALTER TABLE chat_messages_new RENAME TO chat_messages;

        CREATE INDEX idx_chat_messages_conv ON chat_messages(conversation_id);
        CREATE INDEX idx_chat_messages_conv_created ON chat_messages(conversation_id, created_at DESC);

        PRAGMA foreign_keys = ON;
      `);
    },
    // v16: 补充缺失的知识库、上传、WAL、知识图谱、长期记忆、对话历史表
    () => {
      db.exec(`
        -- kb_documents
        CREATE TABLE IF NOT EXISTS kb_documents (
          doc_id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          source TEXT DEFAULT '',
          owner_id TEXT NOT NULL,
          chunk_count INTEGER DEFAULT 0,
          total_tokens INTEGER DEFAULT 0,
          ingested_at INTEGER NOT NULL,
          updated_at INTEGER,
          version INTEGER DEFAULT 1,
          tags TEXT,
          shared INTEGER DEFAULT 0,
          content_hash TEXT DEFAULT '',
          parsed_content TEXT,
          layouts_json TEXT,
          segments_json TEXT,
          doc_mind_task_id TEXT,
          parsing_status TEXT DEFAULT 'success',
          parsing_progress REAL DEFAULT 100.00,
          media_type TEXT DEFAULT 'document',
          duration_ms INTEGER,
          UNIQUE(name, owner_id),
          FOREIGN KEY (owner_id) REFERENCES users(id) ON DELETE CASCADE
        );
        CREATE INDEX idx_kb_documents_owner ON kb_documents(owner_id);
        CREATE INDEX idx_kb_documents_shared ON kb_documents(shared);
        CREATE INDEX idx_kb_documents_ingested ON kb_documents(ingested_at);

        -- kb_tags
        CREATE TABLE IF NOT EXISTS kb_tags (
          tag TEXT NOT NULL,
          doc_id TEXT NOT NULL,
          created_at INTEGER DEFAULT (unixepoch() * 1000),
          PRIMARY KEY (tag, doc_id),
          FOREIGN KEY (doc_id) REFERENCES kb_documents(doc_id) ON DELETE CASCADE
        );
        CREATE INDEX idx_kb_tags_doc ON kb_tags(doc_id);
        CREATE INDEX idx_kb_tags_tag ON kb_tags(tag);

        -- kb_chunks
        CREATE TABLE IF NOT EXISTS kb_chunks (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          doc_id TEXT NOT NULL,
          chunk_index INTEGER NOT NULL,
          content TEXT NOT NULL,
          tokens INTEGER DEFAULT 0,
          vector BLOB,
          page_number INTEGER,
          bbox_data TEXT,
          segment_index INTEGER,
          time_range TEXT,
          frame_url TEXT,
          asr_text TEXT,
          content_type TEXT DEFAULT 'text',
          FOREIGN KEY (doc_id) REFERENCES kb_documents(doc_id) ON DELETE CASCADE
        );
        CREATE INDEX idx_kb_chunks_doc_id ON kb_chunks(doc_id);
        CREATE INDEX idx_kb_chunks_content_type ON kb_chunks(content_type);

        -- kb_versions
        CREATE TABLE IF NOT EXISTS kb_versions (
          doc_id TEXT NOT NULL,
          version INTEGER NOT NULL,
          content_hash TEXT NOT NULL,
          chunk_count INTEGER DEFAULT 0,
          total_tokens INTEGER DEFAULT 0,
          created_at INTEGER NOT NULL,
          PRIMARY KEY (doc_id, version),
          FOREIGN KEY (doc_id) REFERENCES kb_documents(doc_id) ON DELETE CASCADE
        );

        -- kb_keywords
        CREATE TABLE IF NOT EXISTS kb_keywords (
          keyword TEXT NOT NULL,
          chunk_id INTEGER NOT NULL,
          tf REAL DEFAULT 0,
          PRIMARY KEY (keyword, chunk_id),
          FOREIGN KEY (chunk_id) REFERENCES kb_chunks(id) ON DELETE CASCADE
        );
        CREATE INDEX idx_kb_keywords_chunk ON kb_keywords(chunk_id);
        CREATE INDEX idx_kb_keywords_keyword ON kb_keywords(keyword);

        -- uploads
        CREATE TABLE IF NOT EXISTS uploads (
          id TEXT PRIMARY KEY,
          original_name TEXT NOT NULL,
          stored_name TEXT NOT NULL,
          path TEXT NOT NULL,
          size INTEGER NOT NULL,
          mime_type TEXT,
          uploaded_by TEXT DEFAULT 'system',
          uploaded_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
          tags TEXT,
          description TEXT
        );
        CREATE INDEX idx_uploads_stored_name ON uploads(stored_name);
        CREATE INDEX idx_uploads_uploaded_by ON uploads(uploaded_by);
        CREATE INDEX idx_uploads_uploaded_at ON uploads(uploaded_at);

        -- wal_entries
        CREATE TABLE IF NOT EXISTS wal_entries (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          sequence_number INTEGER NOT NULL UNIQUE,
          operation_type TEXT NOT NULL CHECK(operation_type IN ('INSERT', 'UPDATE', 'DELETE')),
          table_name TEXT NOT NULL,
          record_id TEXT NOT NULL,
          old_data TEXT,
          new_data TEXT,
          timestamp INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
          transaction_id TEXT
        );
        CREATE INDEX idx_wal_sequence ON wal_entries(sequence_number);
        CREATE INDEX idx_wal_table_record ON wal_entries(table_name, record_id);
        CREATE INDEX idx_wal_timestamp ON wal_entries(timestamp);
        CREATE INDEX idx_wal_transaction ON wal_entries(transaction_id);

        -- kb_graph_nodes
        CREATE TABLE IF NOT EXISTS kb_graph_nodes (
          id TEXT PRIMARY KEY,
          owner_id TEXT NOT NULL,
          label TEXT NOT NULL,
          type TEXT NOT NULL,
          tags TEXT,
          properties TEXT,
          created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
          FOREIGN KEY (owner_id) REFERENCES users(id) ON DELETE CASCADE
        );
        CREATE INDEX idx_kb_graph_nodes_owner ON kb_graph_nodes(owner_id);
        CREATE INDEX idx_kb_graph_nodes_label ON kb_graph_nodes(owner_id, label);
        CREATE INDEX idx_kb_graph_nodes_type ON kb_graph_nodes(owner_id, type);

        -- kb_graph_edges
        CREATE TABLE IF NOT EXISTS kb_graph_edges (
          id TEXT PRIMARY KEY,
          owner_id TEXT NOT NULL,
          source_id TEXT NOT NULL,
          target_id TEXT NOT NULL,
          type TEXT NOT NULL,
          label TEXT,
          weight REAL DEFAULT 1.0,
          created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
          FOREIGN KEY (source_id) REFERENCES kb_graph_nodes(id) ON DELETE CASCADE,
          FOREIGN KEY (target_id) REFERENCES kb_graph_nodes(id) ON DELETE CASCADE
        );
        CREATE INDEX idx_kb_graph_edges_owner ON kb_graph_edges(owner_id);
        CREATE INDEX idx_kb_graph_edges_source ON kb_graph_edges(owner_id, source_id);
        CREATE INDEX idx_kb_graph_edges_target ON kb_graph_edges(owner_id, target_id);

        -- kb_ltm_entries
        CREATE TABLE IF NOT EXISTS kb_ltm_entries (
          id TEXT PRIMARY KEY,
          owner_id TEXT NOT NULL,
          entry_key TEXT NOT NULL,
          value TEXT NOT NULL,
          tags TEXT,
          source TEXT,
          summary TEXT,
          access_count INTEGER DEFAULT 0,
          created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
          updated_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
          last_accessed_at INTEGER DEFAULT (unixepoch() * 1000),
          vector BLOB,
          is_archived INTEGER DEFAULT 0,
          FOREIGN KEY (owner_id) REFERENCES users(id) ON DELETE CASCADE
        );
        CREATE INDEX idx_kb_ltm_owner ON kb_ltm_entries(owner_id);
        CREATE INDEX idx_kb_ltm_key ON kb_ltm_entries(owner_id, entry_key);
        CREATE INDEX idx_kb_ltm_access ON kb_ltm_entries(owner_id, last_accessed_at);
        CREATE INDEX idx_kb_ltm_archived ON kb_ltm_entries(owner_id, is_archived);

        -- conversation_history
        CREATE TABLE IF NOT EXISTS conversation_history (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          user_id TEXT NOT NULL,
          conversation_id TEXT NOT NULL,
          role TEXT NOT NULL CHECK(role IN ('user','assistant','tool','system')),
          content TEXT,
          tool_calls TEXT,
          created_at INTEGER NOT NULL
        );
        CREATE INDEX idx_conversation_history_user ON conversation_history(user_id, conversation_id, created_at);
      `);
    },
    // v17: chat_messages 添加 conversation_id + created_at 复合索引
    () => {
      db.exec(`CREATE INDEX IF NOT EXISTS idx_chat_messages_conv_created ON chat_messages(conversation_id, created_at DESC);`);
    },
    // v18: 应用设计方案表（app_designer Skill 使用）
    () => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS app_designs (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          description TEXT,
          version INTEGER DEFAULT 1,
          requirement TEXT NOT NULL,
          design_json TEXT NOT NULL,
          components TEXT DEFAULT '[]',
          status TEXT DEFAULT 'draft' CHECK(status IN ('draft','applied','archived')),
          owner_id TEXT NOT NULL,
          created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
          updated_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
        );
        CREATE INDEX IF NOT EXISTS idx_app_designs_owner ON app_designs(owner_id);
        CREATE INDEX IF NOT EXISTS idx_app_designs_status ON app_designs(status);
      `);
    },
    // v19: 知识库集合支持
    () => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS kb_collections (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          description TEXT DEFAULT '',
          owner_id TEXT NOT NULL,
          created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
          updated_at INTEGER DEFAULT (unixepoch() * 1000)
        );
        CREATE INDEX IF NOT EXISTS idx_kb_collections_owner ON kb_collections(owner_id);
        CREATE UNIQUE INDEX IF NOT EXISTS idx_kb_collections_name_owner ON kb_collections(name, owner_id);
      `);
      db.exec(`
        ALTER TABLE kb_documents ADD COLUMN collection_id TEXT DEFAULT NULL;
        CREATE INDEX IF NOT EXISTS idx_kb_documents_collection ON kb_documents(collection_id);
      `);
      // 为每个现有 owner 创建默认知识库
      db.exec(`
        INSERT INTO kb_collections (id, name, description, owner_id, created_at)
        SELECT DISTINCT 'kb_default_' || owner_id, '默认知识库', '系统自动创建的默认知识库', owner_id, unixepoch() * 1000
        FROM kb_documents;
      `);
      // 将现有文档关联到默认知识库
      db.exec(`
        UPDATE kb_documents
        SET collection_id = (
          SELECT id FROM kb_collections c WHERE c.owner_id = kb_documents.owner_id AND c.name = '默认知识库'
        );
      `);
    },
    // v20: 待处理的用户确认（pending_confirms），支持刷新/重启后恢复表单交互
    () => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS pending_confirms (
          confirm_id TEXT PRIMARY KEY,
          conversation_id TEXT NOT NULL,
          user_id TEXT NOT NULL,
          confirm_data TEXT NOT NULL,
          response_data TEXT DEFAULT NULL,
          status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','resolved','expired')),
          created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
          resolved_at INTEGER DEFAULT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_pending_confirms_conv ON pending_confirms(conversation_id);
        CREATE INDEX IF NOT EXISTS idx_pending_confirms_user ON pending_confirms(user_id);
        CREATE INDEX IF NOT EXISTS idx_pending_confirms_status ON pending_confirms(status);
      `);
    },
    // v21: evolution 控制器表（从独立的 evolution.db 迁入主数据库）
    () => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS evolution_generations (
          id TEXT PRIMARY KEY,
          skill_name TEXT NOT NULL,
          generated_by TEXT NOT NULL,
          depth INTEGER NOT NULL,
          created_at INTEGER NOT NULL,
          approved INTEGER NOT NULL DEFAULT 0,
          data TEXT
        );
        CREATE INDEX IF NOT EXISTS idx_ev_gen_skill ON evolution_generations(skill_name);
        CREATE INDEX IF NOT EXISTS idx_ev_gen_created ON evolution_generations(created_at);
      `);
      db.exec(`
        CREATE TABLE IF NOT EXISTS evolution_violations (
          id TEXT PRIMARY KEY,
          constraint_id TEXT NOT NULL,
          description TEXT NOT NULL,
          blocking INTEGER NOT NULL DEFAULT 1,
          skill_name TEXT NOT NULL,
          detected_at INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_ev_viol_constraint ON evolution_violations(constraint_id);
        CREATE INDEX IF NOT EXISTS idx_ev_viol_detected ON evolution_violations(detected_at);
      `);
      db.exec(`
        CREATE TABLE IF NOT EXISTS evolution_approvals (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          description TEXT NOT NULL,
          code TEXT,
          capabilities TEXT,
          generated_by TEXT NOT NULL,
          depth INTEGER NOT NULL,
          created_at INTEGER NOT NULL,
          status TEXT NOT NULL DEFAULT 'pending',
          status_updated_at INTEGER
        );
        CREATE INDEX IF NOT EXISTS idx_ev_app_status ON evolution_approvals(status);
        CREATE INDEX IF NOT EXISTS idx_ev_app_created ON evolution_approvals(created_at);
      `);
    },
    // v22: pending_confirms 添加过期时间 + 补充缺失的查询索引
    () => {
      try { db.exec(`ALTER TABLE pending_confirms ADD COLUMN expires_at INTEGER DEFAULT NULL`); } catch (_) { }
      db.exec(`CREATE INDEX IF NOT EXISTS idx_pending_confirms_expires ON pending_confirms(expires_at)`);
      db.exec(`CREATE INDEX IF NOT EXISTS idx_workflow_tasks_instance ON workflow_tasks(instance_id)`);
      db.exec(`CREATE INDEX IF NOT EXISTS idx_workflow_tasks_node ON workflow_tasks(instance_id, node_id, status)`);
      db.exec(`CREATE INDEX IF NOT EXISTS idx_form_instances_def ON form_instances(definition_id)`);
    },
    // v23: KG v2 字段扩展 — 节点 version/importance，边 properties JSON
    () => {
      try { db.exec(`ALTER TABLE kb_graph_nodes ADD COLUMN version INTEGER NOT NULL DEFAULT 1`); } catch (_) { }
      try { db.exec(`ALTER TABLE kb_graph_nodes ADD COLUMN importance REAL NOT NULL DEFAULT 0.5`); } catch (_) { }
      db.exec(`CREATE INDEX IF NOT EXISTS idx_kb_graph_nodes_importance ON kb_graph_nodes(owner_id, importance)`);
      try { db.exec(`ALTER TABLE kb_graph_edges ADD COLUMN properties TEXT DEFAULT NULL`); } catch (_) { }
    },
    // v24: KG v2 阶段 4 — 反馈事件表
    () => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS kg_feedback_events (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          user_id TEXT NOT NULL,
          query_id TEXT NOT NULL,
          query TEXT NOT NULL,
          query_type TEXT,
          accepted INTEGER NOT NULL DEFAULT 0,
          rating INTEGER,
          rejected_entity_ids TEXT,
          accepted_chunk_keys TEXT,
          dwell_time_ms INTEGER,
          follow_up_query TEXT,
          recall_snapshot TEXT,
          created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
        );
        CREATE INDEX IF NOT EXISTS idx_kg_feedback_user_created ON kg_feedback_events(user_id, created_at);
        CREATE INDEX IF NOT EXISTS idx_kg_feedback_query_type ON kg_feedback_events(query_type, created_at);
        CREATE INDEX IF NOT EXISTS idx_kg_feedback_query_id ON kg_feedback_events(query_id);
      `);
    },
  ];

  // 执行未应用的迁移
  const applyMigration = db.transaction((idx: number, fn: () => void) => {
    fn();
    db.prepare("INSERT INTO schema_version (version) VALUES (?)").run(idx + 1);
  });

  for (let i = version; i < migrations.length; i++) {
    applyMigration(i, migrations[i]);
    console.log(`   DB migration v${i + 1} applied`);
  }
}
