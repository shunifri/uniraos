
import 'dotenv/config';
import { getParsingQueue } from './src/services/parsing-queue.ts';

async function checkQueue() {
  const queue = getParsingQueue();
  if (!queue) {
    console.log('ParsingQueue not initialized');
    return;
  }

  console.log('=== Queue Status ===');
  console.log('Total tasks in queue:', queue.tasks.size);
  console.log('Processing tasks:', queue.processing.size);

  for (const [docId, task] of queue.tasks.entries()) {
    console.log(`\nTask: ${docId}`);
    console.log(`  Name: ${task.docName}`);
    console.log(`  Status: ${task.status}`);
    console.log(`  Progress: ${task.progress}%`);
    console.log(`  Processed segments: ${task.processedSegments}`);
  }
}

checkQueue().catch(console.error);
