import dotenv from 'dotenv';
import { resolve } from 'path';

// 加载环境变量
dotenv.config({ path: resolve(process.cwd(), '.env.local') });
dotenv.config({ path: resolve(process.cwd(), '.env') });

console.log('USE_MYSQL:', process.env.USE_MYSQL);

// 动态导入模块
const { initMySQLDatabase } = await import('./src/db/mysql-database.ts');

try {
  console.log('开始初始化 MySQL 数据库...');
  await initMySQLDatabase();
  console.log('✅ MySQL 数据库初始化完成');
} catch (e) {
  console.error('❌ 初始化失败:', e.message);
  console.error(e.stack);
  process.exit(1);
}
