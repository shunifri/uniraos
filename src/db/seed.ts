/**
 * Database seed script
 * Idempotent — safe to run multiple times
 */
import { config } from "dotenv";
import { initDatabaseAsync, getDb, isMySQL, closeDatabase } from "./database.js";
import { ensureAdminExists } from "./user-repository.js";
import { getMySQLAdapter } from "./mysql-adapter.js";

config();

async function seed(): Promise<void> {
  console.log("🌱 Seeding database...");

  // Initialize database (runs migrations if needed)
  await initDatabaseAsync();

  if (isMySQL()) {
    await seedMySQL();
  } else {
    await seedSQLite();
  }

  // Ensure default admin user exists
  const admin = await ensureAdminExists();
  console.log(`✅ Admin user ensured: ${admin.username} (${admin.id})`);

  closeDatabase();
  console.log("🌱 Seed complete.");
}

async function seedMySQL(): Promise<void> {
  const adapter = getMySQLAdapter();

  // Idempotent seed: departments
  await adapter.execute(
    `INSERT IGNORE INTO departments (id, name, parent_id, path, level, description)
     VALUES ('dept_root', '全体', NULL, '/全体', 0, '根部门，所有用户的默认归属')`
  );

  // Idempotent seed: roles
  await adapter.execute(
    `INSERT IGNORE INTO roles (id, name, description, is_system) VALUES
     ('role_admin', 'admin', '系统管理员，拥有所有权限', 1),
     ('role_user', 'user', '普通用户，基础操作权限', 1),
     ('role_viewer', 'viewer', '只读用户，仅可查看', 1)`
  );

  // Idempotent seed: resources (core set)
  const resources = [
    ['res_skills', 'skills', 'api', 'Skill列表与详情'],
    ['res_skills_exec', 'skills.exec', 'api', 'Skill执行'],
    ['res_skills_mgmt', 'skills.manage', 'api', 'Skill管理（增删）'],
    ['res_config', 'config', 'api', '系统配置查看'],
    ['res_config_write', 'config.write', 'api', '系统配置修改'],
    ['res_chat', 'chat', 'api', 'Agent对话'],
    ['res_chat_stream', 'chat.stream', 'api', 'Agent流式对话'],
    ['res_memory_read', 'memory.read', 'api', '记忆读取'],
    ['res_memory_write', 'memory.write', 'api', '记忆写入'],
    ['res_users', 'users', 'api', '用户管理'],
    ['res_roles', 'roles', 'api', '角色管理'],
    ['res_departments', 'departments', 'api', '部门管理'],
    ['res_plugins', 'plugins', 'api', '插件管理'],
    ['res_tasks', 'tasks', 'api', '异步任务管理'],
  ];
  for (const [id, name, type, desc] of resources) {
    await adapter.execute(
      `INSERT IGNORE INTO resources (id, name, type, description) VALUES (?, ?, ?, ?)`,
      [id, name, type, desc]
    );
  }

  // Idempotent seed: permissions
  const permissions = [
    ['perm_skills_read', 'skills.read', '查看Skill列表', 'res_skills', 'read'],
    ['perm_skills_exec', 'skills.execute', '执行Skill', 'res_skills_exec', 'execute'],
    ['perm_skills_manage', 'skills.manage', '管理Skill（增删）', 'res_skills_mgmt', 'manage'],
    ['perm_config_read', 'config.read', '查看系统配置', 'res_config', 'read'],
    ['perm_config_write', 'config.write', '修改系统配置', 'res_config_write', 'write'],
    ['perm_chat', 'chat', '使用Agent对话', 'res_chat', 'execute'],
    ['perm_chat_stream', 'chat.stream', '使用Agent流式对话', 'res_chat_stream', 'execute'],
    ['perm_memory_read', 'memory.read', '查看记忆', 'res_memory_read', 'read'],
    ['perm_memory_write', 'memory.write', '写入/删除记忆', 'res_memory_write', 'write'],
    ['perm_users_manage', 'users.manage', '管理用户', 'res_users', 'manage'],
    ['perm_roles_manage', 'roles.manage', '管理角色和权限', 'res_roles', 'manage'],
    ['perm_dept_manage', 'departments.manage', '管理部门', 'res_departments', 'manage'],
    ['perm_plugins', 'plugins.manage', '管理插件', 'res_plugins', 'manage'],
    ['perm_tasks', 'tasks.read', '查看异步任务', 'res_tasks', 'read'],
  ];
  for (const [id, name, desc, resourceId, action] of permissions) {
    await adapter.execute(
      `INSERT IGNORE INTO permissions (id, name, description, resource_id, action) VALUES (?, ?, ?, ?, ?)`,
      [id, name, desc, resourceId, action]
    );
  }

  // Idempotent seed: role_permissions
  await adapter.execute(
    `INSERT IGNORE INTO role_permissions (role_id, permission_id)
     SELECT 'role_admin', id FROM permissions`
  );

  const viewerPerms = [
    'perm_skills_read', 'perm_memory_read', 'perm_config_read', 'perm_tasks',
    'perm_chat', 'perm_chat_stream'
  ];
  for (const permId of viewerPerms) {
    await adapter.execute(
      `INSERT IGNORE INTO role_permissions (role_id, permission_id) VALUES ('role_viewer', ?)`,
      [permId]
    );
  }

  // Idempotent seed: department_resources
  await adapter.execute(
    `INSERT IGNORE INTO department_resources (department_id, resource_id)
     SELECT 'dept_root', id FROM resources`
  );

  console.log("   MySQL seed data ensured");
}

