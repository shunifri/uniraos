import mysql from 'mysql2/promise';
import 'dotenv/config';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

import { loadEnvFile } from 'process';
loadEnvFile(join(__dirname, '.env.local'));

const connection = await mysql.createConnection({
  host: process.env.MYSQL_PRIMARY_HOST || 'localhost',
  port: parseInt(process.env.MYSQL_PRIMARY_PORT || '3307'),
  user: process.env.MYSQL_USER || 'raos',
  password: process.env.MYSQL_PASSWORD || 'raospassword',
  database: process.env.MYSQL_DATABASE || 'raos'
});

const docId = process.argv[2];
const status = process.argv[3] || 'failed';

if (!docId) {
  console.log('Usage: node reset-doc-status.mjs <docId> [status]');
  console.log('Status options: failed, success, pending, processing');
  process.exit(1);
}

console.log(`Updating document ${docId} status to ${status}`);

await connection.execute(
  "UPDATE kb_documents SET parsing_status = ?, parsing_progress = 0 WHERE doc_id = ?",
  [status, docId]
);

console.log('Done');

await connection.end();
