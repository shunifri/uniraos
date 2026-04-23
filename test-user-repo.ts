// 测试用户数据库函数
import { listUsers, getUserRoles } from './src/db/user-repository.js';
import { initDatabaseAsync } from './src/db/database.js';

async function test() {
  console.log('=== 测试用户数据库 ===');
  await initDatabaseAsync();

  console.log('\n=== 步骤1: 调用 listUsers() ===');
  const users = await listUsers();
  console.log('用户数量:', users.length);

  for (const user of users) {
    console.log(`用户: ${user.username} (${user.id})`);

    console.log('\n=== 步骤2: 调用 getUserRoles() ===');
    const roles = await getUserRoles(user.id);
    console.log('角色:', roles);

    const enriched = { ...user, roles };
    console.log('包含角色的用户:', enriched);
    console.log('----------------');
  }
}

test().catch(console.error);
