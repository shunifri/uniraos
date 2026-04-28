# RAOS Inbox + Scheduler 整合规划

> 目标：建立统一的被动消息收件箱（Inbox）和时间感知调度器（Scheduler），将审批、通知、提醒、定时任务全部整合到 Chat 界面中。

---

## 一、核心决策确认

| # | 决策项 | 选择 | 理由 |
|---|--------|------|------|
| 1 | 调度器技术 | **Bull + Redis** | 项目已有 ioredis 和 RedisClient，Bull 基于 Redis 实现可靠的延迟队列、重试、并发控制 |
| 2 | 定时任务分级 | **统一走一套** | 用户说"明天提醒我"和系统说"每天生成报表"底层都是"到时间了触发动作"，用同一套 Scheduler + 不同的 source 字段区分 |
| 3 | Inbox 展示位置 | **仅 Chat 页面** | 和对话历史深度绑定，审批卡片可以携带对话上下文；其他页面通过顶部 Badge 获知有新事项 |

---

## 二、架构总览

```
┌─────────────────────────────────────────────────────────────────────┐
│                         Chat 页面 (前端)                              │
│  ┌───────────────────────────────────────────────────────────────┐  │
│  │                    Chat Stream (主区域)                         │  │
│  │  ┌─ 普通消息                                                    │  │
│  │  ├─ user_confirm 阻塞卡片                                       │  │
│  │  └─ Inbox 嵌入式卡片 (仅与当前对话强关联的审批/通知)               │  │
│  └───────────────────────────────────────────────────────────────┘  │
│  ┌───────────────────────────────────────────────────────────────┐  │
│  │              Right Panel: Inbox Sidebar (可折叠)                │  │
│  │  [🔴 待处理 5]  [📋 已处理]  [🔔 通知 3]  [⏰ 提醒 2]           │  │
│  │  ├─ 🔴 审批：请假申请 (Workflow)      [通过] [驳回]             │  │
│  │  ├─ 🔴 审批：Skill 生成 (Evolution)   [查看代码] [通过]         │  │
│  │  ├─ 🟡 ⏰ 提醒：检查邮件 (9:00)      [已完成 ✓]                │  │
│  │  └─ ⚪ 🔴 系统告警：磁盘空间 x3 (聚合)  [展开]                 │  │
│  └───────────────────────────────────────────────────────────────┘  │
│  ┌───────────────────────────────────────────────────────────────┐  │
│  │              Top Bar: Inbox Badge (全局导航栏)                   │  │
│  │  [Chat] [Skills] [KB] ...  [🔔 8] [👤 User]                    │  │
│  └───────────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────────┘
                                    │
                                    │ SSE / WebSocket
                                    ▼
┌─────────────────────────────────────────────────────────────────────┐
│                         后端服务层                                     │
│                                                                     │
│  ┌─────────────┐    ┌─────────────┐    ┌─────────────────────────┐ │
│  │  Scheduler  │    │   Inbox     │    │     DeliveryRouter      │ │
│  │  Service    │───▶│  Service    │◀───│    (投递决策引擎)        │ │
│  │  (Bull)     │    │             │    │                         │ │
│  └─────────────┘    └──────┬──────┘    │ • 时间：立即/定时/延迟   │ │
│         │                  │            │ • 地点：Chat/Inbox/Email │ │
│         │                  │            │ • 方式：单条/聚合/升级   │ │
│         │                  │            └─────────────────────────┘ │
│         │                  │                                       │
│  ┌──────┴──────┐  ┌──────┴──────┐  ┌──────────────┐              │
│  │ Workflow    │  │  Evolution  │  │   Scheduled  │              │
│  │  Adapter    │  │   Adapter   │  │    Events    │              │
│  │             │  │             │  │  (User/System)│              │
│  │ UserTask    │  │ Pending     │  │  Reminder    │              │
│  │ → InboxItem │  │ Approval    │  │  Deadline    │              │
│  └─────────────┘  │ → InboxItem │  │  Recurring   │              │
│                   └─────────────┘  └──────────────┘              │
│                                                                     │
│  ┌─────────────────────────────────────────────────────────────┐   │
│  │              AI Review Hook (AI 辅助审批)                      │   │
│  │  InboxItem 创建时异步触发：                                      │   │
│  │  • 加载 LTM (历史记录) + KB (制度文档) + DB (实时数据)          │   │
│  │  • LLM 生成审批建议 → 存入 inbox_items.ai_suggestion          │   │
│  └─────────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────┘
```

