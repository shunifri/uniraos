import mysql from 'mysql2/promise';
import 'dotenv/config';

const connection = await mysql.createConnection({
  host: process.env.MYSQL_PRIMARY_HOST,
  port: parseInt(process.env.MYSQL_PRIMARY_PORT || '3306'),
  user: process.env.MYSQL_USER,
  password: process.env.MYSQL_PASSWORD,
  database: process.env.MYSQL_DATABASE
});

const docId = 'doc_1776006439450_uhpz6a';
console.log(`Checking document ${docId}...`);

const [rows] = await connection.query(`
  SELECT doc_id, name, tags, chunk_count, parsing_status, parsing_progress
  FROM kb_documents
  WHERE doc_id = ?
`, [docId]);
console.table(rows);

if (rows[0]) {
  console.log('Tags JSON:', rows[0].tags);
  try {
    const tags = JSON.parse(rows[0].tags);
    console.log('Parsed tags:', tags);
  } catch(e) {
    console.log('Failed to parse tags:', e.message);
  }
}

// 检查知识图谱表是否有这个文档节点
const [graphRows] = await connection.query(`
  SELECT * FROM kg_nodes WHERE id = ?
`, [`kb_doc_${docId}`]);
console.log('\nKnowledge graph nodes:');
console.table(graphRows);

await connection.end();
