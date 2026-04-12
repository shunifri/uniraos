import mysql from 'mysql2/promise';
import 'dotenv/config';

const connection = await mysql.createConnection({
  host: process.env.MYSQL_PRIMARY_HOST,
  port: parseInt(process.env.MYSQL_PRIMARY_PORT || '3306'),
  user: process.env.MYSQL_USER,
  password: process.env.MYSQL_PASSWORD,
  database: process.env.MYSQL_DATABASE
});

const docId = 'doc_1776006117057_d8gdz2';
console.log(`Checking document ${docId}...`);

const [rows] = await connection.query(`
  SELECT doc_id, name, parsing_status, parsing_progress, chunk_count, owner_id, doc_mind_task_id
  FROM kb_documents
  WHERE doc_id = ?
`, [docId]);
console.table(rows);

// Check all documents with that name
const [nameRows] = await connection.query(`
  SELECT doc_id, name, parsing_status, parsing_progress, chunk_count, owner_id
  FROM kb_documents
  WHERE name = 'GBT+7713.2-2022.pdf'
`);
console.log('\nAll documents with this name:');
console.table(nameRows);

await connection.end();
