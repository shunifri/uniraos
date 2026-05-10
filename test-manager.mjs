import { KnowledgeGraphManager } from './src/memory/knowledge-graph/manager.js';
import { getMySQLAdapter } from './src/db/mysql-adapter.js';

async function test() {
  const owner = 'kgm_test_owner';
  const adapter = getMySQLAdapter();
  await adapter.execute(
    `INSERT INTO users (id, username, password_hash, status) VALUES (?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE username = VALUES(username)`,
    [owner, 'kgm_test_user', 'test_hash', 1]
  );
  
  const manager = new KnowledgeGraphManager(owner);
  const store = await manager.getStore();
  await store.clearGraph();
  
  console.log('Before onFactStored 1 - nodes:', await store.countNodes(), 'edges:', await store.countEdges());
  await manager.onFactStored({ id: '1', key: 'dark_mode', value: 'enabled', tags: ['ui'] });
  console.log('After onFactStored 1 - nodes:', await store.countNodes(), 'edges:', await store.countEdges());
  
  console.log('Before onFactStored 2 - nodes:', await store.countNodes(), 'edges:', await store.countEdges());
  await manager.onFactStored({ id: '2', key: 'user_theme', value: 'custom', tags: ['ui'], relation: 'dark_mode' });
  console.log('After onFactStored 2 - nodes:', await store.countNodes(), 'edges:', await store.countEdges());
  
  const edges = await store.getEdgesOf('2');
  console.log('Edges of node 2:', edges);
  
  await store.clearGraph();
  process.exit(0);
}

test().catch(err => { console.error(err); process.exit(1); });