---

## 三、数据模型

### 3.1 scheduled_events 表

```sql
CREATE TABLE IF NOT EXISTS scheduled_events (
  id            VARCHAR(64) PRIMARY KEY,
  user_id       VARCHAR(64) NOT NULL,
  
  -- 事件类型
  type          ENUM('reminder', 'deadline', 'recurring', 'conditional') NOT NULL,
  
  -- 触发配置 (JSON)
  trigger_config JSON NOT NULL,
  -- trigger_config 示例:
  -- { "mode": "absolute", "at": 1777003776000 }
  -- { "mode": "relative", "delayMs": 86400000 }
  -- { "mode": "cron", "cron": "0 9 * * *" }
  -- { "mode": "conditional", "condition": "cpu > 90" }
  
  -- 执行动作 (JSON)
  action_config JSON NOT NULL,
  -- action_config 示例:
  -- { "type": "inbox", "payload": { "title": "检查邮件" }, "targetConversationId": "conv_xxx" }
  -- { "type": "chat", "payload": { "text": "该审批即将截止" } }
  -- { "type": "email", "payload": { "subject": "...", "body": "..." } }
  
  -- 升级策略 (JSON，可选)
  escalation_config JSON,
  -- escalation_config 示例:
  -- { "afterMs": 300000, "channel": "im", "repeat": 2, "intervalMs": 600000 }
  
  -- 来源标识
  source        VARCHAR(50) NOT NULL,  -- 'user', 'system', 'workflow', 'evolution', 'agent'
  source_id     VARCHAR(64),           -- 关联业务ID (taskId/approvalId/...)
  
  -- 状态
  status        ENUM('pending', 'triggered', 'completed', 'cancelled', 'failed') DEFAULT 'pending',
  retry_count   INT DEFAULT 0,
  
  -- 时间戳
  created_at    BIGINT NOT NULL,
  triggered_at  BIGINT,
  completed_at  BIGINT,
  
  INDEX idx_user_status (user_id, status),
  INDEX idx_trigger_at (triggered_at),
  INDEX idx_source (source, source_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
```

### 3.2 inbox_items 表

```sql
CREATE TABLE IF NOT EXISTS inbox_items (
  id              VARCHAR(64) PRIMARY KEY,
  user_id         VARCHAR(64) NOT NULL,
  
  type            ENUM('approval', 'notification', 'task', 'alert') NOT NULL,
  category        VARCHAR(50) NOT NULL,  -- 'workflow_task', 'evolution_approval', 'system_alert', 'user_reminder'
  
  source          VARCHAR(50) NOT NULL,  -- 'workflow', 'evolution', 'system', 'agent', 'scheduler'
  source_id       VARCHAR(64),           -- 关联业务ID
  
  title           VARCHAR(255) NOT NULL,
  description     TEXT,
  
  priority        ENUM('low', 'normal', 'high', 'urgent') DEFAULT 'normal',
  status          ENUM('unread', 'read', 'pending', 'completed', 'dismissed') DEFAULT 'unread',
  
  -- 业务 Payload (JSON)
  payload         JSON,
  -- payload 示例:
  -- {
  --   "schema": { /* RaosFormSchema */ },
  --   "actions": [{ "action": "approve", "label": "通过", "primary": true }],
  --   "formData": {},
  --   "resultData": {},
  --   "content": "磁盘空间不足 92%",
  --   "link": "/admin/monitoring"
  -- }
  
  -- AI 建议 (JSON)
  ai_suggestion   JSON,
  -- ai_suggestion 示例:
  -- {
  --   "recommendation": "approve",
  --   "confidence": 0.92,
  --   "reasoning": "年假余额充足，符合规定",
  --   "risks": ["项目 X 下周交付"],
  --   "sources": ["制度 v3.2", "历史记录"]
  -- }
  
  -- 聚合
  aggregate_group_id VARCHAR(64),
  aggregate_count    INT DEFAULT 1,
  
  -- 关联对话
  conversation_id    VARCHAR(64),
  
  -- 时间维度
  scheduled_at       BIGINT,  -- 计划触发时间 (提醒类)
  due_at             BIGINT,  -- 截止时间 (审批类)
  created_at         BIGINT NOT NULL,
  completed_at       BIGINT,
  
  INDEX idx_user_status (user_id, status),
  INDEX idx_conversation (conversation_id),
  INDEX idx_aggregate (aggregate_group_id),
  INDEX idx_due (due_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
```

