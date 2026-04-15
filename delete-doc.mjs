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
if (!docId) {
  console.log('Usage: node delete-doc.mjs <docId>');
  process.exit(1);
}

console.log(`Deleting document: ${docId}`);

await connection.execute("DELETE FROM kb_keywords WHERE chunk_id IN (SELECT id FROM kb_chunks WHERE doc_id = ?)", [docId]);
await connection.execute("DELETE FROM kb_chunks WHERE doc_id = ?", [docId]);
await connection.execute("DELETE FROM kb_tags WHERE doc_id = ?", [docId]);
await connection.execute("DELETE FROM kb_versions WHERE doc_id = ?", [docId]);
await connection.execute("DELETE FROM kb_documents WHERE doc_id = ?", [docId]);

console.log('Done');

await connection.end();
