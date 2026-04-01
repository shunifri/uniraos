# Enhanced LTM Backend Design

借鉴 supermemory 的核心机制，在本地 FileLTMBackend 基础上构建增强型记忆后端，移除 supermemory API 依赖。

## 决策记录

| 决策项 | 选择 | 理由 |
|--------|------|------|
| 范围 | 全面增强（6 个机制全部实现） | 一次到位 |
| supermemory 依赖 | 移除，融入 EnhancedLTMBackend | 不依赖外部 API |
| 版本链策略 | 完全 append-only | 历史完整，与 supermemory 一致 |
| 矛盾检测触发 | 按需（skill 调用） | 零隐式 LLM 开销 |
| 画像生成 | 定时 + 按需 | 平衡性能和一致性 |
| 数据迁移 | 强制迁移 + 自动备份 | 数据一致性优先 |
| 架构模式 | 分层组合（模块化） | 职责清晰、独立可测 |

---

## 1. 数据模型

### LTMEntry 扩展

```typescript
interface LTMEntry {
  // 现有字段
  id: string;
  key: string;
  value: unknown;
  tags: string[];
  createdAt: number;
  updatedAt: number;
  accessCount: number;
  lastAccessedAt: number;
  source?: string;
  summary?: string;

  // 新增：版本链
  version: number;                // 版本号，同 key 内递增，从 1 开始
  parentId: string | null;        // 直接父版本 ID
  rootId: string | null;          // 版本链根 ID
  relation: 'creates' | 'updates' | 'extends' | 'derives';
  isLatest: boolean;              // 该 key 的最新版本标记

  // 新增：智能遗忘
  forgotten: boolean;             // 软删除标记
  forgottenAt?: number;
  forgottenReason?: string;
  expiresAt?: number;             // 到期自动标记 forgotten
}
```

### UserProfile 结构

```typescript
interface UserProfile {
  userId: string;
  static: string[];               // 长期稳定事实
  dynamic: string[];              // 近期变化信息
  generatedAt: number;
  memoryCountAtGeneration: number;
}
```

### 数据迁移

首次启动检测旧格式时：
1. 备份 `ltm/{userId}/` → `ltm/{userId}/_backup_{timestamp}/`
2. 遍历所有 entries，补全：`version=1`, `parentId=null`, `rootId=自身id`, `relation='creates'`, `isLatest=true`, `forgotten=false`
3. 写入新格式，创建 `_migrated_v2` 标记文件

---

## 2. 模块架构

### 目录结构

```
src/memory/
├── ltm-backend.ts                // LTMBackend 接口（扩展可选方法）
├── ltm.ts                        // FileLTMBackend（保留，纯存储层）
├── enhanced/
│   ├── enhanced-ltm-backend.ts   // 门面类 implements LTMBackend
│   ├── version-chain.ts          // 版本链管理（~200 行）
│   ├── profile-generator.ts      // 用户画像（~200 行）
│   ├── fact-extractor.ts         // 事实提取（~150 行）
│   ├── forgetting-manager.ts     // 智能遗忘（~180 行）
│   ├── conflict-detector.ts      // 矛盾检测（~150 行）
│   ├── search-enhancer.ts        // 搜索增强（~200 行）
│   ├── data-migrator.ts          // 数据迁移（~100 行）
│   └── index.ts
├── memory-skills.ts              // 适配 + 新 skills
├── stm.ts                        // 不变
└── index.ts                      // 新导出
```

### 模块依赖

```
EnhancedLTMBackend（门面）
  ├── FileLTMBackend          // 底层 JSON 存储
  ├── VersionChain            // 依赖 FileLTMBackend
  ├── ForgettingManager       // 依赖 FileLTMBackend
  ├── SearchEnhancer          // 依赖 FileLTMBackend.search + LLMProvider
  ├── ProfileGenerator        // 依赖 FileLTMBackend.list + LLMProvider
  ├── FactExtractor           // 依赖 LLMProvider
  ├── ConflictDetector        // 依赖 FileLTMBackend.search + LLMProvider
  └── DataMigrator            // 依赖 FileLTMBackend（一次性）
```

---

## 3. 各模块详细设计

### 3.1 VersionChain（~200 行）

管理同 key 记忆的版本历史链。

**方法**：
- `createVersion(key, value, relation?, parentId?)` → 构建新版本 entry 字段，标记旧版本 `isLatest=false`
- `getHistory(key)` → 该 key 所有版本，按 version 倒序
- `getChain(id)` → 从任意版本返回完整 parent→child 链
- `getRelated(id)` → 返回 context（parents + children + 关系类型）

