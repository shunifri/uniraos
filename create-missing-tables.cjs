
const mysql = require('mysql2/promise');
require('dotenv').config();

async function createMissingTables() {
  const conn = await mysql.createConnection({
    host: process.env.MYSQL_PRIMARY_HOST,
    port: parseInt(process.env.MYSQL_PRIMARY_PORT || '3306'),
    user: process.env.MYSQL_USER,
    password: process.env.MYSQL_PASSWORD,
    database: process.env.MYSQL_DATABASE,
  });

  console.log('Connected to MySQL');

  const [tables] = await conn.execute(
    'SELECT table_name FROM information_schema.tables WHERE table_schema = ?',
    [process.env.MYSQL_DATABASE]
  );
  console.log('Existing tables:', tables.map(t => t.table_name).sort());
  console.log('Total existing tables:', tables.length);

  // Create kb_graph_nodes
  console.log('\nCreating kb_graph_nodes...');
  await conn.execute(`
CREATE TABLE IF NOT EXISTS kb_graph_nodes (
  id VARCHAR(64) PRIMARY KEY COMMENT '节点ID',
  owner_id VARCHAR(64) NOT NULL COMMENT '所有者用户ID',
  label VARCHAR(500) NOT NULL COMMENT '节点标签',
  type VARCHAR(50) NOT NULL COMMENT '节点类型',
  tags JSON COMMENT '标签数组（JSON）',
  properties JSON COMMENT '节点属性（JSON）',
  created_at BIGINT NOT NULL DEFAULT (UNIX_TIMESTAMP() * 1000) COMMENT '创建时间（毫秒）',
  INDEX idx_kb_graph_nodes_owner (owner_id) COMMENT '所有者索引',
  INDEX idx_kb_graph_nodes_label (owner_id, label) COMMENT '标签查询索引',
  INDEX idx_kb_graph_nodes_type (owner_id, type) COMMENT '类型索引',
  FOREIGN KEY (owner_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='知识图谱节点表';
  `);

  // Create kb_graph_edges
  console.log('Creating kb_graph_edges...');
  await conn.execute(`
CREATE TABLE IF NOT EXISTS kb_graph_edges (
  id VARCHAR(64) PRIMARY KEY COMMENT '边ID',
  owner_id VARCHAR(64) NOT NULL COMMENT '所有者用户ID',
  source_id VARCHAR(64) NOT NULL COMMENT '源节点ID',
  target_id VARCHAR(64) NOT NULL COMMENT '目标节点ID',
  type VARCHAR(50) NOT NULL COMMENT '边类型',
  label VARCHAR(200) COMMENT '边标签',
  weight DECIMAL(5,4) DEFAULT 1.0 COMMENT '权重（0-1）',
  created_at BIGINT NOT NULL DEFAULT (UNIX_TIMESTAMP() * 1000) COMMENT '创建时间（毫秒）',
  INDEX idx_kb_graph_edges_owner (owner_id) COMMENT '所有者索引',
  INDEX idx_kb_graph_edges_source (owner_id, source_id) COMMENT '源节点索引',
  INDEX idx_kb_graph_edges_target (owner_id, target_id) COMMENT '目标节点索引',
  FOREIGN KEY (source_id) REFERENCES kb_graph_nodes(id) ON DELETE CASCADE,
  FOREIGN KEY (target_id) REFERENCES kb_graph_nodes(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='知识图谱边表';
  `);

  // Create kb_ltm_entries
  console.log('Creating kb_ltm_entries...');
  await conn.execute(`
CREATE TABLE IF NOT EXISTS kb_ltm_entries (
  id VARCHAR(64) PRIMARY KEY COMMENT '记忆ID',
  owner_id VARCHAR(64) NOT NULL COMMENT '所有者用户ID',
  entry_key VARCHAR(500) NOT NULL COMMENT '记忆键',
  value JSON NOT NULL COMMENT '记忆值（JSON）',
  tags JSON COMMENT '标签数组（JSON）',
  source VARCHAR(200) COMMENT '来源',
  summary TEXT COMMENT '摘要',
  access_count INT DEFAULT 0 COMMENT '访问次数',
  created_at BIGINT NOT NULL DEFAULT (UNIX_TIMESTAMP() * 1000) COMMENT '创建时间（毫秒）',
  updated_at BIGINT NOT NULL DEFAULT (UNIX_TIMESTAMP() * 1000) COMMENT '更新时间（毫秒）',
  last_accessed_at BIGINT DEFAULT (UNIX_TIMESTAMP() * 1000) COMMENT '最后访问时间（毫秒）',
  vector BLOB COMMENT '向量数据（二进制）',
  is_archived TINYINT DEFAULT 0 COMMENT '是否已归档（1=是）',
  INDEX idx_kb_ltm_owner (owner_id) COMMENT '所有者索引',
  INDEX idx_kb_ltm_key (owner_id, entry_key) COMMENT '键索引',
  INDEX idx_kb_ltm_access (owner_id, last_accessed_at) COMMENT '访问时间索引',
  INDEX idx_kb_ltm_archived (owner_id, is_archived) COMMENT '归档状态索引',
  FOREIGN KEY (owner_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='长期记忆条目表';
  `);

  console.log('Adding fulltext indexes...');
  try {
    await conn.execute(`ALTER TABLE kb_documents ADD FULLTEXT INDEX ft_idx_kb_documents_name (name) COMMENT '文档名全文索引';`);
    console.log('Added fulltext index to kb_documents');
  } catch (e) {
    console.log('Fulltext index already exists on kb_documents (ignored)');
  }
  try {
    await conn.execute(`ALTER TABLE kb_chunks ADD FULLTEXT INDEX ft_idx_kb_chunks_content (content) COMMENT '分块内容全文索引';`);
    console.log('Added fulltext index to kb_chunks');
  } catch (e) {
    console.log('Fulltext index already exists on kb_chunks (ignored)');
  }

  console.log('\n✅ All missing tables created successfully!');

  const [rows] = await conn.execute('SELECT COUNT(*) as cnt FROM information_schema.tables WHERE table_schema = ?', [process.env.MYSQL_DATABASE]);
  console.log(`Total tables in database after: ${rows[0].cnt}`);

  // List all tables
  const [finalTables] = await conn.execute(
    'SELECT table_name FROM information_schema.tables WHERE table_schema = ? ORDER BY table_name',
    [process.env.MYSQL_DATABASE]
  );
  console.log('\\nAll tables:');
  finalTables.forEach(t => console.log('  -', t.table_name));

  await conn.end();
}

createMissingTables().catch(console.error);
