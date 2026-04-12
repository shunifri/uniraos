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

// 检查 tags 字段实际存储内容
const [rows] = await connection.execute(
  'SELECT doc_id, name, tags, chunk_count, LENGTH(tags) as tags_len FROM kb_documents WHERE doc_id = ?',
  [docId]
);
console.log('Document info:');
console.table(rows);

// 检查数据库中有哪些知识图谱相关表
const [tables] = await connection.execute(`
  SHOW TABLES LIKE '%kg%'
`);
console.log('\nKnowledge graph related tables:');
console.log(tables.map(t => Object.values(t)[0]));

// 检查 kb_documents 完整结构
const [desc] = await connection.execute(`
  DESCRIBE kb_documents
`);
console.log('\nkb_documents structure:');
console.table(desc);

await connection.end();
