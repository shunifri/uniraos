import { initDatabaseAsync, isMySQL } from './src/db/database.js';
import { listUsers, getUserRoles, getUserById } from './src/db/user-repository.js';

async function test() {
  try {
    await initDatabaseAsync();

    if (!isMySQL()) {
      console.error('当前未使用 MySQL 数据库');
      return;
    }

    const users = await listUsers();
    console.log(`用户数量: ${users.length}`);

    for (const user of users.slice(0, 3)) {
      console.log(`\n用户 ${user.username} (${user.id})`);

      const roles = await getUserRoles(user.id);
      console.log('角色:');
      console.log(JSON.stringify(roles, null, 2));
    }
  } catch (err) {
    console.error('错误:', err);
  }
}

test().catch(console.error);
