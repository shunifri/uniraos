import 'dotenv/config';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { loadEnvFile } from 'process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
loadEnvFile(join(__dirname, '.env.local'));

console.log('Testing document parser...');

// 动态导入 tsx
import { register } from 'node:module';
import { pathToFileURL } from 'node:url';

// 直接用 tsx 来运行 TypeScript 代码
import { execSync } from 'child_process';

try {
  const result = execSync('npx tsx -e "import { parseDocument } from \'./src/services/doc-parser.ts\'; console.log(\'parseDocument loaded\'); const fs = require(\'fs\'); const path = require(\'path\'); const files = fs.readdirSync(\'uploads/user_admin\'); console.log(\'Files in uploads/user_admin:\', files);" 2>&1', {
    cwd: __dirname,
    encoding: 'utf-8'
  });
  console.log(result);
} catch (e) {
  console.error('Error:', e.message);
  console.error('Stderr:', e.stderr);
}
