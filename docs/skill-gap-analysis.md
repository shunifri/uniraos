# RAOS Skill 补充规划调研报告

> **愿景**：RAOS 成为企业级应用入口，用户不再接触具体的业务系统，而是通过 AI 智能体与所有业务系统交互，实现跨系统的智能协作。
>
> **调研日期**：2026-04-20
> **目标场景**：OA/审批/协同办公 + ERP/财务/供应链（高优先级）
> **部署环境**：私有化部署（内网）

---

## 1. 执行摘要

### 1.1 现有 Skill 覆盖度

RAOS 当前拥有约 **88 个系统 Skill**，覆盖以下领域：

| 领域 | Skill 数量 | 成熟度 | 评价 |
|------|-----------|--------|------|
| 数据库访问 | 18 | ⭐⭐⭐⭐⭐ | 6 种数据库（SQLite/MySQL/PostgreSQL/Redis/MSSQL/Oracle），可选依赖动态加载 |
| 网络/HTTP | 7 | ⭐⭐⭐⭐ | 网页抓取、搜索、通用 HTTP、浏览器渲染 |
| 文件系统 | 12 | ⭐⭐⭐⭐⭐ | 完整的读写、上传、下载、文档解析 |
| 图表可视化 | 3 | ⭐⭐⭐⭐ | ECharts 图表生成、推荐、多图看板 |
| 知识库/图谱 | 15 | ⭐⭐⭐⭐⭐ | 完整的 KB 生命周期管理 + 知识图谱原生检索 |
| 协议通信 | 8 | ⭐⭐⭐⭐ | WebSocket + 消息队列（进程内 Pub/Sub） |
| Skill 元操作 | 12 | ⭐⭐⭐⭐⭐ | 组合、生成、优化、测试、谱系追踪 |
| 规划/API 生成 | 6 | ⭐⭐⭐⭐ | 多步规划 + OpenAPI 导入自动生成 Skill |
| 其他 | 7 | ⭐⭐⭐⭐ | Shell、用户确认、PPT 主题、文档解析 |

**总体评价**：基础技术能力扎实，数据库、文件系统、知识管理、Skill 进化等核心能力已较为完善。但**企业级业务系统集成能力存在显著缺口**。

### 1.2 关键缺口概述

基于"企业级应用入口"的愿景，现有 Skill 在以下领域存在关键缺口：

1. **身份认证与权限**：无 LDAP/AD、SAML SSO、OAuth2 客户端等企业认证能力
2. **消息通知**：无邮件收发、IM 机器人（钉钉/企微/飞书）等企业通信能力
3. **日历与会议**：无日历查询/创建、会议室预约能力
4. **审批与任务**：无 OA 审批流、任务/待办管理能力
5. **ERP 集成**：无 SAP RFC、国产 ERP（用友/金蝶）连接器
6. **数据集成**：无 Kafka、MQTT、SFTP、通用 JDBC/ODBC 等 ETL 能力
7. **监控运维**：无日志/指标/告警查询能力
8. **RPA 自动化**：无 UI 自动化、OCR 能力（用于无 API 的老系统）

### 1.3 建议实施路线

| 阶段 | 时间 | 重点 | 目标 |
|------|------|------|------|
| Phase 1 | 1-2 个月 | 基础设施层 | 邮件、IM、LDAP、日历 |
| Phase 2 | 2-3 个月 | 业务系统对接层 | 审批、任务、ERP、Kafka |
| Phase 3 | 3-4 个月 | 高级集成层 | SAML、财务、监控、RPA |

---

## 2. 现有 Skill 全景盘点

### 2.1 数据库相关（18 个）

| Skill 名称 | 功能 | 状态 |
|-----------|------|------|
| `db_query` | SQLite 只读查询 | ✅ 核心 |
| `db_execute` | SQLite 写操作 | ✅ 核心 |
| `db_batch` | SQLite 事务批量执行 | ✅ 核心 |
| `db_schema` | 查看数据库表结构 | ✅ 核心 |
| `db_connections` | 连接池管理 | ✅ 核心 |
| `mysql_query` | MySQL 查询 | ✅ 可选依赖 |
| `mysql_execute` | MySQL 写操作 | ✅ 可选依赖 |
| `mysql_test_connection` | MySQL 连接测试 | ✅ 可选依赖 |
| `pg_query` | PostgreSQL 查询 | ✅ 可选依赖 |
| `pg_execute` | PostgreSQL 写操作 | ✅ 可选依赖 |
| `redis_get` | Redis 读取 | ✅ 可选依赖 |
| `redis_set` | Redis 写入 | ✅ 可选依赖 |
| `redis_del` | Redis 删除 | ✅ 可选依赖 |
| `redis_keys` | Redis 键搜索 | ✅ 可选依赖 |
| `mssql_query` | MSSQL 查询 | ✅ 可选依赖 |
| `mssql_execute` | MSSQL 写操作 | ✅ 可选依赖 |
| `oracle_query` | Oracle 查询 | ✅ 可选依赖 |
| `oracle_execute` | Oracle 写操作 | ✅ 可选依赖 |