### 3.3 TypeScript 类型定义

```typescript
// src/inbox/inbox-types.ts

export type InboxType = "approval" | "notification" | "task" | "alert";
export type InboxCategory = 
  | "workflow_task" 
  | "evolution_approval" 
  | "system_alert" 
  | "user_reminder"
  | "agent_proactive";
export type InboxPriority = "low" | "normal" | "high" | "urgent";
export type InboxStatus = "unread" | "read" | "pending" | "completed" | "dismissed";

export interface InboxItem {
  id: string;
  userId: string;
  type: InboxType;
  category: InboxCategory;
  source: string;
  sourceId?: string;
  title: string;
  description?: string;
  priority: InboxPriority;
  status: InboxStatus;
  payload: InboxPayload;
  aiSuggestion?: AISuggestion;
  aggregateGroupId?: string;
  aggregateCount?: number;
  conversationId?: string;
  scheduledAt?: number;
  dueAt?: number;
  createdAt: number;
  completedAt?: number;
}

export interface InboxPayload {
  // 审批类
  schema?: any;           // RaosFormSchema
  actions?: InboxAction[];
  formData?: Record<string, any>;
  resultData?: Record<string, any>;
  
  // 通知类
  content?: string;
  link?: string;
  
  // 通用
  metadata?: Record<string, any>;
}

export interface InboxAction {
  action: string;         // 动作标识: "approve", "reject", "transfer", "dismiss"
  label: string;          // 显示文字
  primary?: boolean;
  danger?: boolean;
}

export interface AISuggestion {
  recommendation: "approve" | "reject" | "review";
  confidence: number;
  reasoning: string;
  risks?: string[];
  sources?: string[];
}

// src/scheduler/scheduler-types.ts

export type ScheduleType = "reminder" | "deadline" | "recurring" | "conditional";
export type ScheduleStatus = "pending" | "triggered" | "completed" | "cancelled" | "failed";
export type ScheduleSource = "user" | "system" | "workflow" | "evolution" | "agent";
export type ActionType = "inbox" | "chat" | "email" | "im" | "webhook" | "skill";

export interface ScheduledEvent {
  id: string;
  userId: string;
  type: ScheduleType;
  triggerConfig: TriggerConfig;
  actionConfig: ActionConfig;
  escalationConfig?: EscalationConfig;
  source: ScheduleSource;
  sourceId?: string;
  status: ScheduleStatus;
  retryCount: number;
  createdAt: number;
  triggeredAt?: number;
  completedAt?: number;
}

export interface TriggerConfig {
  mode: "absolute" | "relative" | "cron" | "conditional";
  at?: number;            // absolute 时间戳
  delayMs?: number;       // relative 延迟毫秒
  cron?: string;          // cron 表达式
  condition?: string;     // 条件表达式
}

export interface ActionConfig {
  type: ActionType;
  payload: Record<string, any>;
  targetConversationId?: string;
}

export interface EscalationConfig {
  afterMs: number;        // 多久后升级
  channel: string;        // 升级渠道: "im", "email", "sms"
  repeat?: number;        // 重复提醒次数
  intervalMs?: number;    // 重复间隔
}
```

---

## 四、后端模块设计

### 4.1 文件结构

```
src/
├── inbox/
│   ├── index.ts                 # 统一导出
│   ├── inbox-types.ts           # 类型定义
│   ├── inbox-service.ts         # 核心业务逻辑
│   ├── inbox-repository.ts      # MySQL 数据访问层
│   ├── inbox-routes.ts          # REST API 路由
│   ├── delivery-router.ts       # 投递路由决策引擎
│   ├── ai-review-hook.ts        # AI 辅助审批 Hook
│   └── adapters/
│       ├── index.ts
│       ├── workflow-adapter.ts  # Workflow → InboxItem
│       ├── evolution-adapter.ts # Evolution → InboxItem
│       └── system-adapter.ts    # System → InboxItem
│
├── scheduler/
│   ├── index.ts
│   ├── scheduler-types.ts
│   ├── scheduler-service.ts     # Bull 队列封装 + 管理
│   ├── scheduler-worker.ts      # Bull 任务处理器
│   ├── scheduler-routes.ts      # REST API
│   └── schedule-skills.ts       # schedule_create / schedule_cancel skills
│
└── db/
    └── migrations/              # 数据库迁移脚本
        ├── v9_inbox_scheduler.sql
```

### 4.2 关键类设计

