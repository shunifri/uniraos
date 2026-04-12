const mysql = require('mysql2/promise');

(async () => {
  const conn = await mysql.createConnection({
    host: 'localhost',
    port: 3307,
    user: 'raos',
    password: 'raos',
    database: 'raos'
  });
  
  const createNodes = `
CREATE TABLE IF NOT EXISTS kb_graph_nodes (
  id varchar(128) NOT NULL,
  owner_id varchar(64) NOT NULL,
  label varchar(256) NOT NULL,
  type varchar(64) NOT NULL,
  tags json NOT NULL,
  properties json NOT NULL,
  created_at bigint NOT NULL,
  PRIMARY KEY (id, owner_id),
  INDEX idx_kb_graph_nodes_owner (owner_id) COMMENT '所有者索引',
  INDEX idx_kb_graph_nodes_label (owner_id, label) COMMENT '标签查询索引',
  INDEX idx_kb_graph_nodes_type (owner_id, type) COMMENT '类型索引'
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
`;
  
  const createEdges = `
CREATE TABLE IF NOT EXISTS kb_graph_edges (
  id varchar(128) NOT NULL,
  owner_id varchar(64) NOT NULL,
  source_id varchar(128) NOT NULL,
  target_id varchar(128) NOT NULL,
  type varchar(64) NOT NULL,
  label varchar(128),
  weight double NOT NULL DEFAULT 1.0,
  created_at bigint NOT NULL,
  PRIMARY KEY (id, owner_id),
  INDEX idx_kb_graph_edges_owner (owner_id) COMMENT '所有者索引',
  INDEX idx_kb_graph_edges_source (owner_id, source_id) COMMENT '源节点索引',
  INDEX idx_kb_graph_edges_target (owner_id, target_id) COMMENT '目标节点索引',
  FOREIGN KEY (source_id) REFERENCES kb_graph_nodes(id) ON DELETE CASCADE,
  FOREIGN KEY (target_id) REFERENCES kb_graph_nodes(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
`;
  
  await conn.execute(createNodes);
  console.log('✓ Created kb_graph_nodes table');
  await conn.execute(createEdges);
  console.log('✓ Created kb_graph_edges table');
  await conn.end();
})();
