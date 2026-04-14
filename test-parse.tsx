import { parseDocument } from './src/services/doc-parser';

async function main() {
  console.log('=== Testing parseDocument ===');

  try {
    // 测试 parseDocument 函数 - 不使用视觉模型配置
    const result = await parseDocument(
      'uploads/user_admin/集团化数据中台建设方案_1776000176188.docx',
      null,
      []
    );

    console.log('=== Parse Result ===');
    console.log('Success:', result.success);
    if (result.success) {
      console.log('Format:', result.format);
      console.log('Content Length:', result.content.length);
      console.log('Pages:', result.pages?.length);
      console.log('First 500 characters:', result.content.slice(0, 500));
      if (result.tags) {
        console.log('Tags:', result.tags);
      }
    } else {
      console.log('Error:', result.error);
    }

  } catch (error) {
    console.error('=== Uncaught Exception ===');
    console.error(error);
  }
}

main().catch(console.error);
