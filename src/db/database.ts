/**
 * 数据库初始化与 Schema 管理
 * 支持 SQLite (better-sqlite3) 和 MySQL 切换
 *
 * 完整 schema：departments → users → roles → user_roles → resources → permissions → role_permissions → department_resources → sessions
 */
import Database from "better-sqlite3";
import { join } from "path";
import { mkdirSync } from "fs";

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

  // 性能优化
  db.pragma("journal_mode = WAL");
  db.pragma("synchronous = NORMAL");
  db.pragma("cache_size = -64000"); // 64MB cache
  db.pragma("busy_timeout = 5000");
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