**版本号**：同 key 内递增，`version = 上一版本.version + 1`

**relation 默认规则**：同 key 已存在 → `updates`，不存在 → `creates`

### 3.2 ForgettingManager（~180 行）

软删除、过期管理、遗忘审计。

**方法**：
- `forget(id, reason?)` → 标记 forgotten，不删除数据
- `setExpiration(id, expiresAt)` → 设置过期时间
- `checkExpired()` → 扫描并标记已过期记忆
- `filterForgotten(entries, includeForgotten?)` → 过滤器
- `getForgottenLog(options?)` → 遗忘记录查询
- `restore(id)` → 恢复已遗忘记忆

**过期检查时机**：store() 和 search() 时顺带执行。

### 3.3 SearchEnhancer（~200 行）

增强搜索排序和过滤。

**方法**：
- `rerank(query, results, llmProvider)` → LLM 对 top-N 重新打分排序
- `applyMetadataFilters(results, filters)` → OR/AND 嵌套元数据过滤
- `rewriteQuery(query, llmProvider)` → 可选 LLM 查询改写

**过滤表达式**：
```typescript
interface MetadataFilter {
  key: string;
  value: string | number | boolean;
  filterType: 'metadata' | 'numeric' | 'array_contains' | 'string_contains';
  numericOperator?: '>' | '<' | '>=' | '<=' | '=';
  negate?: boolean;
}
type FilterExpression =
  | MetadataFilter
  | { OR: FilterExpression[] }
  | { AND: FilterExpression[] };
```

**重排序**：只对 top-20 结果调用 LLM。

### 3.4 ProfileGenerator（~200 行）

生成和缓存用户画像。

**方法**：
- `generate(entries, llmProvider)` → `{ static: string[], dynamic: string[] }`
- `getCached(userId)` → 缓存画像
- `refresh(userId, entries, llmProvider)` → 强制重建
- `isStale(userId, currentEntryCount)` → 过期判断

**Static vs Dynamic**（LLM prompt 引导）：
- Static：多记忆中的一致性事实、无时间敏感性
- Dynamic：近 7 天内的、含时间词汇的、单次出现的状态

**缓存刷新**：
- 定时（默认 1 小时）
- 新增记忆超过阈值（默认 10 条）
- 手动 refresh

**持久化**：`profile-cache.json`

### 3.5 FactExtractor（~150 行）

从原始文本提取结构化事实。

**方法**：
- `extract(text, llmProvider, entityContext?)` → `Array<{ key, fact, confidence, tags }>`
- `extractAndStore(text, ltmBackend, llmProvider, entityContext?)` → 提取并批量存储

**过滤**：confidence < 0.5 自动丢弃。entityContext 最多 1500 字符。

### 3.6 ConflictDetector（~150 行）

按需检测新记忆与已有记忆的矛盾。

**方法**：
- `detect(newEntry, candidates, llmProvider)` → `Array<{ existingId, existingKey, description, severity }>`
- `detectForKey(key, newValue, ltmBackend, llmProvider)` → 便捷方法

**流程**：语义搜索 top-10 + 同 key 历史 → 去重 → LLM 比对 → 返回冲突列表。

### 3.7 DataMigrator（~100 行）

旧格式一次性迁移。

**方法**：
- `needsMigration(storePath)` → 检查 `_migrated_v2` 标记
- `migrate(storePath)` → 备份 → 补全字段 → 写入 → 标记
- `backup(storePath)` → 复制到 `_backup_{timestamp}/`

---

## 4. 数据流

### Store 管线

```
ltm_store(key, value, options)
  → VersionChain.createVersion()     // 版本字段，旧版本 isLatest=false
  → FileLTMBackend.store()           // 持久化
  → ForgettingManager.checkExpired() // 顺带清理
  → return { id, version, parentId }
```

### Search 管线

```
ltm_search(query, options)
  → ForgettingManager.checkExpired()
  → FileLTMBackend.search()              // 关键词 60% + 向量 40%
  → ForgettingManager.filterForgotten()
  → VersionChain.filterLatest()          // 默认只返回 isLatest
  → SearchEnhancer.applyMetadataFilters()
  → SearchEnhancer.rerank()              // 可选 LLM 重排序
  → return results
```

### Delete 管线

```
ltm_delete(key, { reason, hard })
  → hard=true  → FileLTMBackend.delete()
  → hard=false → ForgettingManager.forget(id, reason)
```

### Profile 管线

```
ltm_profile({ refresh })
  → ProfileGenerator.isStale()? or refresh?
  → yes → FileLTMBackend.list() → LLM 分析 → 缓存 → 返回
  → no  → 返回缓存
```

