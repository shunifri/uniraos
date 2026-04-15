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

console.log('=== Resetting stuck documents ===');
const [result] = await connection.execute(`
  UPDATE kb_documents
  SET parsing_status = 'failed', parsing_progress = 0
  WHERE parsing_status = 'processing'
`);

console.log(`Reset ${result.affectedRows} stuck documents`);

console.log('\n=== Current document status ===');
const [rows] = await connection.query(`
  SELECT doc_id, name, parsing_status, parsing_progress, chunk_count, ingested_at
  FROM kb_documents
  ORDER BY ingested_at DESC LIMIT 10
`);
console.table(rows);

await connection.end();
