import { initDatabaseAsync, isMySQL } from './src/db/database.js';
import { listUsers, getUserRoles, getUserById } from './src/db/user-repository.js';

async function test() {
  await initDatabaseAsync();
  
  console.log(`使用数据库类型: ${isMySQL() ? 'MySQL' : 'SQLite'}`);
  
  const users = await listUsers();
  console.log(`用户数量: ${users.length}`);
  
  for (const user of users) {
    console.log(`\n用户 ${user.username} (${user.id})`);
    
    const roles = await getUserRoles(user.id);
    console.log(`角色数量: ${roles.length}`);
    if (roles.length > 0) {
      console.log('角色详情:');
      console.log(JSON.stringify(roles, null, 2));
    } else {
      console.warn('⚠️ 该用户没有角色信息');
      
      // 检查 user_roles 表中是否有记录
      if (isMySQL()) {
        const { getMySQLAdapter } = await import('./src/db/mysql-adapter.js');
        const adapter = await getMySQLAdapter();
        const result = await adapter.query('SELECT * FROM user_roles WHERE user_id = ?', [user.id]);
        console.log('user_roles 表记录:');
        console.log(JSON.stringify(result, null, 2));
      } else {
        const db = await import('./src/db/database.js').then(m => m.getDb());
        const result = db.prepare('SELECT * FROM user_roles WHERE user_id = ?').all(user.id);
        console.log('user_roles 表记录:');
        console.log(JSON.stringify(result, null, 2));
      }
    }
  }
}

test().catch(console.error);
