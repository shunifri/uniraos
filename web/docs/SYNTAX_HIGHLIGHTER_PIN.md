# `react-syntax-highlighter` 版本固定与升级守则

> Q3 Week 5-8 item #9 · 防止升级 `@ant-design/x` / `react-syntax-highlighter` 时 CodeHighlighter 在 dev 下静默破裂.

## 1. 为什么固定版本

`@ant-design/x@2.4.0` 的 `CodeHighlighter` 组件 (`web/node_modules/@ant-design/x/es/code-highlighter/CodeHighlighter.js:22-42`) 内部用动态 import 加载 prism 语言包:

```js
await import(`react-syntax-highlighter/dist/esm/languages/prism/${lang}`);
```

Vite dev server **不能解析裸 ESM 子路径** (浏览器没有 `require`, Vite SSR 又只处理显式注册的依赖). 所以我们 (`web/vite.config.ts:14-37`) 加了一组 alias regex 把 `dist/esm/...` 子路径重定向到 CJS 兼容的 `dist/cjs/...`, 配合 `optimizeDeps.include` 让 Vite 预构建.

**这层依赖是脆弱的** — 升级以下任一包都可能破坏 alias 模式:

| 升级点 | 风险 | 后果 |
|--------|------|------|
| `react-syntax-highlighter` major | 包内 `dist/` 目录结构可能变 | alias regex 不再匹配, dev server 报 "Failed to resolve module specifier" |
| `@ant-design/x` minor/major | 内部 CodeHighlighter 可能改用新子路径 (e.g. `dist/esm/async-languages/...`) | alias regex 漏匹配 |
| Vite major | `optimizeDeps` 预构建规则可能变, bare import 走 ESM 路径 | bare import 解析失败 |

**Pin 策略**: 直接 dep + `overrides` 双保险, npm 强制版本对齐.

## 2. 当前固定版本

```
react-syntax-highlighter: ~16.1.1   (≥16.1.1 <16.2.0)
```

- `~16.1.1` 允许 patch 升级 (安全修复), 但禁止 minor/major 跳变.
- 实际安装: `web/node_modules/react-syntax-highlighter/package.json` → `"version": "16.1.1"`.
- 触发者: `@ant-design/x@2.4.0` 声明 `"react-syntax-highlighter": "^16.1.0"`, 与 pin 兼容.
- `package.json` 的 `overrides.react-syntax-highlighter` 是兜底, 即使将来 `@ant-design/x` 升级到 `^17.x`, 也会被强制降到 `~16.1.1` (代价是可能类型不兼容, 触发时再处理).

## 3. 手动升级步骤 (必须按顺序)

> **不要**直接改 `~16.1.1` → `^17.0.0`. 先按下面 5 步验证.

### Step 1: 阅读上游 CHANGELOG
`web/node_modules/react-syntax-highlighter/CHANGELOG.MD` 或 https://github.com/react-syntax-highlighter/react-syntax-highlighter/blob/master/CHANGELOG.md

重点关注:
- `dist/` 目录结构变更 (alias regex 依赖这个)
- 默认 export 列表变化 (PrismLight / Prism / Light / LightAsync / PrismAsync / PrismAsyncLight / createElement / default)
- 语言模块格式变化 (function vs array)

### Step 2: 修改 `web/package.json`
```diff
-    "react-syntax-highlighter": "~16.1.1",
+    "react-syntax-highlighter": "~17.x.y",
...
   "overrides": {
-    "react-syntax-highlighter": "~16.1.1"
+    "react-syntax-highlighter": "~17.x.y"
   },
```

### Step 3: 重新安装并核对 lockfile
```bash
cd web
npm install --legacy-peer-deps    # antd 6.x 与 antd-x 2.x peer dep 冲突, 必须 legacy
grep -A2 '"node_modules/react-syntax-highlighter"' package-lock.json | head -5
# 确认 version 字段更新, 但 internal integrity hash 也对得上 (不是 mirror 缓存错版)
```

### Step 4: 跑 smoke test 3 次取分布
```bash
cd web
for i in 1 2 3; do
  npx vitest run tests/code-highlighter-smoke.test.tsx 2>&1 | tail -8
done
```

