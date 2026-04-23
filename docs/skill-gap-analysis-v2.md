# RAOS Skill 补充规划 — 精简版缺口清单（含工作流引擎设计）

> **排除范围**：SAP 相关 Skill、ERP 相关 Skill（用友/金蝶/鼎捷等）、财务/供应链相关 Skill
> **保留范围**：基础设施、OA/协同办公、数据集成、监控运维、RPA、安全合规
> **新增基础设施**：Workflow Engine Lite（轻量级工作流引擎）

---

## 1. 缺口总览

排除 SAP/ERP 后，剩余 **32 个**需要补充的系统 Skill + **1 个**基础设施（Workflow Engine Lite），按优先级和类别分组如下：

| 类别 | 数量 | Phase |
|------|------|-------|
| **工作流引擎（基础设施）** | 1 个核心引擎 | Phase 0（必须先做） |
| 身份认证与目录服务 | 5 | Phase 1 + Phase 3 |
| 消息通知与通信 | 3 | Phase 1 |
| 日历与会议 | 2 | Phase 1 |
| 审批与任务（基于工作流引擎） | 6 | Phase 2 |
| 数据集成与中间件 | 8 | Phase 2 + Phase 3 |
| 监控与运维 | 4 | Phase 3 |
| RPA / UI 自动化 | 4 | Phase 3 |
| **总计** | **33** | — |

---

## 2. Phase 0：Workflow Engine Lite（🔴 必须先做，2-3 周）

### 2.1 为什么必须先做工作流引擎

approval_submit / approval_query / approval_approve / task_create / task_query / task_update 这 6 个 Skill 都依赖一个**通用的、持久化的、可配置的工作流引擎**。如果每个 Skill 单独实现状态管理，会导致：

1. 代码重复（每个审批类型都要写一套状态机）
2. 状态不一致（内存中丢失、重启后无法恢复）
3. 无法支持复杂场景（条件分支、多级审批、会签、超时）
4. 无法提供统一的审计和历史查询

### 2.2 设计原则

借鉴 Camunda/Flowable/xstate 的核心概念，但**不引入完整 BPMN 引擎**：

| 来源 | 借鉴内容 |
|------|---------|
| **Camunda** | BPMN 概念、消息关联、边界事件、补偿（Saga）机制 |
| **Flowable** | 低代码表单设计、文档审批场景 |
| **xstate** | 状态机模型（States/Transitions/Guards/Actions/Context） |
| **Laravel Workflow** | Guards 与 Actions 分离、乐观锁、幂等性 |

**核心决策**：
- **JSON DSL** 而非 BPMN XML（对 AI 更友好，LLM 可直接生成和修改）
- **嵌入式** 而非独立服务（与 RAOS 同一进程，减少部署复杂度）
- **四层抽象**：流程定义 → 流程实例 → 任务 → 执行引擎

### 2.3 数据模型

#### workflow_definitions（流程定义）

```sql
CREATE TABLE workflow_definitions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name VARCHAR(128) NOT NULL,
  key VARCHAR(64) NOT NULL UNIQUE,
  version INTEGER DEFAULT 1,
  category VARCHAR(64),
  definition JSON NOT NULL,
  form_schema JSON,
  created_by VARCHAR(64),
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
```

#### workflow_instances（流程实例）

```sql
CREATE TABLE workflow_instances (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  definition_id INTEGER NOT NULL,
  definition_version INTEGER DEFAULT 1,
  business_key VARCHAR(128),
  starter VARCHAR(64),
  status VARCHAR(32) DEFAULT 'running',
  current_node_id VARCHAR(64),
  variables JSON,
  started_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  completed_at DATETIME,
  FOREIGN KEY (definition_id) REFERENCES workflow_definitions(id)
);
```

#### workflow_tasks（任务）

```sql
CREATE TABLE workflow_tasks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  instance_id INTEGER NOT NULL,
  node_id VARCHAR(64) NOT NULL,
  node_name VARCHAR(128),
  task_type VARCHAR(32),
  assignee VARCHAR(64),
  candidate_users JSON,
  candidate_groups JSON,
  status VARCHAR(32) DEFAULT 'pending',
  form_data JSON,
  comment TEXT,
  action VARCHAR(32),
  due_date DATETIME,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  claimed_at DATETIME,
  completed_at DATETIME,
  FOREIGN KEY (instance_id) REFERENCES workflow_instances(id)
);
```