#### InboxService

```typescript
class InboxService {
  // CRUD
  async createItem(item: CreateInboxItemInput): Promise<InboxItem>;
  async getItem(id: string): Promise<InboxItem | null>;
  async listItems(query: InboxQuery): Promise<PaginatedResult<InboxItem>>;
  async updateStatus(id: string, status: InboxStatus): Promise<InboxItem>;
  async completeItem(id: string, result: any): Promise<InboxItem>;
  async dismissItem(id: string): Promise<InboxItem>;
  
  // 聚合
  async aggregateItems(userId: string, options: AggregateOptions): Promise<InboxItem[]>;
  
  // 统计
  async getUnreadCount(userId: string): Promise<number>;
  async getStats(userId: string): Promise<InboxStats>;
  
  // 投递
  async deliver(item: InboxItem): Promise<void>;
}
```

#### SchedulerService (Bull 封装)

```typescript
class SchedulerService {
  private queues: Map<string, Queue>;
  
  // 初始化 Bull 队列
  async initialize(): Promise<void>;
  
  // 创建定时任务
  async createEvent(event: CreateScheduledEventInput): Promise<ScheduledEvent>;
  
  // 取消定时任务
  async cancelEvent(id: string): Promise<boolean>;
  
  // 立即触发（测试用）
  async triggerNow(id: string): Promise<void>;
  
  // 内部：Bull job 处理器
  private async processJob(job: Bull.Job): Promise<void>;
  
  // 升级策略处理器
  private async handleEscalation(event: ScheduledEvent): Promise<void>;
}
```

#### DeliveryRouter

```typescript
class DeliveryRouter {
  // 核心决策方法
  async route(event: DeliveryEvent): Promise<DeliveryDecision>;
  
  // 决策维度
  private decideTiming(event: DeliveryEvent): TimingDecision;
  private decideContext(event: DeliveryEvent): ContextDecision;
  private decideChannel(event: DeliveryEvent): ChannelDecision;
  
  // 执行投递
  async deliverToChat(item: InboxItem, conversationId: string): Promise<void>;
  async deliverToInbox(item: InboxItem): Promise<void>;
  async deliverToEmail(item: InboxItem): Promise<void>;
  async deliverToIM(item: InboxItem): Promise<void>;
}
```

### 4.3 API 设计

```
# ==================== Inbox API ====================

GET    /api/inbox
       Query: type, category, status, priority, page, pageSize, sortBy, sortOrder
       Response: { success: true, data: InboxItem[], pagination: {...} }

GET    /api/inbox/stats
       Response: { success: true, unreadCount: 5, pendingApprovals: 2, ... }

GET    /api/inbox/unread-count
       Response: { success: true, count: 5 }

GET    /api/inbox/:id
       Response: { success: true, data: InboxItem }

POST   /api/inbox/:id/read
       Response: { success: true }

POST   /api/inbox/:id/complete
       Body: { action: string, formData?: Record<string, any>, comment?: string }
       Response: { success: true, data: InboxItem }

POST   /api/inbox/:id/dismiss
       Response: { success: true }

# ==================== Scheduler API ====================

POST   /api/schedule
       Body: {
         type: "reminder" | "deadline" | "recurring" | "conditional",
         triggerConfig: TriggerConfig,
         actionConfig: ActionConfig,
         escalationConfig?: EscalationConfig
       }
       Response: { success: true, data: ScheduledEvent }

GET    /api/schedule
       Query: type, status, page, pageSize
       Response: { success: true, data: ScheduledEvent[], pagination: {...} }

GET    /api/schedule/:id
       Response: { success: true, data: ScheduledEvent }

DELETE /api/schedule/:id
       Response: { success: true }

POST   /api/schedule/:id/cancel
       Response: { success: true }

# ==================== SSE Events ====================

# Chat SSE 流新增事件类型

event: inbox_item
data: { item: InboxItem }          # 新 InboxItem 到达

event: inbox_update
data: { id: string, status: string }  # InboxItem 状态更新

event: schedule_trigger
data: { eventId: string, result: any }  # 定时任务触发
```

---

## 五、前端设计

### 5.1 文件结构

