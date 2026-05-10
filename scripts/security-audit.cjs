#!/usr/bin/env node
/**
 * Security Audit Script
 * Scans src/ for dangerous dynamic code execution patterns
 */

const fs = require('fs');
const path = require('path');

const SRC_DIR = path.join(__dirname, '..', 'src');

// Patterns to detect
const PATTERNS = [
  {
    id: 'new-function',
    regex: /new\s+Function\s*\(/g,
    severity: 'ERROR',
    message: 'new Function() is dangerous. Use vm.runInNewContext(code, {}, { timeout: 100 }) instead.',
  },
  {
    id: 'eval-call',
    // Match eval( but not in strings, not $$eval/$eval (Puppeteer/Playwright API)
    regex: /(?<!\$)\beval\s*\(/g,
    severity: 'ERROR',
    message: 'eval() is forbidden. Use vm.runInNewContext or JSON.parse instead.',
  },
];

// Whitelist: files that are allowed to use dynamic code (with justification)
const WHITELIST = [
  // Worker sandbox already runs in isolated thread
  'src/engine/worker-sandbox-worker.ts',
];

function* walkDir(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules') continue;
      yield* walkDir(fullPath);
    } else if (entry.name.endsWith('.ts') || entry.name.endsWith('.js')) {
      yield fullPath;
    }
  }
}

function extractStringRanges(line) {
  const ranges = [];
  let inString = false;
  let stringChar = null;
  let start = 0;
  
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    const prev = line[i - 1];
    
    if (!inString && (ch === '"' || ch === "'" || ch === '`')) {
      inString = true;
      stringChar = ch;
      start = i;
    } else if (inString && ch === stringChar && prev !== '\\') {
      ranges.push([start, i]);
      inString = false;
      stringChar = null;
    }
  }
  return ranges;
}

function isInString(line, column) {
  const ranges = extractStringRanges(line);
  return ranges.some(([s, e]) => column > s && column < e);
}

function isCommentLine(line) {
  const trimmed = line.trim();
  return trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('/*');
}

function auditFile(filePath) {
  const relPath = path.relative(path.join(__dirname, '..'), filePath);
  const issues = [];
  
  if (WHITELIST.some(w => relPath.includes(w))) {
    return issues;
  }

  const content = fs.readFileSync(filePath, 'utf-8');
  const lines = content.split('\n');

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (isCommentLine(line)) continue;

    for (const pattern of PATTERNS) {
      let match;
      while ((match = pattern.regex.exec(line)) !== null) {
        const col = match.index + 1;
        if (isInString(line, match.index)) {
          continue; // Skip matches inside string literals
        }
        issues.push({
          severity: pattern.severity,
          file: relPath,
          line: i + 1,
          column: col,
          pattern: pattern.id,
          message: pattern.message,
          code: line.trim(),
        });
      }
      pattern.regex.lastIndex = 0;
    }
  }

  return issues;
}

function main() {
  console.log('Security Audit Report');
  console.log('=====================\n');

  const allIssues = [];
  let filesScanned = 0;

  for (const filePath of walkDir(SRC_DIR)) {
    filesScanned++;
    const issues = auditFile(filePath);
    allIssues.push(...issues);
  }

  console.log(`Files scanned: ${filesScanned}`);
  console.log(`Issues found: ${allIssues.length}\n`);

  if (allIssues.length === 0) {
    console.log('✅ No security issues found. All clean!');
    process.exit(0);
  }

  const errors = allIssues.filter(i => i.severity === 'ERROR');
  const warnings = allIssues.filter(i => i.severity === 'WARN');

  for (const issue of errors) {
    console.log(`[ERROR] ${issue.file}:${issue.line}:${issue.column}`);
    console.log(`  Pattern: ${issue.pattern}`);
    console.log(`  Code:    ${issue.code}`);
    console.log(`  Fix:     ${issue.message}\n`);
  }

  for (const issue of warnings) {
    console.log(`[WARN] ${issue.file}:${issue.line}:${issue.column}`);
    console.log(`  Pattern: ${issue.pattern}`);
    console.log(`  Code:    ${issue.code}`);
    console.log(`  Fix:     ${issue.message}\n`);
  }

  console.log(`\nSummary: ${errors.length} errors, ${warnings.length} warnings`);
  process.exit(errors.length > 0 ? 1 : 0);
}

main();
