
import 'dotenv/config';
import { initMySQLDatabase } from './src/db/mysql-database.ts';

console.log('Starting MySQL database initialization...');
console.log('Host:', process.env.MYSQL_PRIMARY_HOST);
console.log('Port:', process.env.MYSQL_PRIMARY_PORT);
console.log('User:', process.env.MYSQL_USER);

initMySQLDatabase().then(() => {
  console.log('✅ Database initialization complete! All tables created.');
  process.exit(0);
}).catch(err => {
  console.error('❌ Database initialization failed:', err);
  process.exit(1);
});
