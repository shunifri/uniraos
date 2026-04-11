import http from 'k6/http';
import { check, sleep, group } from 'k6';
import { Rate, Trend, Counter } from 'k6/metrics';

// Custom metrics
const errorRate = new Rate('errors');
const apiLatency = new Trend('api_latency');
const dbQueryTime = new Trend('db_query_time');

// Test configuration
export const options = {
  stages: [
    // Ramp up from 0 to 50 users over 2 minutes
    { duration: '2m', target: 50 },
    // Stay at 50 users for 5 minutes
    { duration: '5m', target: 50 },
    // Spike to 100 users over 2 minutes
    { duration: '2m', target: 100 },
    // Stay at 100 users for 5 minutes
    { duration: '5m', target: 100 },
    // Ramp down to 0 over 2 minutes
    { duration: '2m', target: 0 },
  ],
  thresholds: {
    // 95% of requests should complete within 500ms
    http_req_duration: ['p(95)<500'],
    // Error rate should be less than 1%
    http_req_failed: ['rate<0.01'],
    // 95% of API latency should be under 200ms
    api_latency: ['p(95)<200'],
  },
};

const BASE_URL = __ENV.BASE_URL || 'http://localhost:3000';

export function setup() {
  // Login and get token
  const loginRes = http.post(`${BASE_URL}/api/auth/login`, JSON.stringify({
    username: 'admin',
    password: 'admin',
  }), {
    headers: { 'Content-Type': 'application/json' },
  });
  
  const token = loginRes.json('token');
  return { token };
}

export default function (data) {
  const headers = {
    'Authorization': `Bearer ${data.token}`,
    'Content-Type': 'application/json',
  };

  group('Health Checks', () => {
    const res = http.get(`${BASE_URL}/health`);
    const success = check(res, {
      'health status is 200': (r) => r.status === 200,
      'health response time < 100ms': (r) => r.timings.duration < 100,
    });
    errorRate.add(!success);
    apiLatency.add(res.timings.duration);
  });

  group('API Endpoints', () => {
    // GET /api/config
    let res = http.get(`${BASE_URL}/api/config`, { headers });
    let success = check(res, {
      'config status is 200': (r) => r.status === 200,
      'config response time < 200ms': (r) => r.timings.duration < 200,
    });
    errorRate.add(!success);
    apiLatency.add(res.timings.duration);

    // GET /api/skills
    res = http.get(`${BASE_URL}/api/skills`, { headers });
    success = check(res, {
      'skills status is 200': (r) => r.status === 200,
      'skills response time < 300ms': (r) => r.timings.duration < 300,
    });
    errorRate.add(!success);
    apiLatency.add(res.timings.duration);
  });

  group('Knowledge Base Search', () => {
    const searchPayload = JSON.stringify({
      query: 'test query',
      limit: 10,
    });
    
    const res = http.post(`${BASE_URL}/api/knowledge/search`, searchPayload, { headers });
    const success = check(res, {
      'search status is 200': (r) => r.status === 200,
      'search response time < 500ms': (r) => r.timings.duration < 500,
    });
    errorRate.add(!success);
    dbQueryTime.add(res.timings.duration);
  });

  sleep(1);
}

export function teardown(data) {
  // Cleanup if needed
  console.log('Test completed');
}
