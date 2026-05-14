# 商业化 UI 优化设计文档

> 日期: 2026-05-15
> 范围: 前端表格操作列 + 按钮层级 + 主题色升级
> 目标: 让 RAOS UI 更加商业化，交互逻辑更清晰

---

## 背景与问题

当前前端 UI 存在以下影响商业化体验的问题:

1. **表格操作列按钮拥挤**: Files.tsx 操作列宽 130px 塞了 4 个 icon-only 按钮，小屏幕下换行或截断
2. **按钮无层级区分**: 530 处 Button 大量使用 `type="text" size="small"`，主次操作 visually identical
3. **主题色无品牌感**: 默认 `#1677ff`（Ant Design 原生蓝），看起来像 Demo 项目
4. **交互不清晰**: icon-only 按钮缺少文字说明，新用户不知道图标含义

---

## 设计方案

### 1. 主题 Token 升级

文件: `web/src/theme/index.ts`

| Token | 当前值 | 新值 | 说明 |
|-------|--------|------|------|
| colorPrimary | `#1677ff` | `#2563eb` | 更深沉的商业蓝 |
| colorSuccess | antd 默认 | `#10b981` | 翡翠绿 |
| colorWarning | antd 默认 | `#f59e0b` | 琥珀黄 |
| colorError | antd 默认 | `#ef4444` | 玫瑰红 |
| borderRadius | 6 | 6 | 保持不变 |
| colorBgLayout | `#f5f5f5` | `#f8fafc` | 更清爽的布局背景 |

### 2. 表格操作列重构模式

所有 Table 操作列统一采用以下模式:

```tsx
{
  title: '操作',
  key: 'actions',
  width: 200,
  fixed: 'right',
  render: (_, record) => (
    <Space size={4}>
      {/* 最多 2 个主操作外露 */}
      <Button type="primary" size="small" icon={<Icon />}>文字</Button>
      {/* 其余收进下拉菜单 */}
      <Dropdown menu={{ items: actionItems }}>
        <Button size="small" icon={<MoreOutlined />}>更多</Button>
      </Dropdown>
    </Space>
  ),
}
```

### 3. 按钮层级规范

| 操作类型 | 样式 | 示例 |
|---------|------|------|
| 主操作（正向） | `type="primary" size="small"` | 查看、编辑、处理 |
| 次操作（中性） | `type="default" size="small"` | 更多、下载、复制 |
| 危险操作（删除） | `type="default" danger size="small"` | 删除 |
| 禁用 text 按钮作为操作 | ❌ 不再使用 | — |

### 4. 改造文件清单

| # | 文件 | 改造内容 |
|---|------|---------|
| 1 | `web/src/theme/index.ts` | 主题 Token 升级 |
| 2 | `web/src/App.tsx` | ConfigProvider 补充 shadow/border tokens |
| 3 | `web/src/pages/Files.tsx` | 操作列 130px → 200px + 按钮层级 |
| 4 | `web/src/pages/Admin.tsx` | 操作列按钮层级 |
| 5 | `web/src/pages/Approvals.tsx` | 操作列按钮层级 |
| 6 | `web/src/pages/WorkflowsPage.tsx` | 操作列按钮层级 |
| 7 | `web/src/pages/FormsPage.tsx` | 操作列按钮层级 |
| 8 | `web/src/pages/Connections.tsx` | 操作列按钮层级 |
| 9 | `web/src/pages/Memory.tsx` | 操作列按钮层级 |
| 10 | `web/src/pages/KnowledgeGraph.tsx` | 操作列按钮层级 |

---

## 验收标准

1. 所有 Table 操作列按钮不再溢出换行
2. 主/次/危险操作按钮有明确的视觉层级区分
3. 主题色从默认蓝变为品牌蓝，整体更有质感
4. 前端测试零回归
5. 无明显视觉异常（检查 light/dark 两种主题）
