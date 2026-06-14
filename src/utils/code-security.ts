/**
 * Code Security Analyzer
 *
 * 使用 acorn AST 解析对 LLM 生成的 Skill 代码进行静态安全分析。
 * 替代简单的字符串匹配，防止绕过。
 */

import { parse, type Node } from "acorn";

export interface SecurityScanResult {
  safe: boolean;
  violations: string[];
}

// 禁止调用的函数名（不区分大小写）
const FORBIDDEN_CALLS = new Set([
  "require", "import", "eval", "function", "settimeout", "setinterval",
  "cleartimeout", "clearinterval", "fetch", "xmlhttprequest", "websocket",
  "child_process", "fs", "os", "path", "http", "https", "net", "dgram",
  "cluster", "worker_threads", "vm", "crypto",
]);

// 禁止的全局变量/属性访问路径
const FORBIDDEN_IDENTIFIERS = new Set([
  "process", "global", "globalThis", "window", "document", "navigator",
  "require", "module", "exports", "__dirname", "__filename",
  "setTimeout", "setInterval", "clearTimeout", "clearInterval",
  "fetch", "WebSocket", "XMLHttpRequest",
  // 注意：console 已从列表移除，因为 Worker 沙箱中已提供 console 对象
]);

// 禁止的 AST 节点类型
const FORBIDDEN_NODE_TYPES = new Set([
  "ImportDeclaration",
  "ExportNamedDeclaration",
  "ExportDefaultDeclaration",
  "ExportAllDeclaration",
  "WithStatement",
  "LabeledStatement",
  "DebuggerStatement",
  // 注意：AwaitExpression/NewExpression/TryStatement/ThrowStatement 已移除，
  // 因为 LLM 生成的 Skill 代码需要 async/await、new Date/Error、try/catch 等正常语法
]);

function collectViolations(node: Node, violations: string[]): void {
  // 检查禁止的节点类型
  if (FORBIDDEN_NODE_TYPES.has(node.type)) {
    violations.push(`禁止的语法: ${node.type}`);
    return; // 不递归进入子节点，避免重复报告
  }

  // 检查函数调用
  if (node.type === "CallExpression") {
    const callee = (node as any).callee;
    let name = "";
    if (callee.type === "Identifier") {
      name = callee.name;
    } else if (callee.type === "MemberExpression") {
      // 提取 MemberExpression 的最右端属性名
      if (callee.property.type === "Identifier") {
        name = callee.property.name;
      } else if (callee.property.type === "Literal") {
        name = String(callee.property.value);
      }
    }
    if (name && FORBIDDEN_CALLS.has(name.toLowerCase())) {
      violations.push(`禁止的函数调用: ${name}`);
    }
  }

  // 检查标识符引用
  if (node.type === "Identifier") {
    if (FORBIDDEN_IDENTIFIERS.has((node as any).name)) {
      violations.push(`禁止的标识符: ${(node as any).name}`);
    }
  }

  // 递归检查子节点
  for (const key of Object.keys(node)) {
    const child = (node as any)[key];
    if (child && typeof child === "object") {
      if (Array.isArray(child)) {
        for (const item of child) {
          if (item && typeof item === "object" && item.type) {
            collectViolations(item as Node, violations);
          }
        }
      } else if (child.type) {
        collectViolations(child as Node, violations);
      }
    }
  }
}

/**
 * 扫描代码字符串，返回安全分析结果
 */
export function scanCode(code: string): SecurityScanResult {
  const violations: string[] = [];

  try {
    const ast = parse(code, {
      ecmaVersion: 2022,
      sourceType: "script",
      allowReturnOutsideFunction: true,
      allowImportExportEverywhere: false,
    });
    collectViolations(ast, violations);
  } catch (parseErr: any) {
    violations.push(`语法解析失败: ${parseErr.message}`);
  }

  // 额外的字符串级检查（捕获 acorn 可能遗漏的字符串拼接绕过）
  const lower = code.toLowerCase();
  // 注意：constructor+function 组合极易误报（如注释、字符串字面量），已移除
  if (lower.includes("reflect") && lower.includes("get")) {
    violations.push("可疑模式: Reflect.get（可能用于绕过安全检查）");
  }
  if (lower.includes("object") && lower.includes("defineproperty")) {
    violations.push("可疑模式: Object.defineProperty（可能用于篡改全局对象）");
  }

  return {
    safe: violations.length === 0,
    violations: [...new Set(violations)], // 去重
  };
}
