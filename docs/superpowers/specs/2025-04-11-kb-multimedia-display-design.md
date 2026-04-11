# 知识库多媒体内容显示设计

## 概述

为知识库添加图片、表格、音视频等非文本内容的预览和引用显示能力，支持在 AI 对话中引用多媒体内容。

## 设计目标

- 在 AI 回复中引用知识库时，显示相关图片/表格的缩略图预览
- 文档预览页面支持左侧结构树、右侧原始版面渲染的布局
- 音视频文档搜索结果展示关键帧、时间戳、ASR 转录等多维度信息

## 数据基础

基于现有数据结构：
- `kb_documents.layouts_json` - Document Mind 版面数据
- `kb_chunks.page_number` / `bbox_data` - 坐标定位
- `kb_chunks.frame_url` - 音视频关键帧
- `kb_chunks.time_range` / `asr_text` - 音视频元数据

## 设计方案

### 1. 知识库引用卡片（AI 回复中）

**组件:** `KBReferenceCard`

**布局:**
```
┌─────────────────────────────────────┐
│ 📄 合同.pdf  第 3 页                 │
├─────────────────────────────────────┤
│ [缩略图预览]  点击放大查看            │
│                                     │
│ "相关条款内容..."                    │
├─────────────────────────────────────┤
│ 🖼️ 图 1  🖼️ 图 2  📊 表格 1        │
└─────────────────────────────────────┘
```

**功能:**
- 缩略图网格（2-3 列），hover 时显示 1.5 倍放大预览
- 点击缩略图打开 `MediaPreviewModal` 弹窗展示完整内容
- 底部标签栏显示该 chunk 关联的所有媒体元素（图片、表格）
- 点击标签快速定位到对应媒体元素

**数据结构:**
```typescript
interface KBReferenceData {
  docId: string;
  docName: string;
  pageNumber?: number;
  content: string;
  mediaItems: Array<{
    type: 'image' | 'table';
    id: string;
    url: string;
    thumbnailUrl: string;
    bbox?: { x: number; y: number; w: number; h: number };
  }>;
}
```

---

### 2. 文档预览页面

**组件:** `DocumentPreviewDrawer`（重构现有 Drawer）

**布局:** 左侧树形导航 + 右侧内容区域

#### 左侧树形导航

**数据源:** `layouts_json` 中的版面层级

**结构:**
```
📑 文档结构
├─ 📄 封面 (p1)
├─ 📄 目录 (p2)
├─ 📄 第一章 总则 (p3-p5)
│  ├─ 1.1 合同目的 (p3)
│  ├─ 1.2 定义 (p3)
│  └─ 1.3 适用范围 (p4)
├─ 🖼️ 图片列表 (5张)
├─ 📊 表格列表 (3个)
└─ 🎬 媒体片段 (仅音视频)
```

**交互:**
- 点击章节节点 → 右侧跳转到对应页面并高亮该区域
- 点击图片/表格列表 → 右侧切换到媒体画廊视图
- 当前选中项高亮显示

#### 右侧内容区域

**模式 1: 原始版面视图（默认）**

显示文档页面图片，叠加 bbox 高亮框：
```
┌──────────────────────────────┐
│  📄 第 3 页 / 共 10 页        │
├──────────────────────────────┤
│  ┌──────────────────────┐   │
│  │                      │   │
│  │  文档内容...         │   │
│  │                      │   │
│  │  ┌────────────┐      │   │
│  │  │ 📊 表格    │ ← bbox│   │
│  │  │ 高亮区域   │      │   │
│  │  └────────────┘      │   │
│  │                      │   │
│  │  ┌────┐              │   │
│  │  │ 🖼️ │ ← bbox       │   │
│  │  └────┘              │   │
│  │                      │   │
│  └──────────────────────┘   │
└──────────────────────────────┘
```

- 黄色半透明高亮框（保持现有 `HighlightedPageImage` 组件）
- 点击高亮区域打开对应媒体详情

**模式 2: Markdown 视图（现有）**

纯文本渲染，保持向后兼容。

**模式 3: 媒体画廊视图**