#### workflow_variables（流程变量）

```sql
CREATE TABLE workflow_variables (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  instance_id INTEGER NOT NULL,
  name VARCHAR(128) NOT NULL,
  value TEXT,
  type VARCHAR(32),
  FOREIGN KEY (instance_id) REFERENCES workflow_instances(id)
);
```

### 2.4 流程定义 JSON DSL 示例

```json
{
  "key": "expense_approval",
  "name": "报销审批",
  "nodes": [
    { "id": "start", "type": "start_event", "next": "fill_form" },
    { "id": "fill_form", "type": "user_task", "name": "填写报销单",
      "form": {
        "fields": [
          { "key": "amount", "label": "金额", "type": "number", "required": true },
          { "key": "category", "label": "类别", "type": "select", "options": ["差旅", "办公", "招待"] }
        ]
      },
      "next": "manager_approval"
    },
    { "id": "manager_approval", "type": "user_task", "name": "经理审批",
      "assignee_policy": "starter.manager",
      "actions": ["approve", "reject", "transfer"],
      "next": "check_amount"
    },
    { "id": "check_amount", "type": "exclusive_gateway", "name": "金额检查",
      "conditions": [
        { "name": "大额", "expression": "${amount} >= 5000", "next": "director_approval" },
        { "name": "普通", "expression": "default", "next": "notify_result" }
      ]
    },
    { "id": "director_approval", "type": "user_task", "name": "总监审批",
      "assignee_policy": "starter.director",
      "actions": ["approve", "reject"],
      "next": "notify_result"
    },
    { "id": "notify_result", "type": "service_task", "name": "通知结果",
      "service": "email_notification",
      "config": { "template": "approval_result", "to": "${starter.email}" },
      "next": "end"
    },
    { "id": "end", "type": "end_event", "name": "结束" }
  ]
}
```

### 2.5 实施子阶段

| 子阶段 | 内容 | 工作量 | 产出 |
|--------|------|--------|------|
| **MVP** | 基础状态机引擎 + 单步审批 + 数据库表 | 5-7 天 | `workflow_engine.ts` + 4 张表 |
| **V1** | 条件分支、多级审批、任务分配、守卫条件 | 7-10 天 | 完整的 approval/task Skill trio |
| **V2** | 并行审批（会签）、定时器（超时提醒）、事件系统 | 7-10 天 | 事件驱动 + 定时任务 |
| **V3** | 补偿机制（Saga）、子流程、流程模板市场 | 10-14 天 | 企业级完整能力 |

---

## 3. Phase 1：基础设施层（🔴 最高优先级，1-2 个月）

**目标**：建立与企业 IT 基础设施的基础连接，实现消息通知、用户目录、日历集成。

### 3.1 安全增强（1 项，非 Skill，但必须最先做）

| 改动 | 功能 | 场景 |
|------|------|------|
| `http_call` 内网白名单 | 允许访问指定内网域名/IP | 企业内网 API 调用 |

**说明**：
- 当前 `http_call` 一刀切禁止所有内网地址
- 改为"默认禁止 + 系统管理员白名单"模式
- 白名单支持域名、IP、CIDR（如 `10.0.0.0/8`）
- **这是后续 approval/task/health_check 等 Skill 的前提条件**

### 3.2 消息通知（3 个）

| Skill | 功能 | 场景 | 依赖库 | 工作量 |
|-------|------|------|--------|--------|
| `email_send` | SMTP 发送邮件 | 审批通知、日报推送、告警通知 | `nodemailer` | 2-3 天 |
| `email_read` | IMAP 读取邮件 | 邮件摘要、自动分类、待办提取 | `imap` | 2-3 天 |
| `im_bot_send` | IM 机器人消息 | 钉钉/企微/飞书实时通知、@提醒 | 无（纯 HTTP） | 1-2 天 |

### 3.3 身份认证与目录服务（2 个）