```
web/src/
├── components/
│   └── inbox/
│       ├── index.ts
│       ├── InboxPanel.tsx           # 侧边面板（主容器）
│       ├── InboxTabs.tsx            # 标签页切换
│       ├── InboxList.tsx            # 列表视图
│       ├── InboxCard.tsx            # 单项卡片
│       ├── InboxDetail.tsx          # 详情抽屉/弹窗
│       ├── InboxAggregate.tsx       # 聚合项展开
│       ├── InboxBadge.tsx           # 顶部导航 Badge
│       ├── InboxActions.tsx         # 操作按钮组
│       ├── AISuggestion.tsx         # AI 建议展示
│       ├── ApprovalCard.tsx         # 审批专用卡片
│       ├── NotificationCard.tsx     # 通知专用卡片
│       ├── ReminderCard.tsx         # 提醒专用卡片
│       └── ChatInboxCard.tsx        # Chat 流内嵌卡片
│
├── store/
│   └── inbox-store.ts               # Zustand store
│
└── pages/
    └── Chat.tsx                     # 整合 InboxPanel
```

### 5.2 Zustand Store 设计

```typescript
// store/inbox-store.ts

interface InboxState {
  // 数据
  items: InboxItem[];
  unreadCount: number;
  stats: InboxStats;
  selectedItemId: string | null;
  
  // UI 状态
  panelOpen: boolean;
  activeTab: "pending" | "completed" | "notifications" | "reminders";
  
  // 动作
  fetchItems: (filter?: InboxFilter) => Promise<void>;
  fetchUnreadCount: () => Promise<void>;
  markAsRead: (id: string) => Promise<void>;
  completeItem: (id: string, action: string, data?: any) => Promise<void>;
  dismissItem: (id: string) => Promise<void>;
  selectItem: (id: string | null) => void;
  togglePanel: () => void;
  
  // SSE 推送处理
  handleNewItem: (item: InboxItem) => void;
  handleItemUpdate: (id: string, status: InboxStatus) => void;
}
```

### 5.3 Chat 页面整合点

```typescript
// Chat.tsx 关键修改

export default function ChatPage() {
  // ... 现有状态 ...
  
  // 新增：Inbox 状态
  const inboxStore = useInboxStore();
  
  // SSE handler 新增 inbox 事件
  const handleSSEEvent = (event: SSEEvent) => {
    switch (event.type) {
      // ... 现有 case ...
      case "inbox_item":
        inboxStore.handleNewItem(event.data.item);
        // 如果与当前对话关联，在 Chat 流中插入卡片
        if (event.data.item.conversationId === activeConvId) {
          appendInboxCardToStream(event.data.item);
        }
        break;
      case "inbox_update":
        inboxStore.handleItemUpdate(event.data.id, event.data.status);
        break;
    }
  };
  
  return (
    <div className="chat-layout">
      {/* 左侧/主区域：Chat Stream */}
      <div className="chat-main">
        <ChatStream messages={messages} />
        {/* 底部输入区 */}
        <ChatInput />
      </div>
      
      {/* 右侧：Inbox Panel */}
      {inboxStore.panelOpen && (
        <InboxPanel 
          items={inboxStore.items}
          selectedItemId={inboxStore.selectedItemId}
          onSelect={inboxStore.selectItem}
          onComplete={inboxStore.completeItem}
          onDismiss={inboxStore.dismissItem}
        />
      )}
    </div>
  );
}
```

---

## 六、与现有系统的整合点

### 6.1 Workflow Engine 整合

**修改文件**: `src/workflow/engine.ts` → `handleUserTask()`

```typescript
// 当前逻辑：创建 WorkflowTask
const task = await this.repo.createTask({...});

// 新增：同步创建 InboxItem
const { createWorkflowAdapter } = await import("../inbox/adapters");
const inboxItem = await createWorkflowAdapter().toInboxItem(task, node, instance);
await getInboxService().createItem(inboxItem);

// 新增：如果有 AI Review 配置，触发异步审查
if (node.aiReview !== false) {
  await getInboxService().triggerAIReview(inboxItem.id);
}
```

**移除**: `web/src/pages/ApprovalCenter.tsx` 独立页面（改为 InboxPanel 中的审批卡片）

### 6.2 Evolution Controller 整合

**修改文件**: `src/engine/evolution-controller.ts` → `addPendingApproval()`

```typescript
// 当前逻辑：this.pendingApprovals.push(approval);

// 新增：创建 InboxItem
const { createEvolutionAdapter } = await import("../inbox/adapters");
const inboxItem = await createEvolutionAdapter().toInboxItem(approval);
await getInboxService().createItem(inboxItem);
```

**移除**: `web/src/components/evolution/PendingActions.tsx` 中的独立审批列表

