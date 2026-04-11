/**
 * 简单负载测试脚本 (ES Module)
 */

import http from 'http';
import { performance } from 'perf_hooks';

const BASE_URL = process.env.BASE_URL || 'http://localhost:8081';
const CONCURRENT_USERS = parseInt(process.env.CONCURRENT_USERS) || 10;
const REQUESTS_PER_USER = parseInt(process.env.REQUESTS_PER_USER) || 50;

class LoadTester {
  constructor() {
    this.results = [];
    this.errors = 0;
    this.startTime = null;
  }

  async makeRequest(path) {
    return new Promise((resolve) => {
      const start = performance.now();
      const url = new URL(path, BASE_URL);
      
      const req = http.get(url, (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => {
          const duration = performance.now() - start;
          resolve({
            status: res.statusCode,
            duration,
            success: res.statusCode === 200,
          });
        });
      });

      req.on('error', () => {
        resolve({ status: 0, duration: 0, success: false });
      });

      req.setTimeout(5000, () => {
        req.destroy();
        resolve({ status: 0, duration: 5000, success: false });
      });
    });
  }

  async runUser(userId) {
    for (let i = 0; i < REQUESTS_PER_USER; i++) {
      const result = await this.makeRequest('/');
      this.results.push(result);
      if (!result.success) this.errors++;
    }
  }

  async run() {
    console.log(`=== 负载测试开始 ===`);
    console.log(`目标: ${BASE_URL}`);
    console.log(`并发用户: ${CONCURRENT_USERS}`);
    console.log(`每用户请求: ${REQUESTS_PER_USER}`);
    console.log(`总请求: ${CONCURRENT_USERS * REQUESTS_PER_USER}`);
    console.log('');

    this.startTime = performance.now();

    const users = [];
    for (let i = 0; i < CONCURRENT_USERS; i++) {
      users.push(this.runUser(i));
    }

    await Promise.all(users);

    const totalTime = performance.now() - this.startTime;
    this.printReport(totalTime);
  }

  printReport(totalTime) {
    const successful = this.results.filter(r => r.success);
    const durations = successful.map(r => r.duration);
    const avgDuration = durations.reduce((a, b) => a + b, 0) / durations.length || 0;
    const minDuration = durations.length > 0 ? Math.min(...durations) : 0;
    const maxDuration = durations.length > 0 ? Math.max(...durations) : 0;
    const sortedDurations = durations.sort((a, b) => a - b);
    const p95 = sortedDurations[Math.floor(durations.length * 0.95)] || 0;

    console.log('=== 测试结果 ===');
    console.log(`总耗时: ${(totalTime / 1000).toFixed(2)}s`);
    console.log(`成功请求: ${successful.length}`);
    console.log(`失败请求: ${this.errors}`);
    console.log(`成功率: ${((successful.length / this.results.length) * 100).toFixed(2)}%`);
    console.log(`RPS: ${(this.results.length / (totalTime / 1000)).toFixed(2)}`);
    console.log('');
    console.log('延迟统计:');
    console.log(`  平均: ${avgDuration.toFixed(2)}ms`);
    console.log(`  最小: ${minDuration.toFixed(2)}ms`);
    console.log(`  最大: ${maxDuration.toFixed(2)}ms`);
    console.log(`  P95:  ${p95.toFixed(2)}ms`);
    console.log('');

    if (avgDuration > 500) {
      console.log('⚠️  警告: 平均延迟超过 500ms');
    }
    if (this.errors / this.results.length > 0.01) {
      console.log('⚠️  警告: 错误率超过 1%');
    }
  }
}

const tester = new LoadTester();
tester.run().catch(console.error);
