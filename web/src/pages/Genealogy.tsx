import { useState, useEffect, useCallback } from "react";
import {
  Card,
  Tree,
  Tag,
  Button,
  Space,
  Flex,
  Typography,
  List,
  Row,
  Col,
  Statistic,
} from "antd";
import type { TreeDataNode } from "antd";
import {
  ApartmentOutlined,
  ReloadOutlined,
} from "@ant-design/icons";
import { api } from "@/api";
import { useI18nStore } from "@/i18n";

const { Text } = Typography;

function useT() {
  const { t } = useI18nStore();
  return t;
}

interface GenealogyNode {
  name: string;
  depth: number;
  children?: GenealogyNode[];
}

interface GenealogyStats {
  totalGenerated: number;
  maxDepth: number;
  rootSkills: number;
  leafSkills: number;
}

interface EmergencePattern {
  id?: string;
  type?: string;
  severity?: "critical" | "warning" | "info";
  description?: string;
  [key: string]: any;
}

const severityColor: Record<string, string> = {
  critical: "red",
  warning: "orange",
  info: "blue",
};

const depthColors = [
  "var(--ant-color-primary)",
  "#52c41a",
  "#fa8c16",
  "#722ed1",
  "#eb2f96",
  "#13c2c2",
];

function getDepthColor(depth: number): string {
  return depthColors[depth % depthColors.length];
}

function mapToTreeData(node: GenealogyNode, parentKey = ""): TreeDataNode {
  const key = parentKey ? `${parentKey}-${node.name}` : node.name;
  return {
    key,
    title: (
      <Flex align="center" gap={6}>
        <Text strong style={{ fontSize: 13 }}>
          {node.name}
        </Text>
        <Tag
          style={{
            fontSize: 10,
            lineHeight: "16px",
            margin: 0,
            color: getDepthColor(node.depth),
            borderColor: getDepthColor(node.depth),
          }}
        >
          depth {node.depth}
        </Tag>
      </Flex>
    ),
    children: node.children?.map((child) => mapToTreeData(child, key)),
  };
}

export default function GenealogyPage() {
  const t = useT();
  const [tree, setTree] = useState<GenealogyNode | null>(null);
  const [stats, setStats] = useState<GenealogyStats | null>(null);
  const [patterns, setPatterns] = useState<EmergencePattern[]>([]);
  const [loadingTree, setLoadingTree] = useState(false);
  const [loadingPatterns, setLoadingPatterns] = useState(false);

  const loadGenealogy = useCallback(async () => {
    setLoadingTree(true);
    try {
      const data = await api.get<{ tree: GenealogyNode; stats: GenealogyStats }>(
        "/api/evolution/genealogy"
      );
      setTree(data.tree ?? null);
      setStats(data.stats ?? null);
    } catch {
      // non-fatal
    }
    setLoadingTree(false);
  }, []);

  const loadEmergence = useCallback(async () => {
    setLoadingPatterns(true);
    try {
      const data = await api.get<{ patterns: EmergencePattern[]; report?: any }>(
        "/api/evolution/emergence"
      );
      setPatterns(data.patterns ?? []);
    } catch {
      // non-fatal
    }
    setLoadingPatterns(false);
  }, []);

  const loadAll = useCallback(() => {
    loadGenealogy();
    loadEmergence();
  }, [loadGenealogy, loadEmergence]);

  useEffect(() => {
    loadAll();
    const timer = setInterval(loadAll, 60000);
    return () => clearInterval(timer);
  }, [loadAll]);

  const treeData: TreeDataNode[] = tree ? [mapToTreeData(tree)] : [];

  return (
    <Flex vertical gap={16} style={{ maxWidth: 1200, margin: "0 auto" }}>
      {/* Section 1: Stats Overview */}
      <Card
        size="small"
        className="glass-card"
        title={
          <Flex align="center" gap={8}>
            <ApartmentOutlined />
            <span>Skill Genealogy</span>
          </Flex>
        }
        extra={
          <Button size="small" icon={<ReloadOutlined />} onClick={loadAll}>
            {t("refresh")}
          </Button>
        }
      >
        {stats ? (
          <Row gutter={[16, 8]}>
            <Col xs={12} sm={6}>
              <Statistic
                title="Total Generated"
                value={stats.totalGenerated ?? 0}
                valueStyle={{ fontSize: 20 }}
              />
            </Col>
            <Col xs={12} sm={6}>
              <Statistic
                title="Max Depth"
                value={stats.maxDepth ?? 0}
                valueStyle={{ fontSize: 20 }}
              />
            </Col>
            <Col xs={12} sm={6}>
              <Statistic
                title="Root Skills"
                value={stats.rootSkills ?? 0}
                valueStyle={{ fontSize: 20 }}
              />
            </Col>
            <Col xs={12} sm={6}>
              <Statistic
                title="Leaf Skills"
                value={stats.leafSkills ?? 0}
                valueStyle={{ fontSize: 20 }}
              />
            </Col>
          </Row>
        ) : (
          <Text type="secondary">
            {loadingTree ? "Loading stats..." : "No genealogy data available"}
          </Text>
        )}
      </Card>

      {/* Section 2: Tree View */}
      <Card
        size="small"
        className="glass-card"
        title="Family Tree"
        extra={
          <Button size="small" icon={<ReloadOutlined />} onClick={loadGenealogy} loading={loadingTree}>
            {t("refresh")}
          </Button>
        }
      >
        {loadingTree && !tree ? (
          <Text type="secondary">Loading tree...</Text>
        ) : treeData.length === 0 ? (
          <Text type="secondary">No genealogy tree available yet</Text>
        ) : (
          <Tree
            treeData={treeData}
            defaultExpandAll
            showLine={{ showLeafIcon: false }}
            style={{ fontSize: 13 }}
          />
        )}
      </Card>

      {/* Section 3: Emergence Patterns */}
      <Card
        size="small"
        className="glass-card"
        title={
          <Flex align="center" gap={8}>
            <span>Emergence Patterns</span>
            {patterns.length > 0 && (
              <Tag color="blue">{patterns.length} detected</Tag>
            )}
          </Flex>
        }
        extra={
          <Button size="small" icon={<ReloadOutlined />} onClick={loadEmergence} loading={loadingPatterns}>
            {t("refresh")}
          </Button>
        }
      >
        {loadingPatterns && patterns.length === 0 ? (
          <Text type="secondary">Loading patterns...</Text>
        ) : patterns.length === 0 ? (
          <Text type="secondary">No emergence patterns detected</Text>
        ) : (
          <List
            size="small"
            dataSource={patterns}
            renderItem={(p) => (
              <List.Item>
                <Flex align="center" gap={8} style={{ width: "100%" }}>
                  <Tag
                    color={severityColor[p.severity ?? "info"] ?? "blue"}
                    style={{ flexShrink: 0 }}
                  >
                    {p.severity ?? "info"}
                  </Tag>
                  {p.type && (
                    <Tag color="default" style={{ flexShrink: 0 }}>
                      {p.type}
                    </Tag>
                  )}
                  <Text style={{ fontSize: 13 }}>
                    {p.description ?? JSON.stringify(p)}
                  </Text>
                </Flex>
              </List.Item>
            )}
          />
        )}
      </Card>
    </Flex>
  );
}