> **vitest 4.x 无 `--repeat` flag**, 必须 shell loop. 内存记录见 `coder/memory/typescript-vitest-gotchas.md`.

14 个 assertion 全 pass 才算通过. 任何一个 fail 都说明 alias 模式需要更新.

### Step 5: 检查 vite dev 实际渲染
```bash
cd web
npm run dev
# 浏览器打开 http://localhost:9002, 触发 Chat 或 DocMindPreview 里的代码块
# F12 → Network → filter "javascript"
# 应该看到 react-syntax-highlighter 的 cjs chunk 被正确加载, 没有 404
```

### Step 6 (仅当 alias 不再工作): 更新 `vite.config.ts` 和 `vitest.config.ts`

如果新版本改了 `dist/` 结构, regex aliases 需要同步更新:

```ts
// web/vite.config.ts 和 web/vitest.config.ts 都要同步
{
  find: /^react-syntax-highlighter\/dist\/esm\/languages\/prism\/(.+)$/,
  replacement: "react-syntax-highlighter/dist/cjs/languages/prism/$1",
},
// 新加任何 antd-x 引入的新 ESM 子路径
```

### Step 7: 全工程测试
```bash
cd web
npm test    # 应该 184+14 tests pass
```

### Step 8: 提交
commit message 模板:
```
chore(deps): bump react-syntax-highlighter ~16.1.1 → ~17.x.y (Q3 #9)

- 验证: smoke test 14/14 pass (3 runs stable)
- 验证: vite dev 实际渲染代码块无 404
- 验证: npm test 全工程 184+14 tests pass
- alias 模式: 不变 / 更新了 N 个 regex (说明)
```

## 4. 升级失败的常见症状

| 症状 | 根因 | 修法 |
|------|------|------|
| `Failed to resolve module specifier 'react-syntax-highlighter/dist/esm/languages/prism/...'` | alias regex 不匹配新 dist 路径 | 更新 vite.config.ts:20-30 的 regex |
| `Cannot find module 'react-syntax-highlighter/dist/cjs/languages/...'` | 新版本没有 cjs dist (纯 ESM) | 删除 cjs 重定向, 改用 `optimizeDeps.include` + `exclude` 让 Vite 完全接管 |
| `<CodeHighlighter>` 渲染空白 / 显示 Suspense fallback | prism language module 加载失败 | 检查 `CodeHighlighter.js` 里的 `await import(...)` 路径, 必要时更新 alias |
| `TypeError: mod.default is not a function` | 语言模块从 array 改成 function (或反之) | smoke test 的 `expect(typeof mod.default).toBe(...)` 需要适配 |

## 5. 相关文件

| 文件 | 角色 |
|------|------|
| `web/package.json` | 直接 dep + overrides 双 pin |
| `web/vite.config.ts` | dev server alias regex + optimizeDeps |
| `web/vitest.config.ts` | 镜像 alias 让单测能验证相同路径 |
| `web/tests/code-highlighter-smoke.test.tsx` | 14 个 assertion, 升级时第一道关卡 |
| `web/src/components/chat/MarkdownConfig.tsx` | XMarkdown 自定义 code 渲染入口 |
| `web/src/components/knowledge/DocMindPreview.tsx` | DocMind 里的 CodeHighlighter 使用 |
| `web/src/pages/Chat.tsx` | Chat 页面的 CodeHighlighter 使用 |
| `web/node_modules/@ant-design/x/es/code-highlighter/CodeHighlighter.js` | 上游实现, 升级时必看 |

## 6. 上游 issue 跟踪

如果 smoke test fail 但代码看起来没改, 检查:
- https://github.com/react-syntax-highlighter/react-syntax-highlighter/releases
- https://github.com/ant-design/x/releases (CodeHighlighter changelog)

## 7. 紧急回滚

```bash
git revert HEAD --no-edit
cd web && npm install --legacy-peer-deps
npx vitest run tests/code-highlighter-smoke.test.tsx   # 确认 14/14 pass
```