**评价**：数据库覆盖度优秀，已覆盖企业常用的 6 种数据库。可选依赖的动态加载模式设计良好，未安装对应 npm 包时自动跳过注册，不影响系统启动。

### 2.2 网络 / HTTP 相关（7 个）

| Skill 名称 | 功能 | 状态 |
|-----------|------|------|
| `web_fetch` | 网页抓取并提取纯文本 | ✅ 核心 |
| `web_search` | 搜索引擎检索（百度） | ✅ 核心 |
| `web_extract_links` | 提取网页链接 | ✅ 核心 |
| `web_screenshot` | 网页文本快照 | ✅ 核心 |
| `web_browse` | 真实浏览器渲染（Puppeteer） | ⚠️ 可选依赖 |
| `http_call` | 通用 HTTP 请求 | ✅ 核心 |
| `http_get` | GET 请求（简化版） | ✅ 核心 |

**评价**：基础 HTTP 能力完善。但 `http_call` **禁止访问内网地址**（localhost/127.0.0.1/私有网段），这在私有化部署场景下会成为严重限制——企业内网 API 无法直接调用。需要引入白名单机制。

### 2.3 文件系统相关（12 个）

| Skill 名称 | 功能 | 状态 |
|-----------|------|------|
| `file_read` | 读取文件（敏感内容扫描） | ✅ 核心 |
| `file_write` | 写入文件（强制 .md 转换） | ✅ 核心 |
| `file_append` | 追加内容 | ✅ 核心 |
| `file_delete` | 删除文件 | ✅ 核心 |
| `file_list` | 列出目录 | ✅ 核心 |
| `file_provide` | 提供文件下载（渲染卡片） | ✅ 核心 |
| `file_provide_multi` | 多文件打包下载 | ✅ 核心 |
| `file_upload` | 上传文件（重复检测） | ✅ 核心 |
| `file_upload_list` | 列出已上传文件 | ✅ 核心 |
| `file_upload_delete` | 删除上传记录 | ✅ 核心 |
| `file_search` | 搜索用户上传文件 | ✅ 核心 |
| `doc_read` | 通用文档读取（PDF/Excel/Word/CSV） | ⚠️ 部分可选依赖 |

**评价**：文件系统能力完善，安全设计到位（路径边界检查、敏感文件禁止读取、二进制文档强制转 .md）。

### 2.4 图表 / 可视化（3 个）

| Skill 名称 | 功能 | 状态 |
|-----------|------|------|
| `chart_recommend` | 智能推荐图表类型 | ✅ 核心 |
| `chart_generate` | 生成 ECharts 配置 | ✅ 核心 |
| `chart_multi` | 生成多图表仪表板 | ✅ 核心 |

**评价**：图表能力覆盖数据可视化基本需求。但缺少与企业 BI 系统（如帆软、Tableau）的对接能力。

### 2.5 知识库 / 知识图谱（15 个）

| Skill 名称 | 功能 | 状态 |
|-----------|------|------|
| `kb_ingest` | 导入文档到知识库（自动分块+向量化） | ✅ 核心 |
| `kb_search` | 混合检索知识库（语义+关键词+图谱） | ✅ 核心 |
| `kb_list` | 列出知识库文档 | ✅ 核心 |
| `kb_tags` | 获取标签统计 | ✅ 核心 |
| `kb_formats` | 获取格式统计 | ✅ 核心 |
| `kb_delete` | 删除文档 | ✅ 核心 |
| `kb_share` | 设置文档共享规则 | ✅ 核心 |
| `kb_shared` | 列出共享文档 | ✅ 核心 |
| `kb_vectorize` | 文档向量化 | ✅ 核心 |
| `kb_stats` | 知识库统计 | ✅ 核心 |
| `kb_rebuild` | 重建向量索引 | ✅ 核心 |
| `graph_query` | 查询知识图谱 | ✅ 核心 |
| `graph_path` | 查找最短路径 | ✅ 核心 |
| `graph_communities` | 查看社区结构 | ✅ 核心 |
| `graph_deduplicate` | 节点去重 | ✅ 核心 |

**评价**：知识管理能力是 RAOS 的核心竞争力之一，知识图谱原生检索能力在国内同类产品中具有差异化优势。

### 2.6 协议 / 实时通信（8 个）

| Skill 名称 | 功能 | 状态 |
|-----------|------|------|
| `ws_connect` | WebSocket 连接 | ✅ 核心 |
| `ws_send` | WebSocket 发送 | ✅ 核心 |
| `ws_receive` | WebSocket 接收 | ✅ 核心 |
| `ws_close` | 关闭 WebSocket | ✅ 核心 |
| `ws_list` | 列出所有连接 | ✅ 核心 |
| `mq_publish` | 发布消息到频道 | ✅ 核心 |
| `mq_consume` | 消费频道消息 | ✅ 核心 |
| `mq_channels` | 列出所有频道 | ✅ 核心 |

