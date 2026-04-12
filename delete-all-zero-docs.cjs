
const mysql = require('mysql2/promise');
require('dotenv').config();

async function deleteAllZeroDocs() {
  const conn = await mysql.createConnection({
    host: process.env.MYSQL_PRIMARY_HOST,
    port: parseInt(process.env.MYSQL_PRIMARY_PORT || '3306'),
    user: process.env.MYSQL_USER,
    password: process.env.MYSQL_PASSWORD,
    database: process.env.MYSQL_DATABASE,
  });

  const [rows] = await conn.execute(`
    SELECT doc_id, name FROM kb_documents WHERE chunk_count = 0
  `);

  console.log('Deleting', rows.length, 'documents with chunk_count = 0...');
  
  for (const row of rows) {
    console.log('Deleting:', row.doc_id, row.name);
    await conn.execute('DELETE FROM kb_documents WHERE doc_id = ?', [row.doc_id]);
    console.log('Deleted');
  }

  const [count] = await conn.execute('SELECT COUNT(*) as cnt FROM kb_documents WHERE chunk_count = 0');
  console.log('Remaining documents with chunk_count = 0:', count[0].cnt);

  await conn.end();
}

deleteAllZeroDocs().catch(console.error);
