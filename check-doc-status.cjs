
const mysql = require('mysql2/promise');
require('dotenv').config();

async function checkDocStatus() {
  const conn = await mysql.createConnection({
    host: process.env.MYSQL_PRIMARY_HOST,
    port: parseInt(process.env.MYSQL_PRIMARY_PORT || '3306'),
    user: process.env.MYSQL_USER,
    password: process.env.MYSQL_PASSWORD,
    database: process.env.MYSQL_DATABASE,
  });

  const [rows] = await conn.execute(`
    SELECT doc_id, name, parsing_status, parsing_progress, chunk_count 
    FROM kb_documents 
    WHERE doc_id = 'doc_1776001599270_g62gfr'
  `);

  console.log('Document status:');
  console.log(rows[0]);

  // Check knowledge graph
  const [graphNodes] = await conn.execute(`
    SELECT COUNT(*) as cnt FROM kb_graph_nodes WHERE id LIKE 'kb_doc_%'
  `);
  console.log('\\nKnowledge graph nodes (kb_doc_*):', graphNodes[0].cnt);

  await conn.end();
}

checkDocStatus().catch(console.error);