**评价**：WebSocket 和进程内消息队列能力完善。但缺少与外部消息中间件（Kafka、RabbitMQ、RocketMQ）的集成。

### 2.7 Skill 元操作 / 进化（12 个）

| Skill 名称 | 功能 | 状态 |
|-----------|------|------|
| `skill_compose` | 组合多个 Skill（首选创建方式） | ✅ 核心 |
| `skill_from_template` | 基于模板创建 Skill | ✅ 核心 |
| `skill_from_description` | LLM 生成代码 Skill（最后手段） | ✅ 核心 |
| `skill_unregister` | 注销动态 Skill | ✅ 核心 |
| `skill_info` | 查看 Skill 详情 | ✅ 核心 |
| `skill_optimizer` | 分析并优化 Skill | ✅ 核心 |
| `skill_test` | 自动测试 Skill | ✅ 核心 |
| `skill_list_all` | 列出所有 Skill | ✅ 核心 |
| `evolution_genealogy` | 查询 Skill 谱系 | ✅ 核心 |
| `evolution_emergence_report` | 涌现检测报告 | ✅ 核心 |
| `evolution_red_lines` | 管理红线约束 | ✅ 核心 |
| `evolution_check` | 预检能否生成 | ✅ 核心 |

**评价**：Skill 进化体系设计完善，组合 Skill（skill_compose）是企业级场景的核心编排工具。

### 2.8 规划与 API 生成（6 个）

| Skill 名称 | 功能 | 状态 |
|-----------|------|------|
| `plan_and_execute` | 多步规划执行 | ✅ 核心 |
| `api_import` | 导入 OpenAPI 生成 Skills | ✅ 核心 |
| `api_auth_config` | 配置 API 认证（9种方式） | ✅ 核心 |
| `api_list` | 列出已导入 API | ✅ 核心 |
| `api_delete` | 删除 API 服务 | ✅ 核心 |
| `api_test` | 测试 API Skill | ✅ 核心 |

**评价**：API 导入能力是快速对接业务系统的关键工具，通过 OpenAPI/Swagger 文档可自动生成 Skill。9 种认证方式覆盖大部分场景。

### 2.9 其他（7 个）

| Skill 名称 | 功能 | 状态 |
|-----------|------|------|
| `shell_exec` | 安全沙箱执行 Shell | ✅ 核心 |
| `user_confirm` | 用户前端交互确认 | ✅ 核心 |
| `pptx_learn_style` | 从 PPTX 学习风格 | ✅ 核心 |
| `pptx_list_themes` | 列出 PPTX 主题 | ✅ 核心 |
| `pptx_delete_theme` | 删除自定义主题 | ✅ 核心 |
| `doc_read_csv` | 解析 CSV | ✅ 核心 |
| `doc_read` | 通用文档读取 | ⚠️ 部分可选依赖 |

---

## 3. 企业级场景缺口分析

### 3.1 身份认证与权限（🔴 高优先级）

企业私有化部署场景下，用户管理和认证必须与现有 IT 基础设施集成。

| 缺失 Skill | 场景 | 业务价值 | 实现复杂度 |
|-----------|------|---------|-----------|
| `ldap_search` | 查询 AD/LDAP 用户和组织架构 | 用户目录集成、组织架构展示 | 中 |
| `ldap_auth` | LDAP 用户认证登录 | 替代本地账号，统一认证 | 中 |
| `saml_auth` | SAML 2.0 SSO 对接 | 与企业 IdP（如 ADFS）单点登录 | 高 |
| `oauth2_client` | OAuth2 客户端（授权码模式） | 获取第三方系统 access_token | 中 |
| `role_sync` | 从企业系统同步 RBAC 角色 | 权限统一管理 | 中 |
| `user_profile_sync` | 用户资料同步（部门/职位/汇报线） | HR 系统联动 | 中 |

**典型场景**：
> 新员工入职时，HR 在 AD 中创建账号 → RAOS 自动同步用户信息和组织架构 → AI 助手根据汇报线推荐相关审批权限。

### 3.2 OA/审批/协同办公（🔴 高优先级）

这是"企业级应用入口"愿景中最直接的用户触点。

| 缺失 Skill | 场景 | 业务价值 | 实现复杂度 |
|-----------|------|---------|-----------|
| `email_send` | 发送邮件通知（SMTP） | 审批通知、日报推送、告警通知 | 低 |
| `email_read` | 读取邮件内容（IMAP） | 邮件摘要、自动分类、待办提取 | 中 |
| `calendar_query` | 查询日历（Exchange/CalDAV） | 查看日程、查找空闲时间 | 中 |
| `calendar_create` | 创建会议/日程 | 自动预约会议、发送邀请 | 中 |
| `im_bot_send` | IM 机器人消息（钉钉/企微/飞书） | 实时通知、@用户提醒 | 低 |
| `im_bot_receive` | 接收 IM 消息指令 | 在 IM 中直接 @AI 助手操作 | 高 |
| `approval_submit` | 提交审批申请 | 报销、请假、采购等流程发起 | 中 |
| `approval_query` | 查询审批状态和列表 | "我有哪些待审批的？" | 中 |
| `approval_approve` | 审批通过/驳回 | 在 RAOS 中完成审批操作 | 中 |
| `task_create` | 创建任务/待办 | 对接项目管理系统 | 低 |
| `task_query` | 查询任务列表 | 个人/团队任务看板 | 低 |
| `task_update` | 更新任务状态 | 标记完成、调整优先级 | 低 |

