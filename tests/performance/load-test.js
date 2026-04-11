/**
 * RAOS Load Test Script
 * 
 * Usage:
 *   # Install k6: https://k6.io/docs/get-started/installation/
 *   
 *   # Run with default settings
 *   k6 run tests/performance/k6-script.js
 *   
 *   # Run with custom base URL
 *   BASE_URL=http://your-server:3000 k6 run tests/performance/k6-script.js
 *   
 *   # Run with specific virtual users
 *   k6 run --vus 50 --duration 5m tests/performance/k6-script.js
 *   
 *   # Run in cloud
 *   k6 cloud tests/performance/k6-script.js
 */

const { execSync } = require('child_process');
const path = require('path');

const K6_SCRIPT = path.join(__dirname, 'k6-script.js');

function runLoadTest(options = {}) {
  const {
    vus = 50,
    duration = '5m',
    baseUrl = 'http://localhost:3000',
  } = options;

  console.log(`Starting load test with ${vus} VUs for ${duration}`);
  console.log(`Target: ${baseUrl}`);

  try {
    execSync(
      `k6 run --vus ${vus} --duration ${duration} -e BASE_URL=${baseUrl} ${K6_SCRIPT}`,
      { stdio: 'inherit' }
    );
  } catch (error) {
    console.error('Load test failed:', error.message);
    process.exit(1);
  }
}

function runStressTest(baseUrl = 'http://localhost:3000') {
  console.log('Starting stress test...');
  
  try {
    execSync(
      `k6 run -e BASE_URL=${baseUrl} ${K6_SCRIPT}`,
      { stdio: 'inherit' }
    );
  } catch (error) {
    console.error('Stress test failed:', error.message);
    process.exit(1);
  }
}

function runSmokeTest(baseUrl = 'http://localhost:3000') {
  console.log('Starting smoke test...');
  
  try {
    execSync(
      `k6 run --vus 5 --duration 30s -e BASE_URL=${baseUrl} ${K6_SCRIPT}`,
      { stdio: 'inherit' }
    );
  } catch (error) {
    console.error('Smoke test failed:', error.message);
    process.exit(1);
  }
}

// CLI
if (require.main === module) {
  const command = process.argv[2] || 'load';
  const baseUrl = process.argv[3] || 'http://localhost:3000';

  switch (command) {
    case 'smoke':
      runSmokeTest(baseUrl);
      break;
    case 'load':
      runLoadTest({ baseUrl });
      break;
    case 'stress':
      runStressTest(baseUrl);
      break;
    default:
      console.log('Usage: node load-test.js [smoke|load|stress] [baseUrl]');
      process.exit(1);
  }
}

module.exports = { runLoadTest, runStressTest, runSmokeTest };