### Conflict 管线

```
ltm_check_conflicts(key, value)
  → FileLTMBackend.search(value)    // 语义相近
  → VersionChain.getHistory(key)    // 同 key 历史
  → 去重合并 top-10
  → LLM 比对 → return conflicts
```

---

## 5. Skills 变更

### 重写的 Skills（4 个，移除 supermemory 依赖）

| Skill | 参数 | 调用模块 |
|-------|------|----------|
| `ltm_profile` | `refresh?(bool)` | ProfileGenerator |
| `ltm_extract_facts` | `text(string)`, `entityContext?(string)`, `tags?(string[])` | FactExtractor |
| `ltm_forget_reason` | `key?`, `id?`, `reason(string)` | ForgettingManager |
| `ltm_set_expiration` | `key?`, `id?`, `expiresInSec(number)` | ForgettingManager |

### 新增的 Skills（3 个）

| Skill | 参数 | 功能 |
|-------|------|------|
| `ltm_version_history` | `key(string)` | 完整版本链 |
| `ltm_check_conflicts` | `key(string)`, `value(string)` | 矛盾检测 |
| `ltm_forgotten_log` | `since?(number)`, `limit?(number)` | 遗忘记录 |

### 修改的 Skills

| Skill | 变更 |
|-------|------|
| `ltm_store` | +`relation?`, +`expiresInSec?` |
| `ltm_search` | +`rerank?`, +`filters?`, +`includeForgotten?` |
| `ltm_delete` | 改为软删除，+`reason?`, +`hard?` |
| `memory_stats` | +版本链数、forgotten 数、画像状态、过期数 |

### Server API 新增

| 端点 | 方法 | 功能 |
|------|------|------|
| `GET /api/memory/profile/:userId` | GET | 用户画像 |
| `GET /api/memory/versions/:key` | GET | 版本历史 |
| `GET /api/memory/forgotten` | GET | 遗忘记录 |
| `POST /api/memory/check-conflicts` | POST | 矛盾检测 |

---

## 6. 配置

```typescript
interface MemoryConfig {
  // 移除: backend, supermemory

  // 新增
  profileRefreshIntervalMs?: number;     // 画像刷新间隔，默认 3600000（1h）
  profileStaleThreshold?: number;        // 新增记忆过期阈值，默认 10
  rerankTopN?: number;                   // 重排序 top-N，默认 20
  defaultExpiresInSec?: number;          // 默认过期时间，0=永不
  factExtractionMinConfidence?: number;  // 事实提取最低置信度，默认 0.5
}
```

---

## 7. 移除项

- `src/memory/supermemory-backend.ts` — 删除
- `tests/memory/supermemory-backend.test.ts` — 删除
- `package.json` 中 `supermemory` 依赖 — 删除
- `config.memory.backend` 和 `config.memory.supermemory` — 删除
- `UserSessionManager` 中的后端工厂逻辑 — 简化

---

## 8. 文件存储布局

```
.raos/ltm/{userId}/
├── entries.json             // 所有 entries（含版本链、forgotten 标记）
├── vectors.json             // 向量索引（不变）
├── profile-cache.json       // 画像缓存（新增）
├── archive-manifest.json    // 归档清单（不变）
├── _migrated_v2             // 迁移完成标记（新增）
├── _backup_{timestamp}/     // 迁移前备份（新增）
└── archives/                // 归档文件（不变）
```

---

## 9. 测试计划

| 模块 | 测试文件 | 重点 |
|------|----------|------|
| VersionChain | `tests/memory/enhanced/version-chain.test.ts` | 版本递增、链完整性、isLatest 标记 |
| ForgettingManager | `tests/memory/enhanced/forgetting-manager.test.ts` | 软删除、过期、恢复、过滤 |
| SearchEnhancer | `tests/memory/enhanced/search-enhancer.test.ts` | 元数据过滤（OR/AND）、重排序 |
| ProfileGenerator | `tests/memory/enhanced/profile-generator.test.ts` | 生成、缓存、过期判断 |
| FactExtractor | `tests/memory/enhanced/fact-extractor.test.ts` | 提取、置信度过滤、存储 |
| ConflictDetector | `tests/memory/enhanced/conflict-detector.test.ts` | 矛盾识别、severity |
| DataMigrator | `tests/memory/enhanced/data-migrator.test.ts` | 备份、字段补全、幂等性 |
| EnhancedLTMBackend | `tests/memory/enhanced/enhanced-ltm-backend.test.ts` | 端到端管线 |
| 现有测试 | `tests/memory/memory.test.ts` | 适配新字段，全部通过 |
