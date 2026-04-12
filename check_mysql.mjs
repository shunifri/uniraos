import { isMySQL, getDatabaseType } from './src/db/database.ts';
import { initMySQLDatabase } from './src/db/mysql-database.ts';

console.log('数据库类型:', getDatabaseType());
console.log('是否 MySQL:', isMySQL());

if (isMySQL()) {
  console.log('开始初始化 MySQL...');
  try {
    await initMySQLDatabase();
    console.log('✅ MySQL 初始化完成');
  } catch (e) {
    console.error('❌ MySQL 初始化失败:', e.message);
  }
} else {
  console.log('不是 MySQL 模式，跳过');
}
