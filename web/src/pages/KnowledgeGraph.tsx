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
} from "antd";
import {
  NodeIndexOutlined,
  SyncOutlined,
  SearchOutlined,
  ClusterOutlined,
  ReloadOutlined,
} from "@ant-design/icons";
import ReactECharts from "echarts-for-react";
import { api } from "@/api";

const { Title, Text } = Typography;

interface GraphNode {
  id: string;
  label: string;
  type: string;
  communityId?: number;
  degree?: number;
  weight?: number;
  createdAt?: number;
  tags?: string[];
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

const NODE_TYPE_COLOR: Record<string, string> = {
  ltm: "#5470c6",
  kb_document: "#91cc75",
  entity: "#fac858",
  concept: "#ee6666",
};

export default function KnowledgeGraphPage() {
  const { message } = App.useApp();

  const [stats, setStats] = useState<GraphStats | null>(null);
  const [graphData, setGraphData] = useState<{ nodes: GraphNode[]; edges: GraphEdge[] }>({ nodes: [], edges: [] });
  const [queryResults, setQueryResults] = useState<{ nodes: GraphNode[]; edges: GraphEdge[] } | null>(null);
  const [loading, setLoading] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [querying, setQuerying] = useState(false);
  const [queryText, setQueryText] = useState("");

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
      setGraphData(data);
    } catch (err) {
      message.error("Failed to load graph data");
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
      message.error("Sync failed");
    } finally {
      setSyncing(false);
    }
  };

  const handleRebuildCommunities = async () => {
    try {
      await api.post("/api/graph/communities");
      message.success("Communities rebuilt");
      await loadStats();
      await loadGraphData();
    } catch {
      message.error("Failed to rebuild communities");
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
      message.error("Query failed");
    } finally {
      setQuerying(false);
    }
  };

  // Build ECharts option from graph data
  const buildChartOption = (nodes: GraphNode[], edges: GraphEdge[]) => {
    if (nodes.length === 0) return null;

    const nodeIdSet = new Set(nodes.map((n) => n.id));

    const echartsNodes = nodes.map((node) => {
      const communityColor = node.communityId !== undefined
        ? COMMUNITY_COLORS[node.communityId % COMMUNITY_COLORS.length]
        : NODE_TYPE_COLOR[node.type] ?? "#888";
      const degree = node.degree ?? 1;
      const size = Math.max(10, Math.min(40, 10 + degree * 3));

      // 友好的显示名称：去掉 fact:/recall: 等前缀，下划线转空格
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

      return {
        id: node.id,
        name: friendlyName,
        symbolSize: size,
        itemStyle: { color: communityColor },
        label: {
          show: true,
          fontSize: 10,
          formatter: () => truncatedName,
        },
        tooltip: {
          formatter: `<b style="font-size:14px">${friendlyName}</b>`
            + (valuePreview ? `<br/><span style="color:#475569">${valuePreview}</span>` : "")
            + `<br/><span style="color:#94A3B8;font-size:11px">类型: ${node.type} · 关联: ${degree}${node.tags?.length ? " · 标签: " + node.tags.join(", ") : ""}</span>`,
        },
        value: degree,
      };
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

        // 边的关系标签：去掉 shared_tags: 前缀，显示更友好
        const edgeLabel = (edge.label ?? edge.type).replace("shared_tags:", "共同标签: ");
        return {
          source: edge.source,
          target: edge.target,
          lineStyle,
          label: { show: false },
          tooltip: { formatter: `<b>${edgeLabel}</b><br/><span style="color:#94A3B8">${edge.type}</span>` },
        };
      });

    return {
      tooltip: {
        trigger: "item",
        formatter: (params: any) => params.data?.tooltip?.formatter ?? params.name,
      },
      series: [
        {
          type: "graph",
          layout: "force",
          data: echartsNodes,
          edges: echartsEdges,
          roam: true,
          draggable: true,
          force: {
            repulsion: 120,
            gravity: 0.1,
            edgeLength: [80, 200],
            layoutAnimation: true,
          },
          lineStyle: { color: "source", curveness: 0.2 },
          emphasis: {
            focus: "adjacency",
            lineStyle: { width: 3 },
          },
        },
      ],
    };
  };

  const displayNodes = queryResults?.nodes ?? graphData.nodes;
  const displayEdges = queryResults?.edges ?? graphData.edges;
  const chartOption = buildChartOption(displayNodes, displayEdges);

  const nodeColumns = [
    {
      title: "Label",
      dataIndex: "label",
      key: "label",
      render: (v: string) => <Text strong>{v}</Text>,
    },
    {
      title: "Type",
      dataIndex: "type",
      key: "type",
      render: (v: string) => <Tag color={NODE_TYPE_COLOR[v] ?? "default"}>{v}</Tag>,
    },
    {
      title: "Community",
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
      title: "Degree",
      dataIndex: "degree",
      key: "degree",
      render: (v: number | undefined) => v ?? 0,
    },
    {
      title: "Tags",
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
          Knowledge Graph
        </Title>
      </div>

      {/* Stats Row */}
      <Row gutter={[16, 16]} style={{ marginBottom: 16 }}>
        <Col xs={12} sm={6}>
          <Card size="small" className="glass-card">
            <Statistic
              title="Nodes"
              value={stats?.nodeCount ?? 0}
              prefix={<NodeIndexOutlined />}
            />
          </Card>
        </Col>
        <Col xs={12} sm={6}>
          <Card size="small" className="glass-card">
            <Statistic
              title="Edges"
              value={stats?.edgeCount ?? 0}
            />
          </Card>
        </Col>
        <Col xs={12} sm={6}>
          <Card size="small" className="glass-card">
            <Statistic
              title="Communities"
              value={stats?.communityCount ?? 0}
              prefix={<ClusterOutlined />}
            />
          </Card>
        </Col>
        <Col xs={12} sm={6}>
          <Card size="small" className="glass-card">
            <Statistic
              title="God Nodes"
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
            Sync from LTM
          </Button>
          <Button
            icon={<ClusterOutlined />}
            onClick={handleRebuildCommunities}
          >
            Rebuild Communities
          </Button>
          <Button
            icon={<ReloadOutlined />}
            onClick={() => { loadStats(); loadGraphData(); setQueryResults(null); }}
          >
            Refresh
          </Button>
          <Input.Search
            placeholder="Query knowledge graph (BFS)..."
            value={queryText}
            onChange={(e) => setQueryText(e.target.value)}
            onSearch={handleQuery}
            enterButton={<Button icon={<SearchOutlined />} loading={querying}>Query</Button>}
            style={{ width: 360 }}
          />
          {queryResults && (
            <Button onClick={() => setQueryResults(null)}>Clear Query</Button>
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
              ? `Query Results — ${displayNodes.length} nodes, ${displayEdges.length} edges`
              : `Full Graph — ${displayNodes.length} nodes, ${displayEdges.length} edges`}
          </Space>
        }
        style={{ marginBottom: 16 }}
        extra={
          <Space>
            <Tag color="blue">Solid = EXTRACTED</Tag>
            <Tag color="orange">Dashed = INFERRED</Tag>
            <Tag color="gray">Dotted = TEMPORAL</Tag>
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
        <Card title="Nodes" size="small" className="glass-card">
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
