
import 'dotenv/config';
import { getParsingQueue } from './src/services/parsing-queue.ts';
import { getKnowledgeBase } from './src/skills/knowledge-skills.ts';
import { existsSync } from 'fs';

const docId = 'doc_1776003143409_ufljf9';
const docName = '集团化数据中台建设方案.docx';
const owner = 'user_admin';
const filePath = '/Users/liukavin/Documents/raos/.raos/uploads/doc_1776003143409_ufljf9.docx';

async function testQueue() {
  const queue = getParsingQueue();
  const kb = getKnowledgeBase(owner);

  console.log('=== Testing Queue Processing ===');
  console.log('DocId:', docId);
  console.log('DocName:', docName);
  console.log('FilePath exists:', existsSync(filePath));

  // Check if document exists in database
  const doc = await kb.getDocument(docId);
  console.log('\nDocument in database:', JSON.stringify({
    doc_id: doc.doc_id,
    name: doc.name,
    parsing_status: doc.parsing_status,
    parsing_progress: doc.parsing_progress,
    chunk_count: doc.chunk_count,
  }, null, 2));

  // Check queue status
  const task = queue.getTask(docId);
  console.log('\nTask in queue:', task ? {
    status: task.status,
    progress: task.progress,
    processedSegments: task.processedSegments,
  } : 'NOT FOUND IN QUEUE');

  console.log('\nQueue stats:', {
    totalTasks: queue.tasks.size,
    processing: queue.processing.size,
  });
}

testQueue().catch(console.error);
