import { getGlobalExecutionEngine } from './src/engine/execution-engine.js';

const engine = getGlobalExecutionEngine();
if (!engine) {
  console.error('Engine not available');
  process.exit(1);
}

async function test() {
  try {
    const result = await engine.execute('skill_from_description', {
      name: 'test_skill_debug',
      description: 'A simple test skill that returns hello world',
      autoRegister: false,
    });
    console.log('Success:', result.success);
    console.log('Data:', JSON.stringify(result.data, null, 2));
    console.log('Error:', result.error);
  } catch (err: any) {
    console.error('Exception:', err.message);
  }
  process.exit(0);
}

test();