**典型场景**：
> "帮我提交一个报销申请" → `approval_submit`(填写报销单) → `user_confirm`(确认金额和发票) → `email_send`(通知审批人) → `im_bot_send`(钉钉提醒直属领导)

### 3.3 ERP/财务/供应链（🔴 高优先级）

ERP 是企业的核心数据枢纽，AI 助手需要能够读取和写入 ERP 数据。

| 缺失 Skill | 场景 | 业务价值 | 实现复杂度 |
|-----------|------|---------|-----------|
| `sap_query` | SAP RFC/BAPI 读取 | 物料主数据、订单、客户信息 | 高 |
| `sap_execute` | SAP RFC/BAPI 写入 | 创建销售订单、过账、库存调整 | 高 |
| `erp_connector` | 国产 ERP 通用连接器（用友/金蝶/鼎捷） | 读取财务/供应链数据 | 高 |
| `financial_report` | 财务报表自动生成 | 资产负债表、利润表、现金流量表 | 中 |
| `invoice_query` | 发票查询（金税/电子发票平台） | 查验发票真伪、获取发票明细 | 中 |
| `inventory_query` | 实时库存查询 | 多仓库库存、安全库存预警 | 中 |
| `po_query` | 采购订单查询 | 供应商、交货状态、收货情况 | 中 |
| `so_query` | 销售订单查询 | 客户订单、发货状态、回款情况 | 中 |
| `vendor_query` | 供应商信息查询 | 供应商评级、合同、付款记录 | 低 |

**典型场景**：
> "查一下客户 ABC 公司最近的订单状态" → `sap_query`(销售订单) → `kb_search`(相关合同文档) → `chart_generate`(订单趋势图) → `email_send`(发送报告给销售经理)

### 3.4 数据集成与 ETL（🟡 中优先级）

企业系统之间的数据流转需要可靠的集成能力。

| 缺失 Skill | 场景 | 业务价值 | 实现复杂度 |
|-----------|------|---------|-----------|
| `kafka_consume` | Kafka 消息消费 | 实时数据流处理、事件驱动 | 中 |
| `kafka_produce` | Kafka 消息生产 | 事件发布、数据同步 | 中 |
| `mqtt_publish` | MQTT 消息发布 | IoT 设备数据上报 | 低 |
| `mqtt_subscribe` | MQTT 消息订阅 | 接收传感器/设备数据 | 低 |
| `ftp_download` | FTP 文件下载 | 与外部系统文件交换 | 低 |
| `sftp_upload` | SFTP 文件上传 | 安全文件传输 | 低 |
| `jdbc_query` | 通用 JDBC 查询 | 连接任意 JDBC 数据库（如达梦、人大金仓） | 低 |
| `odbc_query` | ODBC 查询 | 连接传统系统（Access、Excel、老式数据库） | 中 |
| `soap_call` | SOAP WebService 调用 | 对接传统 SOA 架构系统 | 中 |

### 3.5 监控与运维（🟡 中优先级）

AI 助手应能主动发现并汇报系统问题。

| 缺失 Skill | 场景 | 业务价值 | 实现复杂度 |
|-----------|------|---------|-----------|
| `log_query` | 日志查询（ELK/Loki） | 故障排查、异常分析 | 中 |
| `metric_query` | 指标查询（Prometheus） | 系统性能、业务指标 | 中 |
| `alert_query` | 告警查询 | 查看当前告警、历史告警 | 低 |
| `health_check` | 健康检查 | 检查业务系统可用性 | 低 |
| `trace_query` | 分布式链路追踪（Jaeger/SkyWalking） | 请求链路分析 | 高 |

### 3.6 RPA / UI 自动化（🟢 低优先级）

用于无 API 的老系统，是最后的兜底方案。

| 缺失 Skill | 场景 | 业务价值 | 实现复杂度 |
|-----------|------|---------|-----------|
| `rpa_screenshot` | 屏幕截图 | 获取页面状态 | 低 |
| `rpa_ocr` | OCR 文字识别 | 读取截图/扫描件中的文字 | 中 |
| `rpa_click` | 模拟鼠标点击 | 无 API 系统的自动化操作 | 高 |
| `rpa_type` | 模拟键盘输入 | 表单自动填写 | 高 |
| `rpa_scroll` | 模拟滚动 | 长页面内容获取 | 高 |

