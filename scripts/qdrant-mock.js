/**
 * Qdrant Mock Server
 * 用于开发和测试环境，当真实 Qdrant 不可用时
 */

const http = require('http');
const url = require('url');

const PORT = 6333;

// 内存存储
const collections = new Map();
const points = new Map();

const server = http.createServer((req, res) => {
  const parsedUrl = url.parse(req.url, true);
  const path = parsedUrl.pathname;
  const method = req.method;

  // 设置 CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Content-Type', 'application/json');

  let body = '';
  req.on('data', chunk => body += chunk);
  req.on('end', () => {
    try {
      const data = body ? JSON.parse(body) : {};
      
      // 健康检查
      if (path === '/healthz' && method === 'GET') {
        res.writeHead(200);
        res.end(JSON.stringify({ status: 'ok' }));
        return;
      }

      // 获取集合列表
      if (path === '/collections' && method === 'GET') {
        res.writeHead(200);
        res.end(JSON.stringify({
          result: { collections: Array.from(collections.keys()).map(name => ({ name })) }
        }));
        return;
      }

      // 创建集合
      const collectionMatch = path.match(/\/collections\/([^\/]+)$/);
      if (collectionMatch && method === 'PUT') {
        const name = collectionMatch[1];
        collections.set(name, data);
        points.set(name, new Map());
        res.writeHead(200);
        res.end(JSON.stringify({ result: true, status: 'ok' }));
        return;
      }

      // 获取集合信息
      if (collectionMatch && method === 'GET') {
        const name = collectionMatch[1];
        const collectionPoints = points.get(name) || new Map();
        res.writeHead(200);
        res.end(JSON.stringify({
          result: {
            status: 'green',
            points_count: collectionPoints.size,
            vectors_count: collectionPoints.size,
          }
        }));
        return;
      }

      // 插入/更新点
      const pointsMatch = path.match(/\/collections\/([^\/]+)\/points$/);
      if (pointsMatch && method === 'PUT') {
        const name = pointsMatch[1];
        const collectionPoints = points.get(name);
        if (collectionPoints && data.points) {
          for (const point of data.points) {
            collectionPoints.set(point.id, point);
          }
        }
        res.writeHead(200);
        res.end(JSON.stringify({ result: { operation_id: Date.now() }, status: 'ok' }));
        return;
      }

      // 搜索
      const searchMatch = path.match(/\/collections\/([^\/]+)\/points\/search$/);
      if (searchMatch && method === 'POST') {
        const name = searchMatch[1];
        const collectionPoints = points.get(name);
        const results = [];
        
        if (collectionPoints) {
          // 简单的模拟搜索：返回所有点，按 ID 排序
          let idx = 0;
          for (const [id, point] of collectionPoints) {
            if (idx >= (data.limit || 10)) break;
            results.push({
              id,
              version: 0,
              score: 0.9 - (idx * 0.01),
              payload: point.payload || {},
            });
            idx++;
          }
        }

        res.writeHead(200);
        res.end(JSON.stringify({ result: results, status: 'ok' }));
        return;
      }

      // 删除点
      const deleteMatch = path.match(/\/collections\/([^\/]+)\/points\/delete$/);
      if (deleteMatch && method === 'POST') {
        const name = deleteMatch[1];
        const collectionPoints = points.get(name);
        if (collectionPoints && data.points) {
          for (const id of data.points) {
            collectionPoints.delete(id);
          }
        }
        res.writeHead(200);
        res.end(JSON.stringify({ result: true, status: 'ok' }));
        return;
      }

      // 默认 404
      res.writeHead(404);
      res.end(JSON.stringify({ status: { error: 'Not found' } }));
    } catch (error) {
      res.writeHead(500);
      res.end(JSON.stringify({ status: { error: error.message } }));
    }
  });
});

server.listen(PORT, () => {
  console.log(`✅ Qdrant Mock Server running on port ${PORT}`);
  console.log('⚠️  注意: 这是模拟服务，仅用于开发和测试');
  console.log('   生产环境请使用真实的 Qdrant 服务');
});

// 优雅关闭
process.on('SIGINT', () => {
  console.log('\nShutting down Qdrant Mock Server...');
  server.close(() => {
    process.exit(0);
  });
});
