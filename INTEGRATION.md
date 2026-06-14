# RAOS 第三方集成指南

> 本文档面向需要在自有网站、应用或系统中集成 RAOS 智能体能力的**第三方开发者**。

---

## 目录

- [概述](#概述)
- [嵌入小部件（Embed Widget）](#嵌入小部件embed-widget)
- [REST API](#rest-api)
- [鉴权机制](#鉴权机制)
- [双向通信](#双向通信)
- [Webhook 连接](#webhook-连接)
- [多租户支持](#多租户支持)
- [安全注意事项](#安全注意事项)
- [完整示例](#完整示例)

---

## 概述

RAOS 提供三种主要的第三方集成方式：

| 集成方式 | 适用场景 | 技术门槛 | 开发量 |
|---------|---------|---------|--------|
| **嵌入小部件** | 在网站右下角挂载对话窗口 | 低 | 复制一行 `<script>` |
| **REST API** | 后端系统对接、自定义前端 | 中 | 调用 HTTP 接口 |
| **Webhook** | 事件通知、外部系统回调 | 中 | 配置 URL + 接收 POST |

---

## 嵌入小部件（Embed Widget）

嵌入小部件是最简单的集成方式，只需在网页中引入一行脚本即可在右下角展示对话窗口。

### 快速开始

```html
<script
  src="https://your-raos-domain.com/widget.js"
  data-token="用户的JWT令牌"
  data-skill="kb_search"
  data-theme="light"
  data-lang="zh"
></script>
```

### `data-*` 参数全表

| 属性 | 类型 | 默认值 | 必填 | 说明 |
|------|------|--------|------|------|
| `data-token` | `string` | `""` | 条件 | JWT 认证令牌。跨域场景必须提供 |
| `data-base-url` | `string` | 自动推断 | 否 | RAOS 服务根地址，默认取脚本所在域名 |
| `data-position` | `string` | `"bottom-right"` | 否 | 初始位置：`bottom-right`、`bottom-left`、`top-right`、`top-left` |
| `data-bottom` | `number` | `20` | 否 | 距底部距离（px） |
| `data-right` | `number` | `20` | 否 | 距右侧距离（px） |
| `data-left` | `number` | `20` | 否 | 距左侧距离（px） |
| `data-top` | `number` | `20` | 否 | 距顶部距离（px） |
| `data-title` | `string` | `"RAOS 智能助手"` | 否 | 窗口标题 |
| `data-width` | `number` | `420` | 否 | 弹窗宽度（px） |
| `data-height` | `number` | `640` | 否 | 弹窗高度（px） |
| `data-z-index` | `number` | `999999` | 否 | CSS 层级 |
| `data-role` | `string` | `""` | 否 | 角色标识，如 `presales`、`support`，用于后端路由到不同角色配置 |
| `data-skill` | `string` | `""` | 否 | 默认 Skill，如 `kb_search` |
| `data-conversation` | `string` | `""` | 否 | 已有会话 ID，恢复上下文 |
| `data-theme` | `string` | `"light"` | 否 | 主题：`light` 或 `dark` |
| `data-lang` | `string` | `"zh"` | 否 | 语言：`zh`（中文）或 `en`（英文） |
| `data-context` | `string` | `""` | 否 | 外部上下文 JSON 字符串，如 `{"customerId":"C123","orderId":"O456"}` |
| `data-tenant` | `string` | `""` | 否 | 租户标识，多租户场景使用 |
| `data-user-id` | `string` | `""` | 否 | 外部用户 ID，与 `tenant` 配合用于匿名用户映射 |

### 参数传递链路

所有 `data-*` 参数按以下链路传递：

```
网页 data-* 属性
    ↓
widget.js 解析为 config 对象
    ↓
通过 URL Query 参数注入 iframe（如 ?skill=kb_search&theme=light）
    ↓
EmbedChat.tsx 读取 URL 参数 → React State
    ↓
作为 props 传入 ChatPage.tsx
    ↓
通过 HTTP API 请求体发送到后端
```

### 认证回退链

当未提供 `data-token` 或 token 失效时，嵌入页按以下顺序自动获取身份：

1. **URL Token**（`?token=...`）— 最高优先级
2. **localStorage**（`raos-auth` 键值）— 浏览器本地缓存
3. **`postMessage` 注入** — 父页面主动推送 `{ type: "RAOS_AUTH", token: "..." }`
4. **Visitor API**（`POST /api/auth/visitor`）— 1.5 秒超时后自动降级为访客模式

若全部失败，展示登录界面。

### 拖拽与持久化

小部件支持鼠标拖拽调整位置，最终坐标自动写入 `localStorage`，刷新后位置保持不变。

---

## REST API

### 基础信息

| 项目 | 值 |
|------|-----|
| Base URL | `https://your-raos-domain.com/api` |
| 协议 | HTTPS |
| 数据格式 | JSON |
| 认证方式 | `Authorization: Bearer <token>` 或 HttpOnly Cookie |

### 1. 匿名登录

用于无需注册用户体系的场景，通过手机号创建临时身份。

```http
POST /api/auth/anonymous
Content-Type: application/json
```

**请求体：**

```json
{
  "phone": "13800138000",
  "tenant": "acme_corp",
  "externalUserId": "user_12345"
}
```

| 字段 | 类型 | 必填 | 约束 |
|------|------|------|------|
| `phone` | `string` | ✅ | 中国大陆手机号 `/^1[3-9]\d{9}$/` |
| `tenant` | `string` | 否 | 去空白，最长 32 字符，禁止 `[<>'"&\s]` |
| `externalUserId` | `string` | 否 | 去空白，最长 64 字符 |

**响应：**

```json
{
  "success": true,
  "token": "eyJhbGciOiJIUzI1NiIs...",
  "expiresAt": 1715678901234,
  "user": {
    "id": "usr_xxx",
    "username": "acme_corp_user_12345_a3f9",
    "role": "anonymous"
  }
}
```

> 后端会自动写入名为 `token` 的 HttpOnly Cookie。

**租户隔离规则：**
- 若请求携带 `tenant`，系统会检查该手机号已有用户的 `username` 前缀是否与 `tenant` 匹配
- 不匹配时返回 `403 Forbidden`（"租户不匹配"）
- 新用户命名规则（含租户）：`${tenant}_${externalUserId || phone后4位}_${随机4位十六进制}`
- 新用户命名规则（无租户）：`guest_${phone后4位}_${随机4位十六进制}`

### 2. 访客登录

无需手机号，直接创建一次性访客身份。适用于最轻量的嵌入场景。

```http
POST /api/auth/visitor
Content-Type: application/json
```

**请求体：**

```json
{
  "tenant": "acme_corp",
  "externalUserId": "visitor_001"
}
```

| 字段 | 类型 | 必填 | 约束 |
|------|------|------|------|
| `tenant` | `string` | 否 | 同匿名登录 |
| `externalUserId` | `string` | 否 | 同匿名登录 |

**响应格式**与匿名登录相同。

> 访客用户名规则（含租户）：`${tenant}_${externalUserId || visitorId}`，其中 `visitorId = "v_" + UUID前12位`

### 3. 同步聊天

单轮问答，非流式返回完整结果。

```http
POST /api/agent/chat
Authorization: Bearer <token>
Content-Type: application/json
```

**请求体：**

```json
{
  "message": "查询本周订单状态",
  "mode": "auto",
  "conversationId": "conv_abc123",
  "defaultSkill": "order_query",
  "context": {
    "customerId": "C123",
    "department": "sales"
  }
}
```

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `message` | `string` | ✅ | 用户输入 |
| `mode` | `string` | 否 | 执行模式：`auto`（自动选择）、`simple`、`react`、`legacy`，默认 `auto` |
| `conversationId` | `string` | 否 | 会话 ID，用于隔离对话历史 |
| `defaultSkill` | `string` | 否 | 默认 Skill，自动注入到消息前缀 |
| `context` | `object` | 否 | 外部上下文，Skill 执行时可通过 `ChatOptions.context` 读取 |

**响应：**

```json
{
  "success": true,
  "data": {
    "content": "本周共有 12 笔订单...",
    "skillCalls": [...]
  }
}
```

### 4. 流式聊天（SSE）

推荐用于对话场景，服务端逐字推送，体验更流畅。

```http
POST /api/agent/chat/stream
Authorization: Bearer <token>
Content-Type: application/json
```

请求体与同步聊天完全一致。

**响应头：**

```http
Content-Type: text/event-stream
Cache-Control: no-cache
Connection: keep-alive
X-Accel-Buffering: no
```

**SSE 事件类型：**

| 事件名 | 触发时机 | 数据格式 |
|--------|---------|---------|
| `connected` | 流连接建立 | `{}` |
| `text_delta` | 生成文本片段 | `{ "text": "片段内容" }` |
| `tool_call` | LLM 决定调用工具 | `{ "skillName": "...", "args": {...} }` |
| `tool_start` | 工具开始执行 | `{ "skillName": "...", "args": {...} }` |
| `tool_result` | 工具执行完成 | `{ "skillName": "...", "result": { "success": true, "data": ... } }` |
| `kb_references` | 知识库引用就绪 | `{ "references": [...] }` |
| `web_references` | 网页搜索引用就绪 | `{ "references": [...] }` |
| `strategy_selected` | 策略已选定 | `{ "level": "simple" \| "react" \| "team", "reasoning": "..." }` |
| `user_confirm` | 需要用户确认 | 确认面板数据 |
| `thinking` | 思维链输出 | `{ "content": "...", "iteration": 1 }` |
| `error` | 执行出错 | `{ "error": "错误描述" }` |

**前端连接示例（JavaScript）：**

```javascript
const eventSource = new EventSource('/api/agent/chat/stream', {
  method: 'POST',
  headers: { 'Authorization': 'Bearer ' + token },
  body: JSON.stringify({ message: '你好', context: { customerId: 'C123' } })
});

eventSource.addEventListener('text_delta', (e) => {
  const { text } = JSON.parse(e.data);
  appendToChat(text);
});
```

### 5. 连接管理

管理外部系统连接配置（SMTP、LDAP、Webhook 等）。

```http
GET    /api/connections           # 列出所有连接
GET    /api/connections/:id       # 获取单个连接
POST   /api/connections           # 创建连接
PUT    /api/connections/:id       # 更新连接
DELETE /api/connections/:id       # 删除连接
POST   /api/connections/:id/test  # 测试连接
```

**创建 Webhook 连接示例：**

```http
POST /api/connections
Authorization: Bearer <token>
Content-Type: application/json

{
  "name": "订单通知Webhook",
  "type": "webhook",
  "config": {
    "url": "https://partner.example.com/callback",
    "method": "POST",
    "headers": {
      "X-Partner-Key": "sk_xxxx"
    },
    "timeout": 10000
  },
  "isActive": true
}
```

---

## 鉴权机制

### Token 传递方式（优先级从高到低）

1. **请求头**：`Authorization: Bearer <jwt_token>`
2. **HttpOnly Cookie**：`Cookie: token=<jwt_token>`
3. **URL Query**：`?token=<jwt_token>`（仅 Embed 场景）

### 权限体系

RAOS 采用 RBAC + ABAC 混合模型：

| 角色 | 权限数量 | 典型权限 |
|------|---------|---------|
| `admin` | 215 | 全部 |
| `user` | 48 | 聊天、记忆读写、工作流执行 |
| `anonymous`（访客/匿名） | 18 | 基础聊天、文件上传 |

Embed Widget 中通过 `data-role` 可指定后端路由到特定角色配置，但权限边界仍由服务端控制。

---

## 双向通信

### 子页面 → 父页面（`postMessage`）

当小部件嵌入在 iframe 中时，ChatPage 会通过 `postMessage` 向父页面发送事件：

```javascript
window.parent.postMessage(
  { type: "RAOS_EVENT", event: "message_sent", data: { conversationId: "...", message: "..." } },
  "*"
);
```

**事件清单：**

| 事件名 | 触发时机 | payload |
|--------|---------|---------|
| `conversation_ready` | 开始调用 API 前 | `{ conversationId }` |
| `message_sent` | 用户发送消息时 | `{ conversationId, message }` |
| `agent_done` | 流式响应正常结束 | `{ conversationId }` |
| `error` | 发生非中断错误 | `{ conversationId, error }` |

**父页面监听示例：**

```javascript
window.addEventListener('message', (e) => {
  if (e.data?.type !== 'RAOS_EVENT') return;

  switch (e.data.event) {
    case 'message_sent':
      console.log('用户发送了消息:', e.data.data.message);
      break;
    case 'agent_done':
      console.log('AI 回复完成, 会话ID:', e.data.data.conversationId);
      break;
    case 'error':
      console.error('嵌入窗口报错:', e.data.data.error);
      break;
  }
});
```

### 父页面 → 子页面（`postMessage`）

父页面可通过 `postMessage` 向 iframe 注入认证令牌：

```javascript
iframe.contentWindow.postMessage(
  { type: "RAOS_AUTH", token: "用户的JWT令牌" },
  "https://your-raos-domain.com"
);
```

> ⚠️ 建议将 `targetOrigin` 设为 RAOS 实际域名，避免 `*` 带来的安全隐患。

---

## Webhook 连接

Webhook 用于将 RAOS 内部事件推送到外部系统。目前通过「连接管理」API 配置。

### 配置 Schema

```typescript
{
  url: string;                    // 目标地址，仅支持 http/https
  method?: string;                // HTTP 方法，默认 "POST"
  headers?: Record<string, string>; // 自定义请求头
  timeout?: number;               // 超时毫秒，默认 5000，最大 30000
}
```

### 测试连接时的 Payload

```json
{
  "event": "connection.test",
  "timestamp": 1715678901234,
  "source": "raos",
  "message": "这是一条连接测试消息"
}
```

### SSRF 防护

系统内置以下安全限制：
- **协议白名单**：仅允许 `http://` 和 `https://`
- **本地地址黑名单**：禁止 `localhost`、`* .local`、`127.0.0.1`、`0.0.0.0`
- **私有网段拦截**：
  - `10.0.0.0/8`
  - `127.0.0.0/8`
  - `172.16.0.0/12`
  - `192.168.0.0/16`
  - `169.254.0.0/16`

---

## 多租户支持

RAOS 支持通过用户名前缀编码实现逻辑租户隔离（当前版本无独立 `tenant` 数据库字段）。

### 参数传递

```html
<script
  src=".../widget.js"
  data-tenant="acme_corp"
  data-user-id="user_12345"
></script>
```

### 用户名生成规则

| 场景 | 格式 | 示例 |
|------|------|------|
| 匿名 + 租户 | `{tenant}_{extUserId \| phone后4位}_{随机4位}` | `acme_corp_3800_a3f9` |
| 匿名 + 无租户 | `guest_{phone后4位}_{随机4位}` | `guest_3800_a3f9` |
| 访客 + 租户 | `{tenant}_{extUserId \| visitorId}` | `acme_corp_user_12345` |
| 访客 + 无租户 | `visitor_{visitorId}` | `visitor_v_a1b2c3d4e5f6` |

### 跨租户保护

当使用手机号登录匿名用户时，如果请求指定了 `tenant`，系统会校验已有用户的用户名前缀是否与该 `tenant` 一致。不一致时拒绝登录并返回 `403`，防止跨租户会话劫持。

---

## 安全注意事项

1. **Token 安全**
   - 生产环境务必使用 HTTPS
   - 跨域嵌入时优先通过 `postMessage` 动态注入 token，避免硬编码在 HTML 中
   - Token 有效期由服务端控制，过期后需重新获取

2. **`context` 参数长度**
   - `data-context` 通过 URL Query 传递，受浏览器 URL 长度限制（通常 ~8KB）
   - 大数据量场景建议通过后端 API 预存上下文，只传递引用 ID

3. **`postMessage` 来源校验**
   - 父页面监听 iframe 消息时，建议校验 `event.origin`
   - 子页面接收父消息时（RAOS 已内置 token 校验），仍应注意 targetOrigin

4. **Webhook 安全**
   - 外部系统接收 Webhook 时应校验请求来源（如签名、IP 白名单）
   - RAOS 已内置 SSRF 防护，但仍建议对回调 URL 做业务层审批

---

## 完整示例

### 场景：电商网站嵌入智能客服

**需求：**
- 网站右下角挂载对话窗口
- 自动带入当前登录用户的 `customerId` 和 `orderId`
- 使用 `support` 角色配置
- 暗黑模式，中文

**HTML 集成：**

```html
<!DOCTYPE html>
<html>
<head>
  <title>我的商城</title>
</head>
<body>
  <!-- 页面内容 -->

  <!-- RAOS 嵌入小部件 -->
  <script
    id="raos-widget"
    src="https://raos.example.com/widget.js"
    data-token=""
    data-role="support"
    data-skill="customer_support"
    data-theme="dark"
    data-lang="zh"
    data-context='{"customerId":"C12345","vipLevel":"gold"}'
    data-tenant="myshop"
    data-user-id="user_98765"
    data-title="商城智能客服"
  ></script>

  <script>
    // 用户登录后，动态注入 token
    function onUserLogin(token) {
      const iframe = document.querySelector('#raos-iframe');
      if (iframe) {
        iframe.contentWindow.postMessage(
          { type: 'RAOS_AUTH', token },
          'https://raos.example.com'
        );
      }
    }

    // 监听客服对话事件
    window.addEventListener('message', (e) => {
      if (e.origin !== 'https://raos.example.com') return;
      if (e.data?.type !== 'RAOS_EVENT') return;

      if (e.data.event === 'agent_done') {
        // AI 回复完成，可触发满意度评价
        showRatingDialog(e.data.data.conversationId);
      }
    });
  </script>
</body>
</html>
```

**后端代理（可选，用于隐藏 token）：**

```javascript
// Node.js 示例：由后端生成带签名的匿名登录
app.post('/api/get-raos-token', async (req, res) => {
  const { userId } = req.session;

  // 调用 RAOS 匿名登录
  const response = await fetch('https://raos.example.com/api/auth/visitor', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      tenant: 'myshop',
      externalUserId: userId
    })
  });

  const data = await response.json();
  res.json({ token: data.token });
});
```

---

## 附录：错误码速查

| HTTP 状态 | 场景 |
|-----------|------|
| `400` | 请求参数格式错误（手机号不合法、tenant 含非法字符等） |
| `403` | 租户不匹配（匿名登录时手机号已存在但属于其他租户） |
| `404` | 连接配置不存在 |
| `409` | 连接名称冲突 |
| `500` | 服务端内部错误 |

---

*文档版本：v1.0.0 | 最后更新：2026-05-10*
