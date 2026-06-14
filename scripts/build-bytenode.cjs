#!/usr/bin/env node
/**
 * RAOS 后端 bytenode 字节码编译脚本
 *
 * 将 dist/ 下所有 JS 编译为 .jsc，替换 .js 为 loader stub，
 * 删除源码，最终只保留字节码 + node_modules + 资源文件。
 */

const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");
const { transformSync } = require("@babel/core");

const DIST_DIR = path.resolve(__dirname, "../dist");
const ROOT_DIR = path.resolve(__dirname, "..");

const ENTRY_FILES = ["server.js", "workers/index.js"];

function esmToCjs(filePath) {
  const code = fs.readFileSync(filePath, "utf8");
  const result = transformSync(code, {
    presets: [["@babel/preset-env", { targets: { node: "20" } }]],
    filename: filePath,
  });
  let cjs = result.code;

  // 计算该文件在容器中的实际 file:// URL（用于 import.meta.url 替换）
  const relativePath = path.relative(DIST_DIR, filePath).replace(/\\/g, "/");
  const fileUrl = '"file:///app/dist/' + relativePath + '"';

  // 处理 fileURLToPath(import.meta.url) 模式
  cjs = cjs.replace(/fileURLToPath\(import\.meta\.url\)/g, "__filename");

  // 替换所有 import.meta.url 为正确的文件 URL
  cjs = cjs.replace(/import\.meta\.url/g, fileUrl);

  // 清理 babel 转译后的冗余 fileURLToPath 调用（已传入本地路径字符串，无需再转换）
  const escapedUrl = fileUrl.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  cjs = cjs.replace(
    new RegExp(`\\(0, _url\\.fileURLToPath\\)\\(${escapedUrl}\\)`, "g"),
    "__filename"
  );
  cjs = cjs.replace(
    new RegExp(`_url\\.fileURLToPath\\(${escapedUrl}\\)`, "g"),
    "__filename"
  );

  return cjs;
}

function wrapTopLevelAwait(code) {
  const lines = code.split("\n");
  const headerLines = [];
  const bodyLines = [];
  let inHeader = true;

  for (const line of lines) {
    const trimmed = line.trim();
    if (inHeader) {
      if (
        trimmed === "" ||
        trimmed.startsWith("//") ||
        trimmed.startsWith("/*") ||
        trimmed.startsWith("*") ||
        trimmed.startsWith('"use strict"') ||
        trimmed.startsWith("'use strict'") ||
        trimmed.startsWith("require(") ||
        trimmed.startsWith("var ") ||
        trimmed.startsWith("const ") ||
        trimmed.startsWith("let ") ||
        trimmed.startsWith("function ") ||
        trimmed.startsWith("_interop") ||
        trimmed.startsWith("Object.defineProperty") ||
        trimmed.startsWith("exports.") ||
        trimmed.startsWith("module.exports")
      ) {
        headerLines.push(line);
      } else {
        inHeader = false;
        bodyLines.push(line);
      }
    } else {
      bodyLines.push(line);
    }
  }

  while (bodyLines.length > 0 && bodyLines[bodyLines.length - 1].trim() === "") {
    bodyLines.pop();
  }

  if (bodyLines.length === 0) return code;

  return [
    ...headerLines,
    "",
    "async function __main() {",
    ...bodyLines.map((l) => "  " + l),
    "}",
    "",
    "__main().catch((err) => {",
    "  console.error('Unhandled error in main:', err);",
    "  process.exit(1);",
    "});",
    "",
  ].join("\n");
}