### 3.7 安全与合规（🟡 中优先级）

| 缺失 Skill | 场景 | 业务价值 | 实现复杂度 |
|-----------|------|---------|-----------|
| `audit_log_query` | 审计日志查询 | 合规审计、操作追溯 | 低 |
| `data_mask` | 数据脱敏 | 敏感信息保护 | 低 |
| `secret_read` | 读取加密凭证（Vault集成） | 安全凭证管理 | 中 |

---

## 4. 技术实现方案

### 4.1 实现原则

1. **可选依赖模式**：参考现有 `db-skills.ts` 的设计，所有外部系统 Skill 使用动态 `import()` 加载依赖，未安装时不注册 Skill，不影响系统启动。
2. **Connection 配置复用**：所有需要连接配置的 Skill 复用统一的 connection 参数模式，在系统设置页面维护。
3. **安全优先**：内网访问白名单、凭证加密存储、操作审计日志。
4. **渐进增强**：先实现只读查询类 Skill，再扩展写操作；先支持标准协议，再适配专有协议。

### 4.2 高优先级 Skill 实现方案

#### `email_send` / `email_read`

```typescript
// 依赖: nodemailer (SMTP), imap (IMAP)
// Connection 配置:
interface EmailConnection {
  host: string;      // SMTP/IMAP 服务器
  port: number;
  secure: boolean;   // true for 465, false for 587/25
  user: string;
  password: string;  // 加密存储
}

// email_send 参数:
interface EmailSendParams {
  connection: string;     // connection 配置名称
  to: string | string[];
  cc?: string | string[];
  subject: string;
  body: string;
  html?: boolean;
  attachments?: Array<{ filename: string; content?: string; path?: string }>;
}

// email_read 参数:
interface EmailReadParams {
  connection: string;
  folder?: string;        // 默认 INBOX
  limit?: number;         // 默认 20
  since?: string;         // ISO 日期
  search?: string;        // 主题/发件人搜索
}
```

**推荐库**：`nodemailer`（SMTP 发送）、`imap`（IMAP 读取）
**预估工作量**：2-3 天

---

#### `im_bot_send`（钉钉 / 企微 / 飞书）

```typescript
// 依赖: 无（纯 HTTP 调用）
// Connection 配置:
interface IMBotConnection {
  platform: "dingtalk" | "wecom" | "lark";
  webhook: string;        // 机器人 Webhook URL
  secret?: string;        // 签名密钥（钉钉/企微）
}

// im_bot_send 参数:
interface IMBotSendParams {
  connection: string;
  content: string;        // 消息内容（支持 markdown）
  at?: string | string[]; // @用户（手机号/用户ID）
  msgType?: "text" | "markdown";
}
```

**实现方式**：直接调用各平台的机器人 Webhook API，无需额外 npm 包。
**预估工作量**：1-2 天

---

#### `ldap_search` / `ldap_auth`

```typescript
// 依赖: ldapjs
// Connection 配置:
interface LDAPConnection {
  url: string;            // ldap://dc.company.com:389
  bindDN: string;         // 管理员 DN
  bindCredentials: string;
  searchBase: string;     // DC=company,DC=com
  tlsOptions?: object;    // StartTLS / LDAPS
}

// ldap_search 参数:
interface LDAPSearchParams {
  connection: string;
  filter?: string;        // (cn=*) 或 (mail=user@company.com)
  scope?: "base" | "one" | "sub";
  attributes?: string[];  // ["cn", "mail", "department"]
}

// ldap_auth 参数:
interface LDAPAuthParams {
  connection: string;
  username: string;       // 如 user@company.com 或 cn=User
  password: string;
}
```

**推荐库**：`ldapjs`
**预估工作量**：3-4 天

---

#### `calendar_query` / `calendar_create`

```typescript
// 依赖: ical-generator, node-ical（或 Exchange Web Services 的 ews-javascript-api）
// Connection 配置:
interface CalendarConnection {
  type: "exchange" | "google" | "caldav";
  server?: string;        // Exchange EWS URL 或 CalDAV 服务器
  user: string;
  password: string;
}

// calendar_query 参数:
interface CalendarQueryParams {
  connection: string;
  startDate: string;      // ISO 日期
  endDate: string;
  limit?: number;
}

// calendar_create 参数:
interface CalendarCreateParams {
  connection: string;
  title: string;
  startTime: string;
  endTime: string;
  attendees?: string[];   // 邮箱列表
  location?: string;
  description?: string;
}
```

**推荐库**：`ews-javascript-api`（Exchange）、`dav`（CalDAV）、`googleapis`（Google Calendar）
**预估工作量**：5-7 天

---

#### `approval_submit` / `approval_query`

