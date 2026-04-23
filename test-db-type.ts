// 检查使用的数据库类型
import { isMySQL, getDb } from './src/db/database.js';

async function test() {
  console.log('=== 数据库类型检查 ===');
  console.log(`isMySQL(): ${isMySQL()}`);

  if (isMySQL()) {
    console.log('=== 使用 MySQL ===');
    const { getMySQLAdapter } = await import('./src/db/mysql-adapter.js');
    const adapter = await getMySQLAdapter();
    const result = await adapter.query('SELECT COUNT(*) as count FROM users');
    console.log('MySQL用户数量:', result[0].count);
    const users = await adapter.query('SELECT * FROM users LIMIT 3');
    console.log('MySQL用户:', users);
  } else {
    console.log('=== 使用 SQLite ===');
    const count = getDb().prepare('SELECT COUNT(*) as count FROM users').get()['count'];
    console.log('SQLite用户数量:', count);
    const users = getDb().prepare('SELECT * FROM users LIMIT 3').all();
    console.log('SQLite用户:', users);
  }
}

test().catch(console.error);
