
const mysql = require('mysql2/promise');
require('dotenv').config();

async function deleteDoc() {
  const conn = await mysql.createConnection({
    host: process.env.MYSQL_PRIMARY_HOST,
    port: parseInt(process.env.MYSQL_PRIMARY_PORT || '3306'),
    user: process.env.MYSQL_USER,
    password: process.env.MYSQL_PASSWORD,
    database: process.env.MYSQL_DATABASE,
  });

  const docId = 'doc_1776001599289_eahgob';
  console.log('Deleting doc:', docId);
  
  // Foreign key will cascade delete chunks and keywords
  await conn.execute('DELETE FROM kb_documents WHERE doc_id = ?', [docId]);
  console.log('Deleted successfully');

  const [rows] = await conn.execute('SELECT COUNT(*) as cnt FROM kb_documents WHERE doc_id = ?', [docId]);
  console.log('Remaining count:', rows[0].cnt);

  await conn.end();
}

deleteDoc().catch(console.error);