```typescript
// 依赖: 无（纯 HTTP API 调用，具体取决于对接的 OA 系统）
// 设计思路：由于企业 OA 系统种类繁多（泛微、致远、蓝凌、钉钉审批、企微审批等），
// 建议通过 api_import 导入 OA 系统的 OpenAPI，或提供通用适配层

// 通用审批 Skill 参数:
interface ApprovalSubmitParams {
  system: string;         // OA 系统标识（如 "weaver-泛微"）
  templateId: string;     // 审批模板 ID
  formData: Record<string, unknown>;
  approvers?: string[];   // 指定审批人
}

interface ApprovalQueryParams {
  system: string;
  status?: "pending" | "approved" | "rejected" | "all";
  limit?: number;
  startDate?: string;
  endDate?: string;
}
```

**实现建议**：
1. 优先支持钉钉/企微/飞书的审批 API（标准化程度高）
2. 对国产 OA（泛微、致远、蓝凌）提供通用 HTTP 封装，用户通过 `api_import` 导入各自 OA 的 API 文档
3. 提供审批模板配置功能，在系统设置中维护各审批类型的表单字段映射

**预估工作量**：7-10 天

---

#### `sap_query` / `sap_execute`

```typescript
// 依赖: @sap/hana-client 或 node-rfc（通过 NWRFC SDK 调用 RFC）
// Connection 配置:
interface SAPConnection {
  ashost: string;         // 应用服务器
  sysnr: string;          // 系统编号
  client: string;         // 客户端
  user: string;
  passwd: string;
  lang?: string;
}

// sap_query 参数:
interface SAPQueryParams {
  connection: string;
  rfcName: string;        // RFC 函数名，如 "BAPI_CUSTOMER_GETLIST"
  params?: Record<string, unknown>;
}
```

**推荐方案**：
1. **方案 A（推荐）**：使用 `node-rfc` + SAP NW RFC SDK。功能最完整，支持所有 RFC/BAPI，但需要安装 SAP 的 C 库。
2. **方案 B**：通过 SAP Gateway OData 服务调用。无需额外 C 库，纯 HTTP，但需 SAP 侧配置 OData 服务。
3. **方案 C**：使用 `@sap/hana-client` 直接查询 HANA 数据库。适用于纯数据读取场景。

**建议**：同时支持方案 B（OData，零依赖）和方案 A（RFC，可选依赖）。
**预估工作量**：7-14 天

---

#### `erp_connector`（国产 ERP）

国产 ERP（用友 NC/U8、金蝶 EAS/K3、鼎捷）通常提供以下对接方式：
1. **OpenAPI/REST API**：新一代产品（用友 YonSuite、金蝶云星空）已提供标准化 API
2. **WebService**：传统产品（U8、K3）通常提供 SOAP WebService
3. **数据库直连**：直接查询 ERP 数据库（风险高，不推荐）

**实现建议**：
- 对支持 OpenAPI 的 ERP：引导用户通过 `api_import` 导入 API 文档
- 对仅支持 WebService 的 ERP：新增 `soap_call` Skill，用户配置 WSDL 后自动生成调用
- 提供常见 ERP 的预设模板（用友 U8 常用接口、金蝶 K3 常用接口）

**预估工作量**：10-15 天

---

### 4.3 中优先级 Skill 实现方案

#### `kafka_consume` / `kafka_produce`

```typescript
// 依赖: kafkajs
// Connection 配置:
interface KafkaConnection {
  brokers: string[];      // ["kafka1:9092", "kafka2:9092"]
  clientId?: string;
  sasl?: { mechanism: "plain" | "scram-sha-256"; username: string; password: string };
  ssl?: boolean;
}

// kafka_consume 参数:
interface KafkaConsumeParams {
  connection: string;
  topic: string;
  groupId?: string;
  limit?: number;         // 消费多少条后停止
  timeout?: number;       // 最长等待时间（毫秒）
}
```

**推荐库**：`kafkajs`（纯 JS，无需原生依赖）
**预估工作量**：3-5 天

---

#### `jdbc_query`

```typescript
// 依赖: jdbc（node-java + JDBC driver）或直接使用各数据库的 Node.js 驱动
// 建议：不引入 node-java（依赖 JDK），而是为国产数据库单独提供 Skill
// 达梦数据库：dm.jdbc.driver.DmDriver → 可用 jdbc 协议，但 Node.js 无官方驱动
// 替代方案：通过已有的 db_query 扩展支持达梦（如果达梦支持 ODBC）

// 更实际的方案：odbc_query
interface ODBCQueryParams {
  connectionString: string;
  sql: string;
  params?: unknown[];
}
```

**推荐库**：`odbc`（基于 node-odbc，需要 unixODBC/Windows ODBC 驱动）
**预估工作量**：3-5 天

---

#### `ftp_download` / `sftp_upload`

```typescript
// 依赖: basic-ftp (FTP), ssh2-sftp-client (SFTP)
// Connection 配置:
interface FTPConnection {
  host: string;
  port?: number;
  user: string;
  password: string;
  secure?: boolean;       // SFTP / FTPS
}

// ftp_download 参数:
interface FTPDownloadParams {
  connection: string;
  remotePath: string;
  localPath?: string;     // 保存到 workspace 的相对路径
}
```

