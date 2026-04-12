import { initDatabaseAsync } from './src/db/database.ts';

console.log('重新初始化 MySQL 数据库...');
try {
  await initDatabaseAsync();
  console.log('✅ MySQL 数据库初始化完成');
} catch (e) {
  console.error('❌ 初始化失败:', e.message);
  process.exit(1);
}
