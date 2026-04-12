import { initMySQLDatabase } from './src/db/mysql-database.ts';

console.log('重新初始化 MySQL 数据库以创建新表...');
try {
  await initMySQLDatabase();
  console.log('✅ 数据库初始化完成');
} catch (e) {
  console.error('❌ 初始化失败:', e.message);
  process.exit(1);
}
