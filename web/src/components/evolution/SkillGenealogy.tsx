import { useState, useEffect } from "react";
import {
  Card,
  Flex,
  Tree,
  Empty,
  App,
  Collapse,
  Tag,
  Badge,
  Button,
  Typography,
  Spin,
} from "antd";
import {
  ReloadOutlined,
  EyeOutlined,
} from "@ant-design/icons";
import { api } from "@/api";
import { useI18nStore } from "@/i18n";

const { Text } = Typography;

interface GenealogyNode {
  key: string;
  title: string;
  generation: number;
  creator?: string;
  status?: "approved" | "pending" | "rejected";
  children?: GenealogyNode[];
  description?: string;
  createdAt?: string;
}

export default function SkillGenealogy() {
  const { message } = App.useApp();
  const t = useI18nStore((s) => s.t);
  const [treeData, setTreeData] = useState<GenealogyNode[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedNode, setSelectedNode] = useState<GenealogyNode | null>(null);

  const loadGenealogy = async () => {
    try {
      setLoading(true);
      const data = await api.get<any>("/api/evolution/genealogy");
      setTreeData(data.tree || []);
    } catch (e: any) {
      message.error(e.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadGenealogy();
  }, []);

  const renderTreeTitle = (node: GenealogyNode) => (
    <Flex gap={8} align="center">
      <Text strong>{node.title}</Text>
      <Tag>{t("generation")} {node.generation}</Tag>
      {node.status && (
        <Badge
          status={
            node.status === "approved"
              ? "success"
              : node.status === "pending"
              ? "processing"
              : "error"
          }
          text={node.status}
        />
      )}
    </Flex>
  );

  const treeDataWithTitles = treeData.map((node) => ({
    ...node,
    title: renderTreeTitle(node),
  }));

  return (
    <Flex vertical gap={16} style={{ height: "100%" }}>
      <Flex gap={8}>
        <Button
          size="small"
          icon={<ReloadOutlined />}
          onClick={loadGenealogy}
          loading={loading}
        >
          {t("refresh")}
        </Button>
      </Flex>

      {loading ? (
        <Spin />
      ) : treeData.length === 0 ? (
        <Empty description={t("no_genealogy_data")} />
      ) : (
        <Flex gap={16} style={{ flex: 1, overflow: "auto" }}>
          {/* Tree View */}
          <Card
            size="small"
            title={t("skill_family_tree")}
            style={{ flex: 1 }}
            styles={{ body: { overflow: "auto" } }}
          >
            <Tree
              treeData={treeDataWithTitles}
              onSelect={(selectedKeys, info) => {
                if (selectedKeys.length > 0 && info.node) {
                  setSelectedNode(info.node as unknown as GenealogyNode);
                }
              }}
            />
          </Card>

          {/* Detail Panel */}
          {selectedNode && (
            <Card
              size="small"
              title={`Details: ${selectedNode.title}`}
              style={{ width: 320, flexShrink: 0 }}
              styles={{ body: { overflow: "auto" } }}
            >
              <Flex vertical gap={12}>
                <div>
                  <Text type="secondary" style={{ fontSize: 12 }}>
                    Generation
                  </Text>
                  <br />
                  <Text>{selectedNode.generation}</Text>
                </div>

                {selectedNode.creator && (
                  <div>
                    <Text type="secondary" style={{ fontSize: 12 }}>
                      Creator
                    </Text>
                    <br />
                    <Text>{selectedNode.creator}</Text>
                  </div>
                )}

                {selectedNode.status && (
                  <div>
                    <Text type="secondary" style={{ fontSize: 12 }}>
                      Status
                    </Text>
                    <br />
                    <Badge
                      status={
                        selectedNode.status === "approved"
                          ? "success"
                          : selectedNode.status === "pending"
                          ? "processing"
                          : "error"
                      }
                      text={selectedNode.status}
                    />
                  </div>
                )}

                {selectedNode.createdAt && (
                  <div>
                    <Text type="secondary" style={{ fontSize: 12 }}>
                      Created
                    </Text>
                    <br />
                    <Text style={{ fontSize: 12 }}>
                      {new Date(selectedNode.createdAt).toLocaleString()}
                    </Text>
                  </div>
                )}

                {selectedNode.description && (
                  <div>
                    <Text type="secondary" style={{ fontSize: 12 }}>
                      Description
                    </Text>
                    <br />
                    <Text style={{ fontSize: 12 }}>{selectedNode.description}</Text>
                  </div>
                )}

                <Button
                  type="primary"
                  size="small"
                  icon={<EyeOutlined />}
                  block
                >
                  View Details
                </Button>
              </Flex>
            </Card>
          )}
        </Flex>
      )}
    </Flex>
  );
}
