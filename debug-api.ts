// 调试 API 问题
import { initDatabaseAsync, isMySQL } from './src/db/database.js';
import { listUsers, getUserRoles } from './src/db/user-repository.js';

async function debug() {
  try {
    await initDatabaseAsync();

    console.log('数据库类型:', isMySQL() ? 'MySQL' : 'SQLite');

    const users = await listUsers();
    console.log('\n=== listUsers 返回 ===');
    console.log('用户数量:', users.length);
    console.log('第一个用户:', users[0]);

    console.log('\n=== 尝试 enrich 用户 ===');
    const enriched = await Promise.all(users.map(async (u) => {
      const roles = await getUserRoles(u.id);
      console.log(`用户 ${u.id} 的角色:`, roles);
      const result = { ...u, roles };
      console.log(`enrich 后的对象:`, result);
      console.log(`roles 是否在对象中:`, 'roles' in result);
      return result;
    }));

    console.log('\n=== 最终 enriched 数组 ===');
    for (const u of enriched) {
      console.log(`用户 ${u.username} 有 roles 字段吗?`, 'roles' in u);
      if ('roles' in u) {
        console.log('  roles:', (u as any).roles);
      }
    }

  } catch (err) {
    console.error('调试失败:', err);
  }
}

debug();