**推荐库**：`basic-ftp`、`ssh2-sftp-client`
**预估工作量**：2-3 天

---

## 5. 实施路线图

### Phase 1：基础设施层（1-2 个月）

**目标**：建立与企业 IT 基础设施的基础连接能力，实现消息通知和用户目录集成。

| 序号 | Skill | 优先级 | 预估工作量 | 依赖 |
|------|-------|--------|-----------|------|
| 1 | `email_send` | P0 | 2-3 天 | nodemailer |
| 2 | `email_read` | P0 | 2-3 天 | imap |
| 3 | `im_bot_send` | P0 | 1-2 天 | 无 |
| 4 | `ldap_search` | P0 | 3-4 天 | ldapjs |
| 5 | `ldap_auth` | P0 | 2-3 天 | ldapjs |
| 6 | `calendar_query` | P1 | 3-4 天 | ews-javascript-api / dav |
| 7 | `calendar_create` | P1 | 2-3 天 | ews-javascript-api / dav |
| 8 | `http_call` 内网白名单 | P0 | 1-2 天 | 无 |

**Phase 1 里程碑**：
- 用户可通过 RAOS 发送邮件和 IM 消息
- 支持 LDAP/AD 用户目录查询和认证
- 支持查询和创建日历事件
- 内网 API 可通过白名单访问

---

### Phase 2：业务系统对接层（2-3 个月）

**目标**：对接核心业务系统（OA、ERP、项目管理），实现跨系统数据流转。

| 序号 | Skill | 优先级 | 预估工作量 | 依赖 |
|------|-------|--------|-----------|------|
| 9 | `approval_query` | P0 | 3-4 天 | HTTP API |
| 10 | `approval_submit` | P0 | 4-5 天 | HTTP API |
| 11 | `approval_approve` | P0 | 3-4 天 | HTTP API |
| 12 | `task_create` | P1 | 2-3 天 | HTTP API |
| 13 | `task_query` | P1 | 2-3 天 | HTTP API |
| 14 | `sap_query` (OData) | P0 | 5-7 天 | HTTP API |
| 15 | `sap_execute` (OData) | P1 | 3-4 天 | HTTP API |
| 16 | `sap_query` (RFC) | P1 | 5-7 天 | node-rfc + NWRFC SDK |
| 17 | `erp_connector` | P1 | 10-15 天 | HTTP API / SOAP |
| 18 | `kafka_consume` | P1 | 3-4 天 | kafkajs |
| 19 | `kafka_produce` | P1 | 2-3 天 | kafkajs |
| 20 | `so_query` | P1 | 2-3 天 | HTTP API / DB |
| 21 | `inventory_query` | P1 | 2-3 天 | HTTP API / DB |
| 22 | `po_query` | P1 | 2-3 天 | HTTP API / DB |

**Phase 2 里程碑**：
- 用户可在 RAOS 中查询和提交审批
- 支持 SAP OData 查询（无需额外 C 库）
- 支持 Kafka 消息消费和生产
- 支持国产 ERP 的通用对接（通过 SOAP/OpenAPI）

---

### Phase 3：高级集成层（3-4 个月）

**目标**：完善安全认证、财务、监控和自动化能力。

| 序号 | Skill | 优先级 | 预估工作量 | 依赖 |
|------|-------|--------|-----------|------|
| 23 | `saml_auth` | P1 | 5-7 天 | samlify / passport-saml |
| 24 | `oauth2_client` | P1 | 3-4 天 | simple-oauth2 |
| 25 | `role_sync` | P1 | 3-4 天 | ldapjs / HTTP API |
| 26 | `financial_report` | P1 | 5-7 天 | 模板引擎 + 数据源 |
| 27 | `invoice_query` | P1 | 3-4 天 | HTTP API（税务平台） |
| 28 | `log_query` | P2 | 3-4 天 | @elastic/elasticsearch |
| 29 | `metric_query` | P2 | 3-4 天 | prom-client |
| 30 | `alert_query` | P2 | 2-3 天 | HTTP API |
| 31 | `health_check` | P2 | 1-2 天 | 无 |
| 32 | `ftp_download` | P2 | 1-2 天 | basic-ftp |
| 33 | `sftp_upload` | P2 | 1-2 天 | ssh2-sftp-client |
| 34 | `jdbc_query` / `odbc_query` | P2 | 3-5 天 | odbc |
| 35 | `soap_call` | P1 | 3-4 天 | soap |
| 36 | `mqtt_publish` | P2 | 1-2 天 | mqtt |
| 37 | `mqtt_subscribe` | P2 | 1-2 天 | mqtt |
| 38 | `rpa_screenshot` | P2 | 1-2 天 | puppeteer |
| 39 | `rpa_ocr` | P2 | 2-3 天 | tesseract.js |
| 40 | `audit_log_query` | P2 | 1-2 天 | 无 |

