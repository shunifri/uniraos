/**
 * 数据库初始化与 Schema 管理
 * 使用 better-sqlite3（WAL 模式，高并发读）
 *
 * 完整 schema：departments → users → roles → user_roles → resources → permissions → role_permissions → department_resources → sessions
 */
import Database from "better-sqlite3";
import { join } from "path";
import { mkdirSync } from "fs";

let db: Database.Database | null = null;

/** 获取数据库实例（单例） */
export function getDb(): Database.Database {
  if (!db) throw new Error("Database not initialized. Call initDatabase() first.");
  return db;
}

/** 初始化数据库 */
export function initDatabase(dbPath?: string): Database.Database {
  if (db) return db;

  const finalPath = dbPath ?? join(process.cwd(), ".raos", "raos.db");
  mkdirSync(join(finalPath, ".."), { recursive: true });

  db = new Database(finalPath);

  // 性能优化
  db.pragma("journal_mode = WAL");
  db.pragma("synchronous = NORMAL");
  db.pragma("cache_size = -64000"); // 64MB cache
  db.pragma("busy_timeout = 5000");
  db.pragma("foreign_keys = ON");

  runMigrations(db);

  return db;
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