| Skill | 功能 | 场景 | 依赖库 | 工作量 |
|-------|------|------|--------|--------|
| `ldap_search` | 查询 AD/LDAP | 组织架构展示、用户查找 | `ldapjs` | 3-4 天 |
| `ldap_auth` | LDAP 用户认证 | 替代本地账号，统一登录 | `ldapjs` | 2-3 天 |

### 3.4 日历与会议（2 个）

| Skill | 功能 | 场景 | 依赖库 | 工作量 |
|-------|------|------|--------|--------|
| `calendar_query` | 查询日程 | "我今天有什么会？" | `ews-javascript-api` / `dav` | 3-4 天 |
| `calendar_create` | 创建会议 | 自动预约会议、发送邀请 | `ews-javascript-api` / `dav` | 2-3 天 |

### Phase 1 工作量汇总

| 类别 | Skill 数 | 工作量 |
|------|---------|--------|
| http_call 白名单 | — | 1-2 天 |
| 消息通知 | 3 | 5-8 天 |
| LDAP | 2 | 5-7 天 |
| 日历 | 2 | 5-7 天 |
| **合计** | **7** | **16-24 天** |

---

## 4. Phase 2：业务系统对接层（🟡 高优先级，2-3 个月）

**目标**：基于 Workflow Engine Lite 实现审批和任务管理，接入 Kafka 数据流。

### 4.1 审批流（3 个）

| Skill | 功能 | 场景 | 依赖 | 工作量 |
|-------|------|------|------|--------|
| `approval_submit` | 提交审批申请 | 报销、请假、采购发起 | Workflow Engine Lite | 3-4 天 |
| `approval_query` | 查询审批状态和列表 | "我有哪些待审批的？" | Workflow Engine Lite | 2-3 天 |
| `approval_approve` | 审批通过/驳回/转交 | 在 RAOS 中完成审批 | Workflow Engine Lite | 2-3 天 |

**说明**：
- 3 个 Skill 共用 Workflow Engine Lite 的数据库表
- `approval_submit` 启动流程实例，`approval_query` 查询任务列表，`approval_approve` 完成任务并推进状态机
- 钉钉/企微/飞书的标准化审批 API 优先直接支持
- 其他 OA（泛微、致远、蓝凌）通过 `api_import` + `http_call` 对接

### 4.2 任务管理（3 个）

| Skill | 功能 | 场景 | 依赖 | 工作量 |
|-------|------|------|------|--------|
| `task_create` | 创建任务/待办 | "帮我创建一个跟进任务" | Workflow Engine Lite / HTTP API | 2-3 天 |
| `task_query` | 查询任务列表 | "我今天有哪些待办？" | Workflow Engine Lite / HTTP API | 2-3 天 |
| `task_update` | 更新任务状态 | 标记完成、调整优先级 | Workflow Engine Lite / HTTP API | 2-3 天 |

**说明**：
- 任务管理有两种模式：
  1. **独立任务**（简单 todo）：直接操作 task 表，不关联工作流
  2. **工作流任务**（审批中的任务）：由 Workflow Engine Lite 创建和管理
- `task_create` 支持创建独立任务或启动简单工作流

### 4.3 数据集成（2 个）

| Skill | 功能 | 场景 | 依赖库 | 工作量 |
|-------|------|------|--------|--------|
| `kafka_consume` | Kafka 消息消费 | 实时数据流处理、事件驱动 | `kafkajs` | 3-4 天 |
| `kafka_produce` | Kafka 消息生产 | 事件发布、系统间数据同步 | `kafkajs` | 2-3 天 |

### Phase 2 工作量汇总

| 类别 | Skill 数 | 工作量 |
|------|---------|--------|
| 审批流 | 3 | 7-10 天 |
| 任务管理 | 3 | 6-9 天 |
| Kafka | 2 | 5-7 天 |
| **合计** | **8** | **18-26 天** |

---

## 5. Phase 3：高级集成层（🟢 中优先级，3-4 个月）

**目标**：完善安全认证、监控运维、文件传输、协议适配、RPA 自动化。

### 5.1 安全与认证（3 个）