### 6.3 Chat SSE 整合

**修改文件**: `src/server.ts` → SSE stream handler

```typescript
// 在 processEvent 中新增：
} else if (eventName === "inbox_item") {
  // 推送给前端
  write("inbox_item", eventData);
  // 同时保存到数据库（如果后端生成）
  // saveMsg("system", eventData.title, { extra: { inboxItem: eventData } });
}
```

### 6.4 Agent Loop 整合

**保持现状**: `user_confirm` 是同步阻塞式交互，继续在 Chat 流中以 `ConfirmCard` 形式存在。

**新增**: Agent 可以通过创建 `ScheduledEvent` 来设置定时提醒：
```typescript
// agent-loop.ts 中
// 用户说"明天提醒我检查邮件"
// → Agent 调用 schedule_create skill
// → SchedulerService.createEvent({...})
// → 明天 9 点触发 → 创建 InboxItem → SSE 推送到 Chat
```

### 6.5 定时任务 Skill

**新增文件**: `src/scheduler/schedule-skills.ts`

```typescript
export function createScheduleSkills(registry: SkillRegistry) {
  // schedule_create
  registry.register(defineSkill({
    name: "schedule_create",
    description: `创建定时任务/提醒。支持：
      - 绝对时间: "2026-04-25 09:00"
      - 相对时间: "30分钟后", "明天上午9点"
      - 周期性: "每天9点", "每周一"
      - 条件触发: "当CPU>90%时"`,
    handler: async (params) => {
      const event = await schedulerService.createEvent({
        userId: context.userId,
        type: params.type,
        triggerConfig: parseTrigger(params.when),
        actionConfig: {
          type: "inbox",
          payload: { title: params.title, content: params.content },
          targetConversationId: params.conversationId,
        },
        source: "user",
      });
      return { success: true, data: { eventId: event.id } };
    }
  }));
  
  // schedule_cancel
  registry.register(defineSkill({
    name: "schedule_cancel",
    description: "取消定时任务",
    handler: async (params) => {
      const success = await schedulerService.cancelEvent(params.eventId);
      return { success, data: { cancelled: success } };
    }
  }));
  
  // schedule_list
  registry.register(defineSkill({
    name: "schedule_list",
    description: "列出当前用户的定时任务",
    handler: async (params) => {
      const events = await schedulerService.listEvents({
        userId: context.userId,
        status: "pending",
      });
      return { success: true, data: { events } };
    }
  }));
}
```

---

## 七、AI 辅助审批设计

### 7.1 触发时机

```
InboxItem 创建
    ↓
[异步，不阻塞] AI Review Hook
    ↓
1. 加载上下文
   • LTM: userId + "请假" → 历史请假记录
   • KB: "请假管理制度" → 制度条款
   • DB: 当前团队排班、项目里程碑
   • ChatHistory: 关联对话的上下文

2. LLM 推理
   Prompt: 
   "作为审批助手，请基于以下信息给出审批建议：
    - 申请人: {userName}
    - 申请类型: {leaveType}
    - 申请天数: {days}
    - 历史记录: {history}
    - 制度规定: {policy}
    - 团队影响: {teamImpact}
    
    请给出：建议（通过/驳回/需补充材料）、理由、风险点。"

3. 结果存入 inbox_items.ai_suggestion
```

### 7.2 前端展示

```tsx
<AISuggestion 
  suggestion={item.aiSuggestion}
  collapsible  // 默认折叠，点击展开
/>
```

---

## 八、聚合逻辑设计

### 8.1 聚合策略

```typescript
interface AggregateRule {
  // 规则 1: 同一 category + 同一 source + 时间窗口 < 1h
  timeWindowMs: number;
  
  // 规则 2: 标题语义相似度 > 0.85 (Embedding)
  similarityThreshold: number;
  
  // 规则 3: 同一 aggregateGroupId（显式指定）
  groupId?: string;
}

// 聚合算法
async function aggregateItems(items: InboxItem[]): Promise<InboxItem[]> {
  // 1. 按 category + source 分组
  const groups = groupBy(items, item => `${item.category}:${item.source}`);
  
  // 2. 对每个组内按时间窗口聚类
  for (const group of groups) {
    const clusters = clusterByTimeWindow(group, 3600000); // 1h
    
    // 3. 对每个时间簇计算 Embedding 相似度
    for (const cluster of clusters) {
      if (cluster.length < 2) continue;
      
      const embeddings = await getEmbeddings(cluster.map(i => i.title));
      const similarityMatrix = computeSimilarityMatrix(embeddings);
      
      // 4. 相似度 > 0.85 的合并为聚合项
      const merged = mergeSimilarItems(cluster, similarityMatrix, 0.85);
      
      // 5. 生成聚合项
      for (const mergedGroup of merged) {
        if (mergedGroup.length < 2) continue;
        
        const aggregateItem: InboxItem = {
          ...mergedGroup[0],
          id: `agg_${crypto.randomUUID()}`,
          aggregateCount: mergedGroup.length,
          aggregateGroupId: mergedGroup[0].id,
          title: `${mergedGroup[0].title} (等 ${mergedGroup.length} 条)`,
          payload: {
            ...mergedGroup[0].payload,
            aggregatedItems: mergedGroup,
          }
        };
        
        // 替换原 items
        replaceItems(items, mergedGroup, aggregateItem);
      }
    }
  }
  
  return items;
}
```

