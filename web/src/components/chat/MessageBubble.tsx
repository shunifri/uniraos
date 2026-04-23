import { useState, useMemo } from "react";
import { Flex, Typography, Button, Collapse, Spin } from "antd";
import { Bubble } from "@ant-design/x";
import { XMarkdown } from "@ant-design/x-markdown";
import ReactECharts from "echarts-for-react";
import {
  UserOutlined,
  BulbOutlined,
  RightOutlined,
  SearchOutlined,
  FileTextOutlined,
  GlobalOutlined,
  BarChartOutlined,
  FileOutlined,
  DatabaseOutlined,
  ToolOutlined,
  LoadingOutlined,
} from "@ant-design/icons";
import type { ChatMsg, KbReference } from "./types";
import { markdownComponents } from "./MarkdownConfig";
import { useI18nStore } from "@/i18n";
import { apiFetch } from "@/api";
import ConfirmCard from "@/components/ConfirmCard";

const { Text } = Typography;

interface MessageBubbleProps {
  msg: ChatMsg;
  confirmedCards: Set<string>;
  mdPreviews: Record<string, string>;
  onViewKbDoc: (docId: string, docName: string) => void;
  onConfirmCard: (cardId: string, confirmed: boolean) => void;
}

export default function MessageBubble({ msg, confirmedCards, mdPreviews, onViewKbDoc, onConfirmCard }: MessageBubbleProps) {
  const t = useI18nStore((s) => s.t);

  // 渲染用户确认卡片
  if (msg.role === "user_confirm") {
    const data = useMemo(() => {
      try {
        return JSON.parse(msg.content);
      } catch {
        return null;
      }
    }, [msg.content]);

    if (!data) {
      return (
        <div style={{ marginLeft: 46 }}>
          <Text type="danger" style={{ fontSize: 12 }}>确认卡片数据解析失败</Text>
        </div>
      );
    }

    const isDisabled = confirmedCards.has(data.confirmId);
    return (
      <div style={{ marginLeft: 46 }}>
        <ConfirmCard
          confirmId={data.confirmId}
          type={data.type}
          title={data.title}
          description={data.description}
          options={data.options}
          multiSelect={data.multiSelect}
          fields={data.fields}
          schema={data.schema}
          confirmText={data.confirmText}
          cancelText={data.cancelText}
          disabled={isDisabled}
          onConfirm={async (confirmId, response) => {
            try {
              await apiFetch("/api/agent/chat/confirm", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ confirmId, response }),
              });
              onConfirmCard(confirmId, true);
            } catch (err) {
              console.error("Confirm failed:", err);
            }
          }}
          onCancel={async (confirmId) => {
            try {
              await apiFetch("/api/agent/chat/confirm", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ confirmId, cancelled: true }),
              });
              onConfirmCard(confirmId, false);
            } catch (err) {
              console.error("Cancel failed:", err);
            }
          }}
        />
      </div>
    );
  }

  // 渲染用户消息
  if (msg.role === "user") {
    return (
      <Bubble
        placement="end"
        className="user-bubble"
        content={msg.content}
        avatar={<div style={{ width: 34, height: 34, borderRadius: 12, background: 'linear-gradient(135deg, #667eea, #764ba2)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontSize: 14, boxShadow: '0 2px 8px rgba(102, 126, 234, 0.3)' }}><UserOutlined /></div>}
      />
    );
  }

  // 渲染思考指示器
  if (msg.role === "thinking") {
    if (msg.content === "__typing__") {
      return (
        <div style={{ display: "flex", gap: 12, alignItems: "center", marginLeft: 4, animation: "fade-in-up 0.3s ease-out" }}>
          <img src="/ai-avatar.png" alt="AI" style={{ width: 32, height: 32, borderRadius: 10 }} onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }} />
          <div style={{ display: "flex", gap: 4, padding: "10px 16px", borderRadius: 16, background: "rgba(139, 92, 246, 0.06)" }}>
            <span style={{ width: 6, height: 6, borderRadius: "50%", background: "#8B5CF6", opacity: 0.6, animation: "pulse-border 1.2s infinite" }} />
            <span style={{ width: 6, height: 6, borderRadius: "50%", background: "#A78BFA", opacity: 0.6, animation: "pulse-border 1.2s infinite 0.2s" }} />
            <span style={{ width: 6, height: 6, borderRadius: "50%", background: "#C4B5FD", opacity: 0.6, animation: "pulse-border 1.2s infinite 0.4s" }} />
          </div>
        </div>
      );
    }
    // 思考内容 — 内联小标签，点击可展开
    return (
      <div style={{ marginLeft: 46, padding: "2px 0" }}>
        <Collapse ghost size="small" defaultActiveKey={[]} style={{ width: "fit-content" }} items={[{
          key: "think",
          label: (
            <span className="strategy-badge" style={{ background: "linear-gradient(135deg, rgba(139, 92, 246, 0.06), rgba(236, 72, 153, 0.04))" }}>
              <BulbOutlined style={{ fontSize: 11 }} />
              深度思考
            </span>
          ),
          children: (
            <Text style={{ fontSize: 12, color: "#64748B", whiteSpace: "pre-wrap", lineHeight: 1.6, display: "block", maxHeight: 200, overflow: "auto", padding: "8px 12px", background: "rgba(139,92,246,0.03)", borderRadius: 10 }}>{msg.content}</Text>
          ),
        }]} />
      </div>
    );
  }

  // 渲染策略提示
  if (msg.role === "strategy") {
    return (
      <Flex justify="center" style={{ padding: "4px 0" }}>
        <span className="strategy-badge">
          <BulbOutlined style={{ fontSize: 12 }} />
          {msg.content}
        </span>
      </Flex>
    );
  }

  // 渲染工具调用
  if (msg.role === "tool") {
    const toolIcon = msg.skillName?.includes("search") ? <SearchOutlined />
      : msg.skillName?.includes("kb_") ? <FileTextOutlined />
      : msg.skillName?.includes("web_") ? <GlobalOutlined />
      : msg.skillName?.includes("chart") ? <BarChartOutlined />
      : msg.skillName?.includes("file") ? <FileOutlined />
      : msg.skillName?.includes("db_") || msg.skillName?.includes("mysql") ? <DatabaseOutlined />
      : <ToolOutlined />;
    const isRunning = msg.status === "running";
    const toolLabel = msg.skillName?.replace(/_/g, " ") ?? "tool";
    const summary = msg.content && msg.content !== "完成" && msg.content !== "失败" ? msg.content : "";

    return (
      <div style={{ marginLeft: 46, animation: 'fade-in-up 0.3s ease-out' }}>
        <Collapse
          ghost
          size="small"
          expandIcon={({ isActive }) => (
            <span style={{ transition: 'transform 0.3s', display: 'inline-block', transform: isActive ? 'rotate(90deg)' : 'rotate(0deg)' }}>
              <RightOutlined style={{ fontSize: 10, color: '#94A3B8' }} />
            </span>
          )}
          items={[{
            key: "tool",
            label: (
              <Flex align="center" gap={10} style={{ padding: '2px 0', overflow: 'hidden', minWidth: 0 }}>
                <span style={{ color: isRunning ? '#667eea' : msg.isError ? '#EF4444' : '#64748B', fontSize: 15, flexShrink: 0 }}>
                  {isRunning ? <Spin indicator={<LoadingOutlined spin />} size="small" /> : toolIcon}
                </span>
                <Text style={{ fontSize: 14, color: '#334155', fontWeight: 500, flexShrink: 0 }}>{toolLabel}</Text>
                {summary && (
                  <Text style={{ fontSize: 13, color: '#94A3B8', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: 0, flex: 1 }}>
                    {summary.length > 60 ? summary.slice(0, 60) + "..." : summary}
                  </Text>
                )}
              </Flex>
            ),
            children: msg.resultData ? (
              <pre style={{ fontSize: 12, maxHeight: 240, overflow: 'auto', background: '#F8FAFC', padding: 12, borderRadius: 10, whiteSpace: 'pre-wrap', wordBreak: 'break-all', color: '#475569', border: '1px solid #E2E8F0', margin: '4px 0' }}>
                {JSON.stringify(msg.resultData, null, 2)}
              </pre>
            ) : (
              <Text type="secondary" style={{ fontSize: 12 }}>{msg.content || "无详情"}</Text>
            ),
          }]} />
          {msg.chartOptions && msg.chartOptions.map((option, i) => (
            <div key={i} style={{ height: 400, marginTop: 8 }}>
              <ReactECharts option={option} style={{ height: "100%", width: "100%" }} />
            </div>
          ))}
      </div>
    );
  }

  // 助手消息（包含知识库引用和图表）
  return (
    <Bubble
      key={msg.id}
      avatar={<img src="/ai-avatar.png" alt="AI" style={{ width: 36, height: 36, borderRadius: 14 }} onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }} />}
      styles={{ content: { maxWidth: "100%" } }}
      content={
        <div>
          <XMarkdown
            content={msg.content}
            components={markdownComponents}
          />
          {msg.kbReferences && msg.kbReferences.length > 0 && (
            <div style={{ marginTop: 8 }}>
              {msg.kbReferences.map((ref) => (
                <div
                  key={ref.index}
                  onClick={() => onViewKbDoc(ref.docId, ref.docName)}
                  className="glass-card"
                  style={{
                    padding: "10px 14px",
                    marginBottom: 8,
                    borderRadius: 14,
                    cursor: "pointer",
                    borderLeft: "3px solid #1890ff",
                  }}
                >
                  <div style={{ fontSize: 11, fontWeight: 600, color: "#334155" }}>{ref.docName}</div>
                  <div style={{ fontSize: 10, color: "#64748B", marginTop: 4, lineHeight: 1.5 }}>
                    {ref.content.slice(0, 120)}{ref.content.length > 120 ? "..." : ""}
                  </div>
                </div>
              ))}
            </div>
          )}
          {msg.chartOptions && msg.chartOptions.map((option, i) => (
            <div key={i} style={{ height: 400, marginTop: 8 }}>
              <ReactECharts option={option} style={{ height: "100%", width: "100%" }} />
            </div>
          ))}
        </div>
      }
    />
  );
}