| Skill | 功能 | 场景 | 依赖库 | 工作量 |
|-------|------|------|--------|--------|
| `saml_auth` | SAML 2.0 SSO | 对接企业 IdP（如 ADFS） | `samlify` | 5-7 天 |
| `oauth2_client` | OAuth2 客户端 | 获取第三方系统 access_token | `simple-oauth2` | 3-4 天 |
| `role_sync` | 角色权限同步 | 从 AD/OA 同步 RBAC 到 RAOS | `ldapjs` / HTTP API | 3-4 天 |

### 5.2 监控与运维（4 个）

| Skill | 功能 | 场景 | 依赖库 | 工作量 |
|-------|------|------|--------|--------|
| `health_check` | 健康检查 | 检查业务系统是否可用 | 无（纯 HTTP） | 1-2 天 |
| `alert_query` | 告警查询 | "当前有哪些系统告警？" | HTTP API | 2-3 天 |
| `log_query` | 日志查询 | 故障排查、异常分析 | `@elastic/elasticsearch` | 3-4 天 |
| `metric_query` | 指标查询 | "系统 CPU 使用率多少？" | HTTP API | 3-4 天 |

### 5.3 文件传输（2 个）

| Skill | 功能 | 场景 | 依赖库 | 工作量 |
|-------|------|------|--------|--------|
| `ftp_download` | FTP 文件下载 | 与外部系统文件交换 | `basic-ftp` | 1-2 天 |
| `sftp_upload` | SFTP 文件上传 | 安全文件传输 | `ssh2-sftp-client` | 1-2 天 |

### 5.4 协议适配（3 个）

| Skill | 功能 | 场景 | 依赖库 | 工作量 |
|-------|------|------|--------|--------|
| `soap_call` | SOAP WebService 调用 | 对接传统 SOA 架构系统 | `soap` | 3-4 天 |
| `mqtt_publish` | MQTT 消息发布 | IoT 设备数据上报 | `mqtt` | 1-2 天 |
| `mqtt_subscribe` | MQTT 消息订阅 | 接收传感器/设备数据 | `mqtt` | 1-2 天 |

### 5.5 通用数据库（1 个）

| Skill | 功能 | 场景 | 依赖库 | 工作量 |
|-------|------|------|--------|--------|
| `odbc_query` | ODBC 通用查询 | 连接老式数据库（Access、Excel、达梦 via ODBC） | `odbc` | 3-5 天 |

### 5.6 RPA / UI 自动化（4 个）

| Skill | 功能 | 场景 | 依赖库 | 工作量 |
|-------|------|------|--------|--------|
| `rpa_screenshot` | 屏幕截图 | 获取页面状态 | `puppeteer` | 1-2 天 |
| `rpa_ocr` | OCR 文字识别 | 读取截图/扫描件中的文字 | `tesseract.js` | 2-3 天 |
| `rpa_click` | 模拟鼠标点击 | 无 API 老系统的自动化 | `puppeteer` | 3-5 天 |
| `rpa_type` | 模拟键盘输入 | 表单自动填写 | `puppeteer` | 3-5 天 |

### Phase 3 工作量汇总

| 类别 | Skill 数 | 工作量 |
|------|---------|--------|
| 安全认证 | 3 | 11-15 天 |
| 监控运维 | 4 | 9-13 天 |
| 文件传输 | 2 | 2-4 天 |
| 协议适配 | 3 | 5-8 天 |
| 通用数据库 | 1 | 3-5 天 |
| RPA | 4 | 9-15 天 |
| **合计** | **17** | **39-60 天** |

---

## 6. 整体统计

### 6.1 工作量总览

| Phase | 内容 | Skill/组件数 | 工作量 | 周期 |
|-------|------|-------------|--------|------|
| **Phase 0** | Workflow Engine Lite | 1 个引擎 | 19-31 天 | 3-5 周 |
| **Phase 1** | 消息通知 + LDAP + 日历 + 白名单 | 7 | 16-24 天 | 1-2 个月 |
| **Phase 2** | 审批任务 + Kafka | 8 | 18-26 天 | 2-3 个月 |
| **Phase 3** | 安全认证 + 监控运维 + 文件传输 + 协议 + RPA | 17 | 39-60 天 | 3-4 个月 |
| **总计** | — | **33** | **92-141 天** | **7-11 个月** |