### 8.2 前端聚合展示

```tsx
<InboxAggregate 
  item={aggregateItem}
  onExpand={() => setExpanded(true)}
>
  {expanded && (
    <div className="aggregate-children">
      {item.payload.aggregatedItems?.map(child => (
        <InboxCard key={child.id} item={child} nested />
      ))}
    </div>
  )}
</InboxAggregate>
```

---

## 九、实施路线图

### Phase 1: 基础设施 (Week 1)

| Day | 任务 | 文件 | 验收标准 |
|-----|------|------|----------|
| D1 | **数据库迁移** | `db/migrations/v9_inbox_scheduler.sql` | `inbox_items` + `scheduled_events` 表创建成功，MySQL migration v9 注册 |
| D1 | **安装依赖** | `package.json` | `bull`, `@types/bull` 安装完成 |
| D2 | **SchedulerService 骨架** | `src/scheduler/scheduler-service.ts` | Bull 队列初始化，支持 `createEvent` / `cancelEvent` / `processJob` |
| D2 | **SchedulerWorker** | `src/scheduler/scheduler-worker.ts` | 任务到达时触发，调用 DeliveryRouter |
| D3 | **InboxService 骨架** | `src/inbox/inbox-service.ts` | CRUD 操作完成，支持 `createItem` / `listItems` / `updateStatus` |
| D3 | **InboxRepository** | `src/inbox/inbox-repository.ts` | MySQL 读写完成，所有查询走索引 |
| D4 | **InboxRoutes API** | `src/inbox/inbox-routes.ts` | `/api/inbox/*` 全部 API 可用，Postman 测试通过 |
| D4 | **DeliveryRouter** | `src/inbox/delivery-router.ts` | `route()` 方法决策正确，支持 Chat/Inbox/Email 投递 |
| D5 | **单元测试 + 联调** | - | Scheduler 创建任务 → Bull 触发 → DeliveryRouter → InboxItem 创建，全链路跑通 |

### Phase 2: 前端 + Chat 整合 (Week 2)

| Day | 任务 | 文件 | 验收标准 |
|-----|------|------|----------|
| D6 | **Inbox Zustand Store** | `web/src/store/inbox-store.ts` | 状态管理完成，支持 fetch / markRead / complete / dismiss |
| D6 | **InboxPanel 骨架** | `web/src/components/inbox/InboxPanel.tsx` | 可折叠面板，Tab 切换正常 |
| D7 | **InboxCard + InboxList** | `web/src/components/inbox/InboxCard.tsx` | 卡片渲染正确，支持不同类型样式区分 |
| D7 | **InboxBadge** | `web/src/components/inbox/InboxBadge.tsx` | 顶部导航显示未读数，点击展开下拉列表 |
| D8 | **Chat.tsx 整合** | `web/src/pages/Chat.tsx` | InboxPanel 嵌入 Chat 页面，布局正常 |
| D8 | **SSE inbox 事件** | `web/src/pages/Chat.tsx` + `src/server.ts` | SSE 新增 `inbox_item` / `inbox_update` 事件，前端实时更新 |
| D9 | **Workflow Adapter** | `src/inbox/adapters/workflow-adapter.ts` | Workflow UserTask 创建时同步创建 InboxItem |
| D9 | **移除 ApprovalCenter** | `web/src/pages/ApprovalCenter.tsx` | 页面移除，路由指向 Chat（带 inbox 参数） |
| D10 | **联调测试** | - | 发起 Workflow → Chat 中收到 Inbox 卡片 → 处理 → 状态更新，全流程通过 |