async function seedSQLite(): Promise<void> {
  const db = getDb();

  // Idempotent seed: departments
  db.prepare(
    `INSERT OR IGNORE INTO departments (id, name, parent_id, path, level, description)
     VALUES ('dept_root', '全体', NULL, '/全体', 0, '根部门，所有用户的默认归属')`
  ).run();

  // Idempotent seed: roles
  db.prepare(
    `INSERT OR IGNORE INTO roles (id, name, description, is_system) VALUES
     ('role_admin', 'admin', '系统管理员，拥有所有权限，跳过部门检查', 1),
     ('role_user', 'user', '普通用户，基础操作权限', 1),
     ('role_viewer', 'viewer', '只读用户，仅可查看', 1)`
  ).run();

  // Idempotent seed: resources
  const resources = [
    ['res_skills', 'skills', 'api', 'Skill列表与详情'],
    ['res_skills_exec', 'skills.exec', 'api', 'Skill执行'],
    ['res_skills_mgmt', 'skills.manage', 'api', 'Skill管理（增删）'],
    ['res_config', 'config', 'api', '系统配置查看'],
    ['res_config_write', 'config.write', 'api', '系统配置修改'],
    ['res_chat', 'chat', 'api', 'Agent对话'],
    ['res_chat_stream', 'chat.stream', 'api', 'Agent流式对话'],
    ['res_memory_read', 'memory.read', 'api', '记忆读取'],
    ['res_memory_write', 'memory.write', 'api', '记忆写入'],
    ['res_users', 'users', 'api', '用户管理'],
    ['res_roles', 'roles', 'api', '角色管理'],
    ['res_departments', 'departments', 'api', '部门管理'],
    ['res_plugins', 'plugins', 'api', '插件管理'],
    ['res_tasks', 'tasks', 'api', '异步任务管理'],
  ];
  const insertResource = db.prepare(
    `INSERT OR IGNORE INTO resources (id, name, type, description) VALUES (?, ?, ?, ?)`
  );
  for (const r of resources) insertResource.run(...r);

  // Idempotent seed: permissions
  const permissions = [
    ['perm_skills_read', 'skills.read', '查看Skill列表', 'res_skills', 'read'],
    ['perm_skills_exec', 'skills.execute', '执行Skill', 'res_skills_exec', 'execute'],
    ['perm_skills_manage', 'skills.manage', '管理Skill（增删）', 'res_skills_mgmt', 'manage'],
    ['perm_config_read', 'config.read', '查看系统配置', 'res_config', 'read'],
    ['perm_config_write', 'config.write', '修改系统配置', 'res_config_write', 'write'],
    ['perm_chat', 'chat', '使用Agent对话', 'res_chat', 'execute'],
    ['perm_chat_stream', 'chat.stream', '使用Agent流式对话', 'res_chat_stream', 'execute'],
    ['perm_memory_read', 'memory.read', '查看记忆', 'res_memory_read', 'read'],
    ['perm_memory_write', 'memory.write', '写入/删除记忆', 'res_memory_write', 'write'],
    ['perm_users_manage', 'users.manage', '管理用户', 'res_users', 'manage'],
    ['perm_roles_manage', 'roles.manage', '管理角色和权限', 'res_roles', 'manage'],
    ['perm_dept_manage', 'departments.manage', '管理部门', 'res_departments', 'manage'],
    ['perm_plugins', 'plugins.manage', '管理插件', 'res_plugins', 'manage'],
    ['perm_tasks', 'tasks.read', '查看异步任务', 'res_tasks', 'read'],
  ];
  const insertPermission = db.prepare(
    `INSERT OR IGNORE INTO permissions (id, name, description, resource_id, action) VALUES (?, ?, ?, ?, ?)`
  );
  for (const p of permissions) insertPermission.run(...p);

  // Idempotent seed: role_permissions
  db.prepare(
    `INSERT OR IGNORE INTO role_permissions (role_id, permission_id)
     SELECT 'role_admin', id FROM permissions`
  ).run();

  const viewerPerms = [
    'perm_skills_read', 'perm_memory_read', 'perm_config_read', 'perm_tasks',
    'perm_chat', 'perm_chat_stream'
  ];
  const insertRolePerm = db.prepare(
    `INSERT OR IGNORE INTO role_permissions (role_id, permission_id) VALUES (?, ?)`
  );
  for (const permId of viewerPerms) insertRolePerm.run('role_viewer', permId);

  // Idempotent seed: department_resources
  db.prepare(
    `INSERT OR IGNORE INTO department_resources (department_id, resource_id)
     SELECT 'dept_root', id FROM resources`
  ).run();

  console.log("   SQLite seed data ensured");
}

seed().catch((err) => {
  console.error("❌ Seed failed:", err);
  process.exit(1);
});
