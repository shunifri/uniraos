import { initDatabaseAsync, isMySQL } from './src/db/database.js';
import { listUsers, getUserRoles, getUserById } from './src/db/user-repository.js';

async function test() {
  try {
    await initDatabaseAsync();
    
    if (!isMySQL()) {
      console.error('当前未使用 MySQL 数据库');
      return;
    }
    
    // 使用 MySQL 适配器直接查询 user_roles 表
    const { getMySQLAdapter } = await import('./src/db/mysql-adapter.js');
    const adapter = await getMySQLAdapter();
    
    // 查询用户列表
    const [usersResult, userRolesResult] = await Promise.all([
      adapter.query('SELECT id, username, display_name FROM users LIMIT 8'),
      adapter.query(`
        SELECT ur.user_id, ur.role_id, r.name 
        FROM user_roles ur 
        LEFT JOIN roles r ON ur.role_id = r.id 
        ORDER BY ur.user_id
      `)
    ]);
    
    console.log('=== 用户列表 (MySQL) ===');
    console.log(JSON.stringify(usersResult, null, 2));
    
    console.log('\n=== 用户角色关联 (MySQL) ===');
    console.log(JSON.stringify(userRolesResult, null, 2));
    
    // 检查是否所有用户都有角色
    const usersWithNoRoles = [];
    for (const user of usersResult) {
      const userRoles = userRolesResult.filter(ur => ur.user_id === user.id);
      if (userRoles.length === 0) {
        usersWithNoRoles.push(user);
      }
    }
    
    if (usersWithNoRoles.length > 0) {
      console.log('\n⚠️ 无角色的用户:');
      console.log(JSON.stringify(usersWithNoRoles, null, 2));
    }
    
    // 测试 getUserRoles 函数是否能正确获取 MySQL 中的角色
    for (const user of usersResult.slice(0, 3)) {
      console.log(`\n=== 获取用户 ${user.username} (${user.id}) 的角色 ===`);
      const roles = await getUserRoles(user.id);
      console.log('getUserRoles 结果:');
      console.log(JSON.stringify(roles, null, 2));
    }
    
  } catch (err) {
    console.error('错误:', err);
  }
}

test().catch(console.error);
