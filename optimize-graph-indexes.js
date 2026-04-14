#!/usr/bin/env node

/**
 * 知识图谱表索引优化脚本
 * - 为kb_graph_nodes添加复合和覆盖索引
 * - 为kb_graph_edges添加更高效的索引
 * - 优化常用查询模式
 */

const mysql = require('mysql2/promise');
require('dotenv').config({ path: '.env.local' });

async function main() {
  console.log('开始优化知识图谱表索引...');

  try {
    // 创建连接
    const connection = await mysql.createConnection({
      host: process.env.DB_HOST || 'localhost',
      port: parseInt(process.env.DB_PORT || '3307'),
      user: process.env.DB_USER || 'root',
      password: process.env.DB_PASSWORD || 'password',
      database: process.env.DB_NAME || 'raos',
      multipleStatements: true
    });

    // 优化kb_graph_nodes表索引
    console.log('优化 kb_graph_nodes 表索引...');
    await connection.execute(`
      -- 删除旧索引（如果存在）
      DROP INDEX IF EXISTS idx_kb_graph_nodes_label ON kb_graph_nodes;
      DROP INDEX IF EXISTS idx_kb_graph_nodes_type ON kb_graph_nodes;

      -- 添加新的复合和覆盖索引
      CREATE INDEX idx_kb_graph_nodes_owner_type_label ON kb_graph_nodes (owner_id, type, label) COMMENT '类型+标签复合索引';
      CREATE INDEX idx_kb_graph_nodes_owner_created ON kb_graph_nodes (owner_id, created_at) COMMENT '创建时间索引';

      -- 为properties字段添加前缀索引（如果需要查询特定属性）
      -- CREATE INDEX idx_kb_graph_nodes_properties ON kb_graph_nodes (owner_id, (SUBSTRING(properties, 1, 100))) COMMENT '属性前缀索引';
    `);

    // 优化kb_graph_edges表索引
    console.log('优化 kb_graph_edges 表索引...');
    await connection.execute(`
      -- 删除旧索引（如果存在）
      DROP INDEX IF EXISTS idx_kb_graph_edges_source ON kb_graph_edges;
      DROP INDEX IF EXISTS idx_kb_graph_edges_target ON kb_graph_edges;

      -- 添加新的复合和覆盖索引
      CREATE INDEX idx_kb_graph_edges_owner_source_target ON kb_graph_edges (owner_id, source_id, target_id) COMMENT '源→目标覆盖索引';
      CREATE INDEX idx_kb_graph_edges_owner_source_type ON kb_graph_edges (owner_id, source_id, type) COMMENT '源节点+类型索引';
      CREATE INDEX idx_kb_graph_edges_owner_target_type ON kb_graph_edges (owner_id, target_id, type) COMMENT '目标节点+类型索引';

      -- 对于查询邻居节点和度计算的优化索引
      CREATE INDEX idx_kb_graph_edges_owner_s_t ON kb_graph_edges (owner_id, source_id, target_id, weight) COMMENT '邻居查询覆盖索引';
    `);

    console.log('索引优化完成！');

    // 显示当前索引
    console.log('\n=== 当前 kb_graph_nodes 表索引 ===');
    const [nodesIndexes] = await connection.query(`
      SHOW INDEX FROM kb_graph_nodes
    `);
    nodesIndexes.forEach(idx => {
      console.log(`${idx.Key_name} (${idx.Seq_in_index}): ${idx.Column_name}`);
    });

    console.log('\n=== 当前 kb_graph_edges 表索引 ===');
    const [edgesIndexes] = await connection.query(`
      SHOW INDEX FROM kb_graph_edges
    `);
    edgesIndexes.forEach(idx => {
      console.log(`${idx.Key_name} (${idx.Seq_in_index}): ${idx.Column_name}`);
    });

    await connection.end();
    console.log('\n优化脚本执行成功！');

  } catch (error) {
    console.error('优化过程中出错:', error);
  }
}

if (require.main === module) {
  main();
}

module.exports = main;