### Phase 3: 定时任务 + AI 审批 (Week 3)

| Day | 任务 | 文件 | 验收标准 |
|-----|------|------|----------|
| D11 | **Schedule Skills** | `src/scheduler/schedule-skills.ts` | `schedule_create` / `schedule_cancel` / `schedule_list` 注册成功 |
| D11 | **Agent 定时意图识别** | `src/llm/agent-loop.ts` | Agent 识别"明天提醒我"意图，调用 schedule_create |
| D12 | **定时任务前端展示** | `web/src/components/inbox/ReminderCard.tsx` | Inbox 中⏰标签显示，支持取消 |
| D12 | **Escalation 策略** | `src/scheduler/scheduler-service.ts` | 升级策略执行正确（延迟后 IM/Email 推送） |
| D13 | **AI Review Hook** | `src/inbox/ai-review-hook.ts` | 异步触发，LLM 生成建议，存入 ai_suggestion |
| D13 | **上下文加载** | `src/inbox/ai-review-hook.ts` | LTM + KB + DB + ChatHistory 上下文加载完成 |
| D14 | **AISuggestion 组件** | `web/src/components/inbox/AISuggestion.tsx` | 前端展示 AI 建议，支持展开/折叠 |
| D14 | **聚合逻辑** | `src/inbox/inbox-service.ts` | 时间窗口 + Embedding 相似度聚合完成 |
| D15 | **Aggregate 组件** | `web/src/components/inbox/InboxAggregate.tsx` | 聚合项展开正常，子项显示正确 |

### Phase 4: Evolution 迁移 + 完善 (Week 4)

| Day | 任务 | 文件 | 验收标准 |
|-----|------|------|----------|
| D16 | **Evolution Adapter** | `src/inbox/adapters/evolution-adapter.ts` | PendingApproval → InboxItem |
| D16 | **移除 PendingActions** | `web/src/components/evolution/PendingActions.tsx` | 进化审批走 Inbox |
| D17 | **Email/IM 推送** | `src/inbox/delivery-router.ts` | 离线用户收到 Email/IM 推送 |
| D17 | **用户偏好设置** | `web/src/pages/Settings.tsx` | 通知渠道偏好设置 |
| D18 | **端到端测试** | `tests/integration/inbox-scheduler.test.ts` | 全链路测试覆盖 |
| D18 | **性能测试** | - | 1000 并发 InboxItem 创建 + 聚合，响应 < 100ms |
| D19 | **文档 + 迁移指南** | `docs/inbox-scheduler.md` | 开发文档、API 文档、迁移指南 |
| D20 | **代码审查 + 合并** | - | PR 审查通过，合并到 main |

---

## 十、风险与应对

| 风险 | 影响 | 应对策略 |
|------|------|----------|
| Bull 依赖 Redis，Redis 宕机则定时任务不可用 | 高 | 1. SchedulerService 启动时检查 Redis 健康 2. 定时任务持久化到 MySQL，Redis 恢复后自动重建队列 |
| Embedding 聚合计算量大 | 中 | 1. 聚合计算异步执行 2. 短时间窗口内（<1h）才触发聚合 3. 使用缓存避免重复计算 |
| AI Review Hook 调用 LLM 延迟高 | 中 | 1. 异步执行，不阻塞 InboxItem 创建 2. 设置超时（5s），超时则标记为"AI 建议生成中" |
| 前端 InboxPanel 性能（大量 items） | 中 | 1. 虚拟滚动 2. 分页加载（每页 20 条）3. 聚合减少展示数量 |
| Workflow 审批迁移后旧数据兼容 | 低 | 旧 WorkflowTask 数据保留，仅新创建的 Task 走 Inbox，旧 Task 仍可通过 API 查询 |

---

## 十一、关键设计原则

1. **单一事实源**: InboxItem 是所有被动消息的唯一入口，不再有任何独立的消息/审批/通知表
2. **异步优先**: AI Review、聚合、投递升级 全部异步执行，不阻塞主流程
3. **上下文绑定**: 每个 InboxItem 尽可能关联 conversationId，确保用户处理时能看到完整上下文
4. **渐进式迁移**: 旧系统的审批数据不动，仅新数据走 Inbox，降低迁移风险
5. **可扩展**: Adapter 模式确保未来新增来源（如第三方 Webhook）只需新增 Adapter，不改核心逻辑

---

> 计划制定完成。是否开始 Phase 1 的实施？
