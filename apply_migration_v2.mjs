import { initMySQLDatabase } from './src/db/mysql-database.ts';

console.log('应用迁移版本2...');
try {
  await initMySQLDatabase();
  console.log('✅ 迁移完成');
} catch (e) {
  console.error('❌ 失败:', e.message);
  process.exit(1);
}