> 注：工作量为纯开发估算，不含测试、文档、联调时间。实际落地建议每个 Phase 预留 30% 缓冲。

### 6.2 依赖库汇总（全部可选）

| 库名 | 用途 | Phase | 动态加载 |
|------|------|-------|---------|
| `nodemailer` | SMTP 邮件发送 | 1 | ✅ |
| `imap` | IMAP 邮件读取 | 1 | ✅ |
| `ldapjs` | LDAP/AD 操作 | 1 | ✅ |
| `ews-javascript-api` | Exchange 日历 | 1 | ✅ |
| `dav` | CalDAV 日历 | 1 | ✅ |
| `kafkajs` | Kafka 客户端 | 2 | ✅ |
| `samlify` | SAML SSO | 3 | ✅ |
| `simple-oauth2` | OAuth2 客户端 | 3 | ✅ |
| `@elastic/elasticsearch` | ES 日志查询 | 3 | ✅ |
| `basic-ftp` | FTP 文件传输 | 3 | ✅ |
| `ssh2-sftp-client` | SFTP 文件传输 | 3 | ✅ |
| `soap` | SOAP WebService | 3 | ✅ |
| `mqtt` | MQTT 客户端 | 3 | ✅ |
| `odbc` | ODBC 通用查询 | 3 | ✅ |
| `puppeteer` | RPA 浏览器自动化 | 3 | ✅（已有） |
| `tesseract.js` | OCR 文字识别 | 3 | ✅ |

---

## 7. 关键架构前提

### 7.1 Connection 配置中心

所有外部系统 Skill 依赖统一的 Connection 配置，需在系统中新增"连接管理"模块：

```
系统设置 → 连接管理
  ├── SMTP 服务器（email_send / email_read）
  ├── LDAP/AD 服务器（ldap_search / ldap_auth）
  ├── Exchange/CalDAV（calendar_query / calendar_create）
  ├── 钉钉/企微/飞书 Webhook（im_bot_send）
  ├── Kafka 集群（kafka_consume / kafka_produce）
  ├── Elasticsearch（log_query）
  ├── Prometheus（metric_query）
  ├── FTP/SFTP 服务器（ftp_download / sftp_upload）
  └── 自定义（health_check、alert_query 等）
```

每个 Connection 包含：名称、类型、连接参数、加密凭证、连通性状态。

### 7.2 http_call 内网白名单

必须在 Phase 1 中完成，否则后续大量 Skill（approval、task、health_check 等）无法调用企业内网 API。

- 当前 `http_call` 一刀切禁止所有内网地址
- 改为"默认禁止 + 系统管理员白名单"模式
- 白名单支持域名、IP、CIDR

### 7.3 审计日志

建议在 Phase 2 开始时引入审计日志系统，记录所有外部系统调用的：时间戳、用户 ID、Skill 名称、目标系统、操作类型、结果状态。

---

## 8. 组合 Skill 场景示例

企业级场景的核心价值在于**编排多个系统**：

### 场景 1：审批通知流水线
```
用户："帮我提交一个报销申请"
→ approval_submit(填写报销单)
→ user_confirm(确认金额和发票)
→ Workflow Engine 推进到经理审批节点
→ email_send(通知审批人)
→ im_bot_send(钉钉提醒直属领导)
```

### 场景 2：新员工入职自动化
```
用户："给张三办理入职"
→ ldap_search(确认账号是否存在)
→ calendar_create(预约入职培训)
→ task_create(创建 IT 设备申请任务)
→ email_send(发送入职欢迎邮件)
→ im_bot_send(通知 HR 和直属经理)
```

### 场景 3：系统异常自动响应
```
触发条件: alert_query 发现告警
→ log_query(查询相关日志)
→ metric_query(查看指标趋势)
→ im_bot_send(通知运维值班人员)
→ task_create(创建故障处理任务)
```

### 场景 4：日报自动生成
```
用户："生成昨天的运营日报"
→ mysql_query(业务数据)
→ kafka_consume(实时事件统计)
→ chart_generate(数据看板)
→ file_provide(生成 .md 报告)
→ email_send(发送给管理层)
```
