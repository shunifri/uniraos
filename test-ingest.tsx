import { getKnowledgeBase } from './src/skills/knowledge-skills';
import { parseDocument } from './src/services/doc-parser';
import 'dotenv/config';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// 加载 .env.local
import { loadEnvFile } from 'process';
loadEnvFile(join(__dirname, '.env.local'));

async function main() {
  console.log('=== Testing kb.ingest with placeholder ===');

  try {
    // 获取知识库实例
    const userId = 'user_admin';
    const kb = getKnowledgeBase(userId);

    // 第一步：创建占位文档
    console.log('1. Creating placeholder...');
    const docId = await kb.createPlaceholder('测试文档.docx');
    console.log('   DocId:', docId);

    // 第二步：解析文档
    console.log('2. Parsing document...');
    const result = await parseDocument(
      'uploads/user_admin/集团化数据中台建设方案_1776000176188.docx',
      null,
      []
    );

    if (!result.success) {
      throw new Error(`Document parsing failed: ${result.error}`);
    }

    // 第三步：调用 ingest 方法，使用占位文档模式
    console.log('3. Calling ingest with placeholder...');
    const ingestResult = await kb.ingest('测试文档.docx', result.content, {
      _placeholderDocId: docId,
    });

    console.log('=== Ingest Result ===');
    console.log('DocId:', ingestResult.docId);
    console.log('ChunkCount:', ingestResult.chunkCount);
    console.log('TotalTokens:', ingestResult.totalTokens);
    console.log('Updated:', ingestResult.updated);
    console.log('Version:', ingestResult.version);

    console.log('=== Success ===');
    console.log('Document has been ingested with placeholder mode');

  } catch (error) {
    console.error('=== Error ===');
    console.error(error);

    // 输出堆栈跟踪以更好地定位问题
    if (error instanceof Error) {
      console.error('\n=== Stack Trace ===');
      console.error(error.stack);
    }
  }
}

main().catch(console.error);
