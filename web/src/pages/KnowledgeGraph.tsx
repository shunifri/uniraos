import { useState, useEffect, useCallback, useRef } from "react";
import {
  Card,
  Row,
  Col,
  Statistic,
  Button,
  Space,
  Input,
  Table,
  Tag,
  App,
  Typography,
  Spin,
  Empty,
  Segmented,
} from "antd";
import {
  NodeIndexOutlined,
  SyncOutlined,
  SearchOutlined,
  ClusterOutlined,
  ReloadOutlined,
  AimOutlined,
  ApartmentOutlined,
  ShareAltOutlined,
} from "@ant-design/icons";
import ReactECharts from "echarts-for-react";
import { api } from "@/api";
import { useI18nStore } from "@/i18n";

const { Title, Text } = Typography;

interface GraphNode {
  id: string;
  label: string;
  type: string;
  communityId?: number;
  degree?: number;
  isGodNode?: boolean;
  weight?: number;
  createdAt?: number;
  tags?: string | string[];
}

interface GraphEdge {
  id: string;
  source: string;
  target: string;
  type: string;
  weight?: number;
  label?: string;
}

interface GraphStats {
  nodeCount: number;
  edgeCount: number;
  communityCount: number;
  godNodeCount: number;
  avgDegree?: number;
  densityScore?: number;
}

interface Community {
  id: number;
  size: number;
  nodes: string[];
}

const COMMUNITY_COLORS = [
  "#5470c6", "#91cc75", "#fac858", "#ee6666", "#73c0de",
  "#3ba272", "#fc8452", "#9a60b4", "#ea7ccc", "#67e0e3",
];

// 中心节点（god nodes）专用色板 — 每个中心节点不同颜色，高区分度
const GOD_NODE_COLORS = [
  "#FF6B6B", "#4ECDC4", "#45B7D1", "#96CEB4", "#F7DC6F",
  "#DDA0DD", "#FF8C42", "#6C5CE7", "#A8E6CF", "#FD79A8",
];

const NODE_TYPE_COLOR: Record<string, string> = {
  ltm: "#5470c6",
  kb_document: "#91cc75",
  entity: "#fac858",
  concept: "#ee6666",
};

