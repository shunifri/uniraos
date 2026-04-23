import { initDatabaseAsync, isMySQL, getDb } from './src/db/database.js';
import { listUsers, getUserRoles, getUserWithDetails } from './src/db/user-repository.js';

async function test() {
  await initDatabaseAsync();
  
  console.log('=== 检查 listUsers ===');
  const users = await listUsers();
  console.log(`用户数量: ${users.length}`);
  
  for (const user of users) {
    console.log(`\n=== 用户 ${user.username} (${user.id}) ===`);
    
    console.log('--- getUserRoles ---');
    const roles = await getUserRoles(user.id);
    console.log('角色:');
    console.log(JSON.stringify(roles, null, 2));
    
    console.log('--- getUserWithDetails ---');
    const details = await getUserWithDetails(user.id);
    console.log('完整信息:');
    console.log(JSON.stringify(details, null, 2));
  }
}

test().catch(console.error);
