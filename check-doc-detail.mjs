import mysql from 'mysql2/promise';
import 'dotenv/config';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// 加载 .env.local
import { loadEnvFile } from 'process';
loadEnvFile(join(__dirname, '.env.local'));

const connection = await mysql.createConnection({
  host: process.env.MYSQL_PRIMARY_HOST || 'localhost',
  port: parseInt(process.env.MYSQL_PRIMARY_PORT || '3307'),
  user: process.env.MYSQL_USER || 'raos',
  password: process.env.MYSQL_PASSWORD || 'raospassword',
  database: process.env.MYSQL_DATABASE || 'raos'
});

console.log('=== Document Details ===');
const [docRows] = await connection.query(`
  SELECT * FROM kb_documents WHERE doc_id = 'doc_1776131650265_7dedlv'
`);
console.table(docRows);

console.log('\n=== Check if file exists ===');
const [fs] = await import('fs');
const uploadPath = join(__dirname, 'uploads/user_admin/集团化数据中台建设方案_1776000176188.docx');
console.log(`File exists: ${fs.existsSync(uploadPath)}`);

await connection.end();
