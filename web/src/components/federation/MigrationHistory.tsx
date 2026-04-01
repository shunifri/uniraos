import { useState, useEffect } from "react";
import {
  Card,
  Table,
  Button,
  DatePicker,
  Empty,
  App,
  Badge,
  Flex,
  Tag,
} from "antd";
import { ReloadOutlined } from "@ant-design/icons";
import { api } from "@/api";
import dayjs from "dayjs";

interface Migration {
  skillName: string;
  sourceInstance: string;
  migrationTime: string;
  status: "success" | "failed" | "pending";
  successRateChange: number;
}

export default function MigrationHistory() {
  const { message } = App.useApp();
  const [migrations, setMigrations] = useState<Migration[]>([]);
  const [loading, setLoading] = useState(false);
  const [dateRange, setDateRange] = useState<[dayjs.Dayjs | null, dayjs.Dayjs | null]>([null, null]);

  const loadMigrations = async () => {
    try {
      setLoading(true);
      const params = new URLSearchParams();
      if (dateRange[0]) params.append("since", dateRange[0].toISOString());
      if (dateRange[1]) params.append("until", dateRange[1].toISOString());
      const data = await api.get<Migration[]>(
        `/api/federation/migrations?${params.toString()}`
      );
      setMigrations(data);
    } catch (e: any) {
      message.error(e.message || "Failed to load migration history");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadMigrations();
  }, []);

  const handleDateChange = (dates: any) => {
    setDateRange([dates?.[0] || null, dates?.[1] || null]);
  };

  const handleApplyFilter = () => {
    loadMigrations();
  };

  const columns = [
    {
      title: "Skill Name",
      dataIndex: "skillName",
      key: "skillName",
      render: (text: string) => <span>{text}</span>,
    },
    {
      title: "Source Instance",
      dataIndex: "sourceInstance",
      key: "sourceInstance",
      render: (text: string) => <Tag>{text}</Tag>,
    },
    {
      title: "Migration Time",
      dataIndex: "migrationTime",
      key: "migrationTime",
      render: (text: string) => (
        <span>{new Date(text).toLocaleString()}</span>
      ),
    },
    {
      title: "Status",
      dataIndex: "status",
      key: "status",
      render: (status: string) => {
        let color = "default";
        if (status === "success") color = "success";
        else if (status === "failed") color = "error";
        else if (status === "pending") color = "processing";
        return <Badge status={color} text={status} />;
      },
    },
    {
      title: "Success Rate Change",
      dataIndex: "successRateChange",
      key: "successRateChange",
      render: (change: number) => (
        <span style={{ color: change > 0 ? "#52c41a" : change < 0 ? "#f5222d" : "#999" }}>
          {change > 0 ? "+" : ""}{(change * 100).toFixed(2)}%
        </span>
      ),
    },
  ];

  return (
    <Flex vertical gap={16}>
      <Flex gap={8} wrap>
        <DatePicker.RangePicker
          value={dateRange}
          onChange={handleDateChange}
          style={{ flex: 1 }}
        />
        <Button type="primary" onClick={handleApplyFilter}>
          Apply Filter
        </Button>
        <Button
          icon={<ReloadOutlined />}
          onClick={loadMigrations}
          loading={loading}
        >
          Refresh
        </Button>
      </Flex>

      {migrations.length === 0 ? (
        <Empty description="No migrations found" />
      ) : (
        <Table
          columns={columns}
          dataSource={migrations.map((m) => ({
            ...m,
            key: `${m.skillName}-${m.migrationTime}`,
          }))}
          loading={loading}
          size="small"
          pagination={{ pageSize: 10 }}
        />
      )}
    </Flex>
  );
}
