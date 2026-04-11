import { useState, useEffect } from "react";
import {
  Card,
  Table,
  Button,
  Select,
  Space,
  Empty,
  App,
  Flex,
  Input,
  Tag,
} from "antd";
import {
  ReloadOutlined,
  SearchOutlined,
} from "@ant-design/icons";
import { api } from "@/api";

interface SkillMetric {
  skillName: string;
  localSuccessRate: number;
  remotePeers: {
    peerId: string;
    successRate: number;
  }[];
  bestSource: string;
}

export default function MetricsComparison() {
  const { message } = App.useApp();
  const [metrics, setMetrics] = useState<SkillMetric[]>([]);
  const [loading, setLoading] = useState(false);
  const [interval, setInterval] = useState("1h");
  const [searchText, setSearchText] = useState("");

  const loadMetrics = async () => {
    try {
      setLoading(true);
      const data = await api.get<SkillMetric[]>(
        `/api/federation/metrics?interval=${interval}`
      );
      setMetrics(data);
    } catch (e: any) {
      message.error(e.message || "Failed to load metrics");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadMetrics();
  }, [interval]);

  const filteredMetrics = metrics.filter((m) =>
    m.skillName.toLowerCase().includes(searchText.toLowerCase())
  );

  const sortedMetrics = filteredMetrics.sort(
    (a, b) => b.localSuccessRate - a.localSuccessRate
  );

  const allPeerIds = Array.from(
    new Set(
      metrics.flatMap((m) => m.remotePeers.map((p) => p.peerId))
    )
  );

  const columns = [
    {
      title: "Skill Name",
      dataIndex: "skillName",
      key: "skillName",
      width: 150,
      render: (text: string) => <span>{text}</span>,
    },
    {
      title: "Local Success Rate",
      dataIndex: "localSuccessRate",
      key: "localSuccessRate",
      width: 120,
      render: (rate: number) => (
        <span style={{ color: rate > 0.9 ? "#52c41a" : rate > 0.7 ? "#faad14" : "#f5222d" }}>
          {(rate * 100).toFixed(2)}%
        </span>
      ),
    },
    ...allPeerIds.map((peerId) => ({
      title: `${peerId} Success Rate`,
      key: `peer-${peerId}`,
      width: 120,
      render: (_: any, record: SkillMetric) => {
        const peer = record.remotePeers.find((p) => p.peerId === peerId);
        if (!peer) return "-";
        return (
          <span style={{ color: peer.successRate > 0.9 ? "#52c41a" : peer.successRate > 0.7 ? "#faad14" : "#f5222d" }}>
            {(peer.successRate * 100).toFixed(2)}%
          </span>
        );
      },
    })),
    {
      title: "Best Source",
      dataIndex: "bestSource",
      key: "bestSource",
      width: 120,
      render: (text: string) => (
        <Tag color={text === "local" ? "blue" : "green"}>{text}</Tag>
      ),
    },
  ];

  return (
    <Flex vertical gap={16}>
      <Flex gap={8} wrap>
        <Input
          placeholder="Search skills..."
          prefix={<SearchOutlined />}
          value={searchText}
          onChange={(e) => setSearchText(e.target.value)}
          style={{ maxWidth: 250 }}
        />
        <Select
          value={interval}
          onChange={setInterval}
          style={{ width: 100 }}
          options={[
            { label: "1 Hour", value: "1h" },
            { label: "1 Day", value: "1d" },
            { label: "1 Week", value: "1w" },
            { label: "1 Month", value: "1m" },
          ]}
        />
        <Button
          icon={<ReloadOutlined />}
          onClick={loadMetrics}
          loading={loading}
        >
          Refresh
        </Button>
      </Flex>

      {sortedMetrics.length === 0 ? (
        <Empty description="No metrics found" />
      ) : (
        <div style={{ overflow: "auto" }}>
          <Table
            columns={columns}
            dataSource={sortedMetrics.map((m) => ({
              ...m,
              key: m.skillName,
            }))}
            loading={loading}
            size="small"
            pagination={{ pageSize: 10 }}
            scroll={{ x: true }}
          />
        </div>
      )}
    </Flex>
  );
}