**Phase 3 里程碑**：
- 支持 SAML SSO 和 OAuth2 客户端
- 支持财务报表自动生成
- 支持日志/指标/告警查询
- 支持基础 RPA（截图+OCR）
- 支持 FTP/SFTP 文件传输

---

## 6. 架构建议

### 6.1 Connection 配置中心

所有外部系统 Skill 应复用统一的 Connection 配置机制。建议在系统中新增"连接管理"模块：

```
系统设置 → 连接管理
  ├── SMTP 服务器
  ├── LDAP/AD 服务器
  ├── SAP 连接
  ├── 钉钉/企微/飞书 Webhook
  ├── Kafka 集群
  ├── Exchange/CalDAV 服务器
  └── 自定义 API 认证
```

每个 Connection 配置包含：
- 名称（供 Skill 调用时引用）
- 类型（smtp/ldap/sap/im/kafka/...）
- 连接参数（host/port/user/...）
- 凭证（加密存储，AES-256）
- 状态（连通性测试）

Skill 调用时通过 `connection: "配置名称"` 引用，而非直接传递敏感信息。

### 6.2 安全模型增强

#### 内网访问白名单

`http_call` 当前禁止所有内网地址。应改为：
- 默认禁止内网访问
- 系统管理员可在"连接管理"中添加白名单域名/IP
- 白名单中的地址允许 `http_call` 访问

```typescript
// 白名单配置示例
const allowedIntranetHosts = [
  "erp.company.com",
  "oa.company.com",
  "192.168.1.100",
  "10.0.0.0/8",       // CIDR 支持
];
```

#### 凭证加密存储

所有 Connection 的密码/token 应使用 AES-256 加密存储：
- 加密密钥存储在环境变量中（`CONNECTION_ENCRYPTION_KEY`）
- 数据库中只存储密文
- 解密仅在运行时进行，密钥不落盘

#### 操作审计日志

所有外部系统调用记录审计日志：
- 时间戳、用户 ID、Skill 名称、目标系统、操作类型
- 记录参数（敏感信息脱敏）
- 响应状态（成功/失败）

### 6.3 组合 Skill 设计模式

企业级场景的核心价值在于**编排多个系统**的能力。建议提供以下组合 Skill 模板：

#### 模板 1：审批通知流水线
```
approval_submit → approval_query → email_send → im_bot_send
```

#### 模板 2：订单状态追踪
```
sap_query(销售订单) → so_query → inventory_query → 
kb_search(相关文档) → chart_generate(趋势图) → email_send(报告)
```

#### 模板 3：日报自动生成
```
sap_query(昨日订单) → mysql_query(业务数据) → 
chart_generate(数据看板) → file_provide(生成报告) → 
email_send(发送给管理层)
```

### 6.4 与现有 API 导入体系的协同

`api_import` 是快速对接业务系统的利器。建议：

1. **提供预设模板**：为用友 U8、金蝶 K3、泛微 OA、致远 OA 等常见系统提供 OpenAPI 模板（即使这些系统原生不支持 OpenAPI，也可由社区维护 YAML 描述）
2. **SOAP 转 REST**：新增 `soap_call` Skill，用户配置 WSDL 后自动生成调用封装
3. **认证配置复用**：`api_auth_config` 的 9 种认证方式可与 Connection 配置中心打通

---

## 7. 总结

### 7.1 现状评估

RAOS 的基础技术能力扎实，数据库访问、文件系统、知识管理、Skill 进化等核心能力已较为完善。但**企业级业务系统集成能力存在显著缺口**，特别是：

1. **消息通知**：无邮件、IM 机器人能力
2. **用户目录**：无 LDAP/AD 集成
3. **业务系统**：无 ERP/OA 的直接对接 Skill
4. **数据集成**：无 Kafka、MQTT、SFTP 等企业级中间件

### 7.2 关键建议

1. **优先实施 Phase 1**：邮件、IM、LDAP、日历是企业级入口的基础设施，实现后可立即产生用户价值
2. **善用 `api_import`**：对于标准化程度高的系统（钉钉、企微、飞书、SAP OData），优先通过 API 导入而非手写 Skill
3. ** Connection 配置中心**：提前设计统一的连接管理机制，避免每个 Skill 重复实现配置和凭证管理
4. **渐进增强**：先只读查询，再扩展写操作；先标准协议，再专有协议
5. **安全优先**：内网白名单、凭证加密、审计日志是企业级部署的必选项

### 7.3 预期收益

完成全部 3 个 Phase 后，RAOS 将具备：
- ✅ 统一的企业用户认证（LDAP/SSO）
- ✅ 全渠道消息通知（邮件 + IM）
- ✅ 日历与会议管理
- ✅ 审批流与任务管理
- ✅ ERP 数据查询与报表生成
- ✅ 实时数据集成（Kafka）
- ✅ 系统监控与运维
- ✅ 无 API 系统的 RPA 兜底

这将使 RAOS 真正具备作为"企业级应用入口"的能力，用户无需登录任何业务系统，即可通过自然语言与所有系统交互。
