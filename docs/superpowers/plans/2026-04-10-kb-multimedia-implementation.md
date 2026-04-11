# 知识库多媒体显示功能实施计划

## 概述

实施知识库多媒体内容显示功能，支持图片、表格、音视频等非文本内容的预览和引用显示。

## 实施阶段

### ✅ P0 - KBReferenceCard（已完成）

**目标**: AI 回复中显示知识库引用的图片缩略图预览

**实现内容**:
- 创建 `KBReferenceCard` 组件
- 缩略图网格展示（hover 1.5x 放大效果）
- 点击打开 `MediaPreviewModal` 全屏预览
- 底部媒体标签栏

**文件变更**:
- `web/src/components/KBReferenceCard.tsx` (新增)
- `web/src/components/MediaPreviewModal.tsx` (新增)

---

### ✅ P1 - DocumentPreviewDrawer（已完成）

**目标**: 文档预览页面支持左侧结构树 + 右侧原始版面渲染

**实现内容**:
- 创建 `DocumentPreviewDrawer` 组件（560px 宽度抽屉）
- 左侧 `DocumentStructureTree` 层级导航
- 右侧三模式切换：原始版面 / Markdown / 媒体画廊
- 原始版面显示 bbox 高亮框
- `MediaGallery` 网格展示所有图片/表格

**文件变更**:
- `web/src/components/DocumentPreviewDrawer.tsx` (新增)
- `web/src/components/DocumentStructureTree.tsx` (新增)
- `web/src/components/MediaGallery.tsx` (新增)

**后端支持**:
- `/api/knowledge/documents/:docId/layouts` 接口返回版面数据

---

### ✅ P2 - MediaSearchResultCard（已完成）

**目标**: 音视频搜索结果展示关键帧、时间戳、ASR 转录等多维度信息

**实现内容**:
- 创建 `MediaSearchResultCard` 组件
- 视频类型：显示关键帧图片 + 时间范围 + ASR 文本高亮
- 音频类型：显示波形图标 + 时间范围 + ASR 文本高亮
- 播放按钮遮罩层（悬停显示）
- 匹配关键词自动高亮

**文件变更**:
- `web/src/components/MediaSearchResultCard.tsx` (新增)
- `web/src/api/index.ts` (添加 `videoFrameUrl` 函数)
- `web/src/pages/Knowledge.tsx` (集成 MediaSearchResultCard)
- `web/src/styles/global.css` (添加媒体搜索卡片样式)

**后端支持**:
- `KnowledgeBase.search()` 扩展返回 multimedia 字段
- `SearchResult` 类型更新（mediaType, timeRange, frameUrl, asrText）

---

## API 变更记录

### 新增接口

```typescript
// GET /api/knowledge/documents/:docId/layouts
interface LayoutResponse {
  success: boolean;
  layouts: DocLayout[];
}
```

### 扩展现有接口

```typescript
// GET /api/knowledge/search 返回结果扩展
interface SearchResult {
  // ... 现有字段
  mediaType?: 'document' | 'video' | 'audio' | 'text';
  timeRange?: { start: number; end: number } | null;
  frameUrl?: string | null;
  asrText?: string | null;
}
```

### 新增工具函数

```typescript
// web/src/api/index.ts
export function videoFrameUrl(docId: string, framePath: string): string
```

---

## 组件清单

| 组件名 | 路径 | 状态 | 职责 |
|-------|------|------|------|
| KBReferenceCard | `web/src/components/KBReferenceCard.tsx` | ✅ | AI 回复中的知识库引用卡片 |
| MediaPreviewModal | `web/src/components/MediaPreviewModal.tsx` | ✅ | 图片/表格全屏预览弹窗 |
| DocumentPreviewDrawer | `web/src/components/DocumentPreviewDrawer.tsx` | ✅ | 文档预览抽屉 |
| DocumentStructureTree | `web/src/components/DocumentStructureTree.tsx` | ✅ | 左侧文档结构树 |
| MediaGallery | `web/src/components/MediaGallery.tsx` | ✅ | 媒体画廊网格 |
| MediaSearchResultCard | `web/src/components/MediaSearchResultCard.tsx` | ✅ | 音视频搜索结果卡片 |

---

## 数据库 Schema

```sql
-- kb_chunks 表已包含以下字段
- content_type: TEXT  -- 'text' | 'image' | 'video' | 'audio'
- frame_url: TEXT     -- 视频关键帧路径
- time_range: TEXT    -- JSON {start, end}
- asr_text: TEXT      -- ASR 转写文本
- bbox_data: TEXT     -- JSON 坐标数组
```

---

## 已知限制

1. **视频播放**: 当前仅显示关键帧，未实现在线播放功能
2. **frameUrl 路径**: 假设 frameUrl 为相对路径，通过 `videoFrameUrl` 函数转换
3. **移动端适配**: 媒体卡片在移动端垂直堆叠显示

---

## 测试验证

```bash
# TypeScript 编译检查
npx tsc --noEmit -p web/tsconfig.json
# ✅ 通过
```

---

## 提交信息

```
feat(kb): implement multimedia display for knowledge base

- Add KBReferenceCard for AI reply image thumbnails
- Add DocumentPreviewDrawer with tree navigation
- Add MediaSearchResultCard for video/audio search results
- Extend search API to return multimedia fields
- Add videoFrameUrl utility function
```
