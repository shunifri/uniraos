
const mysql = require('mysql2/promise');
require('dotenv').config();

async function listDocs() {
  const conn = await mysql.createConnection({
    host: process.env.MYSQL_PRIMARY_HOST,
    port: parseInt(process.env.MYSQL_PRIMARY_PORT || '3306'),
    user: process.env.MYSQL_USER,
    password: process.env.MYSQL_PASSWORD,
    database: process.env.MYSQL_DATABASE,
  });

  const [rows] = await conn.execute(`
    SELECT doc_id, name, parsing_status, parsing_progress, chunk_count, ingested_at 
    FROM kb_documents 
    ORDER BY ingested_at DESC
    LIMIT 10
  `);

  console.log('Recent documents:');
  console.log('doc_id                                    name                     status       progress  chunks  ingested');
  console.log('--------------------------------------------------------------------------------');
  rows.forEach(row => {
    console.log(
      `${row.doc_id.padEnd(40)} ` +
      `${(row.name || '').padEnd(25).substring(0,25)} ` +
      `${(row.parsing_status || '').padEnd(12)} ` +
      `${row.parsing_progress || 0}%      ` +
      `${row.chunk_count || 0}      ` +
      `${new Date(row.ingested_at).toLocaleTimeString()}`
    );
  });

  // Check knowledge graph
  const [graphNodes] = await conn.execute(`
    SELECT COUNT(*) as cnt FROM kb_graph_nodes
  `);
  console.log(`\nTotal nodes in kb_graph_nodes: ${graphNodes[0].cnt}`);

  const [graphEdges] = await conn.execute(`
    SELECT COUNT(*) as cnt FROM kb_graph_edges
  `);
  console.log(`Total edges in kb_graph_edges: ${graphEdges[0].cnt}`);

  await conn.end();
}

listDocs().catch(console.error);
