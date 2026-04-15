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

console.log('=== Last 20 documents ===');
const [allRows] = await connection.query(`
  SELECT doc_id, name, parsing_status, parsing_progress, chunk_count, ingested_at, updated_at
  FROM kb_documents
  ORDER BY ingested_at DESC LIMIT 20
`);
console.table(allRows);

console.log('\n=== Processing documents ===');
const [processingRows] = await connection.query(`
  SELECT doc_id, name, parsing_status, parsing_progress, chunk_count, ingested_at
  FROM kb_documents
  WHERE parsing_status = 'processing'
  ORDER BY ingested_at DESC
`);
console.table(processingRows);

await connection.end();
