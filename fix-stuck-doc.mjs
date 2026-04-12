import mysql from 'mysql2/promise';
import 'dotenv/config';

const connection = await mysql.createConnection({
  host: process.env.MYSQL_PRIMARY_HOST,
  port: parseInt(process.env.MYSQL_PRIMARY_PORT || '3306'),
  user: process.env.MYSQL_USER,
  password: process.env.MYSQL_PASSWORD,
  database: process.env.MYSQL_DATABASE
});

const docId = 'doc_1776005676113_v9qog2';

console.log(`Fixing stuck document ${docId}...`);

// Option 1: Mark as failed
const [result] = await connection.execute(
  'UPDATE kb_documents SET parsing_status = ?, chunk_count = ? WHERE doc_id = ?',
  ['failed', 0, docId]
);

console.log('Update result:', result);
console.log(`Document ${docId} marked as failed. You can re-upload it now.`);

await connection.end();