function processAllJs(dir) {
  for (const entry of fs.readdirSync(dir)) {
    const fullPath = path.join(dir, entry);
    const stat = fs.statSync(fullPath);
    if (stat.isDirectory()) {
      processAllJs(fullPath);
    } else if (entry.endsWith(".js")) {
      const relativePath = path.relative(DIST_DIR, fullPath);
      const isEntry = ENTRY_FILES.some(
        (e) => relativePath === e || relativePath.endsWith("/" + e)
      );
      let cjs = esmToCjs(fullPath);
      if (isEntry) {
        console.log(`[bytenode] ${relativePath} → wrapping top-level await`);
        cjs = wrapTopLevelAwait(cjs);
      } else {
        console.log(`[bytenode] ${relativePath}`);
      }
      fs.writeFileSync(fullPath, cjs, "utf8");
    }
  }
}

function compileAndStub(dir) {
  for (const entry of fs.readdirSync(dir)) {
    const fullPath = path.join(dir, entry);
    const stat = fs.statSync(fullPath);
    if (stat.isDirectory()) {
      compileAndStub(fullPath);
    } else if (entry.endsWith(".js") && !entry.includes("worker-sandbox-worker")) {
      const jscPath = fullPath.replace(/\.js$/, ".jsc");
      let relativeJsc = path.relative(path.dirname(fullPath), jscPath);
      if (!relativeJsc.startsWith(".")) relativeJsc = "./" + relativeJsc;
      console.log(`[bytenode] compile ${path.relative(DIST_DIR, fullPath)} → .jsc`);
      execSync(
        `node -e "require('bytenode').compileFile('${fullPath}', '${jscPath}')"`,
        { cwd: ROOT_DIR, stdio: "inherit" }
      );
      const stub = `require("bytenode");\nmodule.exports = require("${relativeJsc}");\n`;
      fs.writeFileSync(fullPath, stub, "utf8");
    }
  }
}

function deleteMaps(dir) {
  for (const entry of fs.readdirSync(dir)) {
    const fullPath = path.join(dir, entry);
    const stat = fs.statSync(fullPath);
    if (stat.isDirectory()) {
      deleteMaps(fullPath);
    } else if (entry.endsWith(".js.map")) {
      fs.unlinkSync(fullPath);
    }
  }
}

console.log("[bytenode] ====== RAOS 后端字节码编译开始 ======");

// 1. 复制资源
console.log("[bytenode] 复制资源文件...");
if (fs.existsSync("src/db/migrations")) {
  execSync("mkdir -p dist/db/migrations && cp src/db/migrations/*.sql dist/db/migrations/", { cwd: ROOT_DIR });
}
if (fs.existsSync("src/ui")) {
  execSync("cp -r src/ui dist/ui", { cwd: ROOT_DIR });
}

// 2. 预处理
console.log("[bytenode] 预处理 ESM → CJS...");
processAllJs(DIST_DIR);

// 3. 编译 + stub
console.log("[bytenode] 编译字节码并生成 loader stub...");
compileAndStub(DIST_DIR);

// 4. 删除 sourcemap
console.log("[bytenode] 删除 sourcemap...");
deleteMaps(DIST_DIR);

// 5. 生成入口 loader
console.log("[bytenode] 生成入口 loader...");
fs.writeFileSync(
  path.join(ROOT_DIR, "server-loader.cjs"),
  '#!/usr/bin/env node\nrequire("./dist/server.js");\n'
);
fs.writeFileSync(
  path.join(ROOT_DIR, "worker-loader.cjs"),
  '#!/usr/bin/env node\nrequire("./dist/workers/index.js");\n'
);

// 6. 修改 package.json type（CJS stub 需要 CommonJS 环境）
console.log("[bytenode] 修改 package.json → type: commonjs");
const pkgPath = path.join(ROOT_DIR, "package.json");
const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8"));
pkg.type = "commonjs";
fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + "\n", "utf8");

// 7. 清理源码
console.log("[bytenode] 清理源码...");
execSync("rm -rf src web/src web/public tsconfig.json web/tsconfig.json", { cwd: ROOT_DIR });
execSync("find dist -name '*.d.ts' -delete", { cwd: ROOT_DIR });

console.log("[bytenode] ====== 编译完成 ======");
console.log("  启动后端: node server-loader.cjs");
console.log("  启动 Worker: node worker-loader.cjs");