网格展示所有提取的图片/表格：
```
┌──────────────────────────────┐
│ 🖼️ 图片列表 (5张)            │
├──────────────────────────────┤
│ ┌──────┐ ┌──────┐ ┌──────┐  │
│ │ 图 1 │ │ 图 2 │ │ 图 3 │  │
│ │ p3   │ │ p5   │ │ p8   │  │
│ └──────┘ └──────┘ └──────┘  │
│ ┌──────┐ ┌──────┐           │
│ │ 图 4 │ │ 图 5 │           │
│ │ p12  │ │ p15  │           │
│ └──────┘ └──────┘           │
└──────────────────────────────┘
```

---

### 3. 音视频文档搜索结果

**组件:** `MediaSearchResultCard`

**布局:**
```
┌─────────────────────────────────────┐
│ 🎬 产品介绍.mp4  00:05:20 ~ 00:05:45 │
├─────────────────────────────────────┤
│ ┌─────────────────────────────────┐ │
│ │      [关键帧图片预览]            │ │
│ │      05:20 时刻画面             │ │
│ └─────────────────────────────────┘ │
│ ⏱️ 时间范围: 05:20 - 05:45         │
│ 📝 ASR 转录: "这是我们产品的..."    │
│ 🎭 剧情摘要: 产品核心功能介绍       │
│ ▶️ [播放片段]                      │
└─────────────────────────────────────┘
```

**功能:**
- 关键帧图片（来自 `frame_url`）
- 时间范围（来自 `time_range`）
- ASR 转录文本（来自 `asr_text`）
- 剧情摘要（如 advance 模式解析）
- 播放按钮（定位到视频对应时间点）

---

## 组件清单

### 新增组件

| 组件名 | 路径 | 职责 |
|-------|------|------|
| `KBReferenceCard` | `web/src/components/KBReferenceCard.tsx` | AI 回复中的知识库引用卡片 |
| `MediaPreviewModal` | `web/src/components/MediaPreviewModal.tsx` | 图片/表格全屏预览弹窗 |
| `DocumentPreviewDrawer` | `web/src/components/DocumentPreviewDrawer.tsx` | 文档预览抽屉（重构） |
| `DocumentStructureTree` | `web/src/components/DocumentStructureTree.tsx` | 左侧文档结构树 |
| `MediaGallery` | `web/src/components/MediaGallery.tsx` | 媒体画廊网格 |
| `MediaSearchResultCard` | `web/src/components/MediaSearchResultCard.tsx` | 音视频搜索结果卡片 |

### 修改组件

| 组件名 | 修改内容 |
|-------|---------|
| `Knowledge.tsx` | 预览 Drawer 替换为新的 `DocumentPreviewDrawer` |
| `Chat.tsx` | 消息渲染识别知识库引用，使用 `KBReferenceCard` |

---

## API 变更

### 现有 API 扩展

**GET /api/knowledge/documents/:docId/layouts**

返回版面结构数据（新增）

```typescript
interface LayoutResponse {
  success: boolean;
  layouts: Array<{
    id: string;
    type: string;
    page: number;
    text: string;
    bbox: { x: number; y: number; w: number; h: number };
    children?: string[]; // 子元素ID
  }>;
  mediaItems: {
    images: Array<{ id: string; page: number; url: string }>;
    tables: Array<{ id: string; page: number; content: any }>;
  };
}
```

**GET /api/knowledge/search** (扩展返回)

在现有 `SearchResult` 中增加：
```typescript
interface SearchResult {
  // ... 现有字段
  mediaType?: 'document' | 'video' | 'audio';
  timeRange?: { start: number; end: number };
  frameUrl?: string;
  asrText?: string;
}
```

---

## 实现优先级

1. **P0 - KBReferenceCard**: AI 回复中显示图片缩略图，价值最高
2. **P1 - DocumentPreviewDrawer**: 左侧结构树 + 原始版面视图
3. **P2 - MediaSearchResultCard**: 音视频搜索结果丰富展示

---

## 边界情况

- 无版面数据的旧文档 → 降级为 Markdown 视图
- 图片 URL 过期/失效 → 显示占位图
- 大文档（100+页）→ 树形结构虚拟滚动
- 移动端适配 → Drawer 全屏，树形结构可收起

---

## 非目标

- 不实现视频在线播放（保持现有跳转逻辑）
- 不实现 PDF 原生渲染（继续使用图片版式）
- 不实现文档编辑功能（仅预览）
