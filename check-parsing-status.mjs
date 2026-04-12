import mysql from 'mysql2/promise';
import 'dotenv/config';

const connection = await mysql.createConnection({
  host: process.env.MYSQL_PRIMARY_HOST,
  port: parseInt(process.env.MYSQL_PRIMARY_PORT || '3306'),
  user: process.env.MYSQL_USER,
  password: process.env.MYSQL_PASSWORD,
  database: process.env.MYSQL_DATABASE
});

// Get table structure
console.log('=== Table structure for kb_documents ===');
const [columns] = await connection.query(`
  DESCRIBE kb_documents
`);
console.table(columns);

console.log('\n=== Processing documents (status = processing) ===');
const [rows] = await connection.query(`
  SELECT doc_id, name, parsing_status, parsing_progress, chunk_count, ingested_at
  FROM kb_documents
  WHERE parsing_status = 'processing'
  ORDER BY ingested_at DESC LIMIT 10
`);
console.table(rows);

console.log('\n=== Last 20 documents ===');
const [allRows] = await connection.query(`
  SELECT doc_id, name, parsing_status, parsing_progress, chunk_count, ingested_at
  FROM kb_documents
  ORDER BY ingested_at DESC LIMIT 20
`);
console.table(allRows);

console.log('\n=== Check layouts_json for the stuck doc ===');
const [layoutRows] = await connection.query(`
  SELECT doc_id, name, chunk_count, LENGTH(layouts_json) as layouts_len, LENGTH(segments_json) as segments_len
  FROM kb_documents
  WHERE doc_id = ?
`, ['doc_1776005676113_v9qog2']);
console.table(layoutRows);

console.log('\n=== Check for duplicate documents with same name ===');
const [dupRows] = await connection.query(`
  SELECT doc_id, name, chunk_count, parsing_status, ingested_at
  FROM kb_documents
  WHERE name = ?
`, ['集团化数据中台建设方案.docx']);
console.table(dupRows);

await connection.end();