export default function KnowledgeGraphPage() {
  const { message } = App.useApp();
  const t = useI18nStore((s) => s.t);

  const [stats, setStats] = useState<GraphStats | null>(null);
  const [graphData, setGraphData] = useState<{ nodes: GraphNode[]; edges: GraphEdge[] }>({ nodes: [], edges: [] });
  const [queryResults, setQueryResults] = useState<{ nodes: GraphNode[]; edges: GraphEdge[] } | null>(null);
  const [loading, setLoading] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [querying, setQuerying] = useState(false);
  const [queryText, setQueryText] = useState("");
  const [layoutMode, setLayoutMode] = useState<"force" | "circular" | "radial">("force");

  const loadStats = useCallback(async () => {
    try {
      const data = await api.get<GraphStats>("/api/graph/stats");
      setStats(data);
    } catch {
      // non-fatal
    }
  }, []);

  const loadGraphData = useCallback(async () => {
    setLoading(true);
    try {
      const data = await api.get<{ nodes: GraphNode[]; edges: GraphEdge[] }>("/api/graph/data");
      // 防御性处理：确保 tags 是数组格式
      const processedData = {
        ...data,
        nodes: data.nodes.map(node => ({
          ...node,
          tags: Array.isArray(node.tags) ? node.tags : 
                typeof node.tags === 'string' ? 
                  (node.tags.startsWith('[') ? JSON.parse(node.tags) : node.tags.split(',')) : 
                []
        }))
      };
      setGraphData(processedData);
    } catch (err) {
      message.error(t("error"));
    } finally {
      setLoading(false);
    }
  }, [message]);

  useEffect(() => {
    loadStats();
    loadGraphData();
  }, [loadStats, loadGraphData]);

  const handleSync = async () => {
    setSyncing(true);
    try {
      const result = await api.post<{ added: number }>("/api/graph/sync");
      message.success(`Synced from LTM: ${result.added} nodes added`);
      await loadStats();
      await loadGraphData();
    } catch (err) {
      message.error(t("error"));
    } finally {
      setSyncing(false);
    }
  };

  const handleRebuildCommunities = async () => {
    try {
      await api.post("/api/graph/communities");
      message.success(t("success"));
      await loadStats();
      await loadGraphData();
    } catch {
      message.error(t("error"));
    }
  };

  const handleQuery = async () => {
    if (!queryText.trim()) return;
    setQuerying(true);
    try {
      const result = await api.post<{ nodes: GraphNode[]; edges: GraphEdge[] }>("/api/graph/query", {
        query: queryText,
        maxDepth: 3,
        maxNodes: 50,
      });
      setQueryResults(result);
    } catch {
      message.error(t("error"));
    } finally {
      setQuerying(false);
    }
  };

  // Build ECharts option from graph data
  const buildChartOption = (nodes: GraphNode[], edges: GraphEdge[], mode: "force" | "circular" | "radial") => {
    if (nodes.length === 0) return null;

    const nodeIdSet = new Set(nodes.map((n) => n.id));

    // 中心节点由后端 /api/graph/data 计算并标记 isGodNode
    const godNodeList = nodes.filter((n) => n.isGodNode).map((n) => n.id);

    // 预计算环形/径向布局的坐标（所有模式都用 layout: 'none' 除力导向外，才能支持拖动）
    const computeCircularPositions = () => {
      const centerX = 400;
      const centerY = 300;
      const radius = Math.min(300, Math.max(120, nodes.length * 7));
      const positions = new Map<string, { x: number; y: number }>();
      nodes.forEach((node, i) => {
        const angle = (i / Math.max(1, nodes.length)) * Math.PI * 2 - Math.PI / 2;
        positions.set(node.id, {
          x: centerX + radius * Math.cos(angle),
          y: centerY + radius * Math.sin(angle),
        });
      });
      return positions;
    };

    const computeRadialPositions = () => {
      const groups = new Map<string | number, GraphNode[]>();
      nodes.forEach((n) => {
        const key = n.communityId !== undefined ? n.communityId : n.type;
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key)!.push(n);
      });
      const groupEntries = [...groups.entries()];
      const maxRadius = 260;
      const positions = new Map<string, { x: number; y: number }>();
      groupEntries.forEach(([_, groupNodes], groupIndex) => {
        const radius = maxRadius * ((groupIndex + 1) / groupEntries.length);
        groupNodes.forEach((node, i) => {
          const angle = (i / Math.max(1, groupNodes.length)) * Math.PI * 2;
          positions.set(node.id, {
            x: 400 + radius * Math.cos(angle),
            y: 300 + radius * Math.sin(angle),
          });
        });
      });
      return positions;
    };

    const presetPositions = mode === "circular"
      ? computeCircularPositions()
      : mode === "radial"
      ? computeRadialPositions()
      : null;

    // 构建中心节点 ID → 索引映射，确保每个中心节点颜色不同
    const godNodeIdSet = new Set(godNodeList);
    const godNodeIndexMap = new Map(godNodeList.map((id, idx) => [id, idx]));

    const echartsNodes = nodes.map((node) => {
      const degree = node.degree ?? 1;
      const isGodNode = node.isGodNode ?? false;
      const godIndex = godNodeIndexMap.get(node.id) ?? 0;

      // 颜色：中心节点用独立色板，其他按社区/类型
      const nodeColor = isGodNode
        ? GOD_NODE_COLORS[godIndex % GOD_NODE_COLORS.length]
        : node.communityId !== undefined
        ? COMMUNITY_COLORS[node.communityId % COMMUNITY_COLORS.length]
        : NODE_TYPE_COLOR[node.type] ?? "#888";

      // 大小：中心节点更大
      const size = isGodNode
        ? Math.max(18, Math.min(55, 18 + degree * 3))
        : Math.max(8, Math.min(35, 8 + degree * 2.5));

      // 友好的显示名称
      const rawName = node.label || node.id;
      const friendlyName = rawName
        .replace(/^(fact:|recall:|recall:graph:)/, "")
        .replace(/_/g, " ");
      const truncatedName = friendlyName.length > 15 ? friendlyName.slice(0, 12) + "..." : friendlyName;

      // 节点实际内容（value）
      const nodeValue = (node as any).properties?.value;
      const valueStr = nodeValue
        ? (typeof nodeValue === "string" ? nodeValue : JSON.stringify(nodeValue))
        : "";
      const valuePreview = valueStr.length > 100 ? valueStr.slice(0, 100) + "..." : valueStr;

      const base: any = {
        id: node.id,
        name: friendlyName,
        symbolSize: size,
        itemStyle: {
          color: nodeColor,
          borderColor: isGodNode ? "#ffffff" : undefined,
          borderWidth: isGodNode ? 3 : 1,
          shadowBlur: isGodNode ? 12 : 0,
          shadowColor: isGodNode ? nodeColor : undefined,
        },
        label: {
          show: true,
          fontSize: isGodNode ? 12 : 10,
          fontWeight: isGodNode ? 700 : 400,
          formatter: () => truncatedName,
        },
        tooltip: {
          formatter:
            `<div style="max-width:320px;word-break:break-word;line-height:1.6;font-size:11px">`
            + `<b style="font-size:13px">${friendlyName}</b>`
            + (isGodNode ? `<br/><span style="color:#FFD700;font-weight:bold">★ 中心节点 (关联度: ${degree})</span>` : "")
            + (valuePreview ? `<br/><span style="color:#475569;white-space:pre-wrap">${valuePreview}</span>` : "")
            + `<br/><span style="color:#94A3B8;font-size:9px">类型: ${node.type} · 关联: ${degree}${node.tags ? " · 标签: " + (Array.isArray(node.tags) ? node.tags.join(", ") : node.tags) : ""}</span>`
            + `</div>`,
        },
        value: degree,
      };

      // 环形/径向布局：预设初始坐标，但不 fixed，允许拖动
      if (presetPositions) {
        const pos = presetPositions.get(node.id);
        if (pos) {
          base.x = pos.x;
          base.y = pos.y;
          // 注意：不设置 fixed，这样 ECharts 允许拖动
        }
      }

      return base;
    });

    const echartsEdges = edges
      .filter((e) => nodeIdSet.has(e.source) && nodeIdSet.has(e.target))
      .map((edge) => {
        const lineStyle =
          edge.type === "INFERRED"
            ? { type: "dashed" as const, opacity: 0.6 }
            : edge.type === "TEMPORAL"
            ? { type: "dotted" as const, opacity: 0.4 }
            : { type: "solid" as const, opacity: 0.8 };

        const edgeLabel = (edge.label ?? edge.type).replace("shared_tags:", "共同标签: ");
        return {
          source: edge.source,
          target: edge.target,
          lineStyle,
          label: { show: false },
          tooltip: { formatter: `<div style="max-width:280px;word-break:break-word;line-height:1.6;font-size:11px"><b>${edgeLabel}</b><br/><span style="color:#94A3B8;font-size:9px">${edge.type}</span></div>` },
        };
      });

    const seriesBase: any = {
      type: "graph",
      data: echartsNodes,
      edges: echartsEdges,
      roam: true,
      draggable: true, // 三种布局全部支持拖动
      lineStyle: { color: "source", curveness: 0.2 },
      emphasis: {
        focus: "adjacency",
        lineStyle: { width: 3 },
      },
    };

    if (mode === "force") {
      seriesBase.layout = "force";
      seriesBase.force = {
        repulsion: 120,
        gravity: 0.1,
        edgeLength: [80, 200],
        layoutAnimation: true,
      };
    } else {
      // circular / radial 都使用 layout: 'none' + 预设坐标，这样才能拖动
      seriesBase.layout = "none";
    }

    return {
      tooltip: {
        trigger: "item",
        confine: true,
        enterable: true,
        extraCssText: "max-width:360px;",
        formatter: (params: any) => params.data?.tooltip?.formatter ?? params.name,
      },
      series: [seriesBase],
    };
  };

  const displayNodes = queryResults?.nodes ?? graphData.nodes;
  const displayEdges = queryResults?.edges ?? graphData.edges;
  const chartOption = buildChartOption(displayNodes, displayEdges, layoutMode);

  const nodeColumns = [
    {
      title: t("label"),
      dataIndex: "label",
      key: "label",
      render: (v: string) => <Text strong>{v}</Text>,
    },
    {
      title: t("type"),
      dataIndex: "type",
      key: "type",
      render: (v: string) => <Tag color={NODE_TYPE_COLOR[v] ?? "default"}>{v}</Tag>,
    },
    {
      title: t("community"),
      dataIndex: "communityId",
      key: "communityId",
      render: (v: number | undefined) =>
        v !== undefined ? (
          <Tag color={COMMUNITY_COLORS[v % COMMUNITY_COLORS.length]}>#{v}</Tag>
        ) : (
          <Text type="secondary">-</Text>
        ),
    },
    {
      title: t("degree"),
      dataIndex: "degree",
      key: "degree",
      render: (v: number | undefined) => v ?? 0,
    },
    {
      title: t("tags"),
      dataIndex: "tags",
      key: "tags",
      render: (tags: string[] | undefined) =>
        tags?.map((t) => <Tag key={t}>{t}</Tag>) ?? null,
    },
  ];

  return (
    <div style={{ padding: 0 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 20 }}>
        <NodeIndexOutlined style={{ fontSize: 24, color: "#5470c6" }} />
        <Title level={3} style={{ margin: 0 }}>
          {t("knowledge_graph")}
        </Title>
      </div>

      {/* Stats Row */}
      <Row gutter={[16, 16]} style={{ marginBottom: 16 }}>
        <Col xs={12} sm={6}>
          <Card size="small" className="glass-card">
            <Statistic
              title={t("nodes")}
              value={stats?.nodeCount ?? 0}
              prefix={<NodeIndexOutlined />}
            />
          </Card>
        </Col>
        <Col xs={12} sm={6}>
          <Card size="small" className="glass-card">
            <Statistic
              title={t("edges")}
              value={stats?.edgeCount ?? 0}
            />
          </Card>
        </Col>
        <Col xs={12} sm={6}>
          <Card size="small" className="glass-card">
            <Statistic
              title={t("communities")}
              value={stats?.communityCount ?? 0}
              prefix={<ClusterOutlined />}
            />
          </Card>
        </Col>
        <Col xs={12} sm={6}>
          <Card size="small" className="glass-card">
            <Statistic
              title={t("god_nodes")}
              value={stats?.godNodeCount ?? 0}
            />
          </Card>
        </Col>
      </Row>

      {/* Action Bar */}
      <Card size="small" className="glass-card" style={{ marginBottom: 16 }}>
        <Space wrap>
          <Button
            icon={<SyncOutlined spin={syncing} />}
            onClick={handleSync}
            loading={syncing}
            type="primary"
          >
            {t("sync_from_ltm")}
          </Button>
          <Button
            icon={<ClusterOutlined />}
            onClick={handleRebuildCommunities}
          >
            {t("rebuild_communities")}
          </Button>
          <Button
            icon={<ReloadOutlined />}
            onClick={() => { loadStats(); loadGraphData(); setQueryResults(null); }}
          >
            {t("refresh")}
          </Button>
          <Input.Search
            placeholder={t("query_knowledge_graph")}
            value={queryText}
            onChange={(e) => setQueryText(e.target.value)}
            onSearch={handleQuery}
            enterButton={<Button icon={<SearchOutlined />} loading={querying}>{t("query")}</Button>}
            style={{ width: 360 }}
          />
          {queryResults && (
            <Button onClick={() => setQueryResults(null)}>{t("clear_query")}</Button>
          )}
        </Space>
      </Card>

      {/* Graph Visualization */}
      <Card
        className="glass-card"
        title={
          <Space>
            <NodeIndexOutlined />
            {queryResults
              ? `${t("query_results")} — ${displayNodes.length} ${t("nodes")}, ${displayEdges.length} ${t("edges")}`
              : `${t("full_graph")} — ${displayNodes.length} ${t("nodes")}, ${displayEdges.length} ${t("edges")}`}
          </Space>
        }
        style={{ marginBottom: 16 }}
        extra={
          <Space>
            <Segmented
              size="small"
              value={layoutMode}
              onChange={(v) => setLayoutMode(v as any)}
              options={[
                { label: <Space size={4}><ShareAltOutlined />力导向</Space>, value: "force" },
                { label: <Space size={4}><AimOutlined />环形</Space>, value: "circular" },
                { label: <Space size={4}><ApartmentOutlined />径向</Space>, value: "radial" },
              ]}
            />
            <Tag color="blue">{t("solid_extracted")}</Tag>
            <Tag color="orange">{t("dashed_inferred")}</Tag>
            <Tag color="gray">{t("dotted_temporal")}</Tag>
          </Space>
        }
      >
        {loading ? (
          <div style={{ textAlign: "center", padding: 80 }}>
            <Spin size="large" />
          </div>
        ) : chartOption ? (
          <ReactECharts
            option={chartOption}
            style={{ height: 520 }}
            notMerge
            lazyUpdate
          />
        ) : (
          <Empty
            description="No graph data. Sync from LTM to build the knowledge graph."
            style={{ padding: 80 }}
          />
        )}
      </Card>

      {/* Node Table */}
      {displayNodes.length > 0 && (
        <Card title={t("nodes")} size="small" className="glass-card">
          <Table
            dataSource={displayNodes}
            columns={nodeColumns}
            rowKey="id"
            size="small"
            pagination={{ pageSize: 10, showSizeChanger: true }}
            scroll={{ x: true }}
          />
        </Card>
      )}
    </div>
  );
}
