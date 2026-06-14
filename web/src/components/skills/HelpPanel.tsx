import { Card, Collapse, Typography, List, Tag, Space } from "antd";
import { useI18nStore } from "@/i18n";

const { Text } = Typography;

interface Props {
  collapsed?: boolean;
}

export default function HelpPanel({ collapsed }: Props) {
  const t = useI18nStore((s) => s.t);

  if (collapsed) return null;

  const contextVars = [
    { name: "traceId", desc: "Unique trace ID for this execution chain" },
    { name: "callStack", desc: "Array of skill names in the current call stack" },
    { name: "depth", desc: "Current recursion depth" },
    { name: "maxDepth", desc: "Maximum allowed recursion depth" },
    { name: "callBudget.remaining", desc: "Remaining skill call budget" },
    { name: "user.id", desc: "Current user ID" },
    { name: "user.name", desc: "Current user name" },
    { name: "tasks.create()", desc: "Create an async task (for long-running skills)" },
    { name: "tasks.progress()", desc: "Report task progress (0-100)" },
    { name: "tasks.complete()", desc: "Mark task as complete" },
    { name: "tasks.fail()", desc: "Mark task as failed" },
  ];

  const examples = [
    {
      name: "Echo Skill",
      code: `async ({ params }) => {
  return { success: true, data: params };
}`,
    },
    {
      name: "Context Logger",
      code: `async ({ params, context }) => {
  // debug: console.log("User:", context.user?.name);
  // debug: console.log("Depth:", context.depth);
  return { success: true, data: { traceId: context.traceId } };
}`,
    },
    {
      name: "Async Task",
      code: `async ({ params, context }) => {
  const taskId = context.tasks?.create();
  context.tasks?.progress(taskId, 50);
  context.tasks?.complete(taskId, { result: "done" });
  return { success: true, async: { taskId, status: "RUNNING" } };
}`,
    },
  ];

  return (
    <Card
      size="small"
      className="glass-card"
      style={{
        width: 280,
        height: "100%",
        flexShrink: 0,
        overflow: "auto",
      }}
      title={t("help")}
    >
      <Collapse
        ghost
        size="small"
        defaultActiveKey={["guide", "context", "examples"]}
        items={[
          {
            key: "guide",
            label: t("skill_dev_guide"),
            children: (
              <div style={{ fontSize: 12 }}>
                <Text>
                  Skills are the building blocks of RAOS agents. Each skill
                  receives parameters, an execution context, and resolved
                  dependencies.
                </Text>
                <ul style={{ paddingLeft: 16, marginTop: 8 }}>
                  <li>Define parameters in the Parameters tab</li>
                  <li>Write handler logic in the Handler tab</li>
                  <li>Test with sample inputs in the Test tab</li>
                  <li>Return an object with success, data shape</li>
                </ul>
              </div>
            ),
          },
          {
            key: "context",
            label: t("context_variables"),
            children: (
              <List
                size="small"
                dataSource={contextVars}
                renderItem={(item) => (
                  <List.Item style={{ padding: "4px 0" }}>
                    <div>
                      <Tag style={{ fontSize: 11, lineHeight: '16px' }}>{item.name}</Tag>
                      <Text type="secondary" style={{ fontSize: 11 }}>
                        {" "}
                        {item.desc}
                      </Text>
                    </div>
                  </List.Item>
                )}
              />
            ),
          },
          {
            key: "examples",
            label: t("example_skills"),
            children: (
              <Space direction="vertical" style={{ width: "100%" }}>
                {examples.map((ex) => (
                  <div key={ex.name}>
                    <Text strong style={{ fontSize: 12 }}>
                      {ex.name}
                    </Text>
                    <pre
                      style={{
                        fontSize: 11,
                        background: "var(--ant-color-bg-container-disabled)",
                        padding: 8,
                        borderRadius: 4,
                        overflow: "auto",
                        margin: "4px 0 0 0",
                      }}
                    >
                      {ex.code}
                    </pre>
                  </div>
                ))}
              </Space>
            ),
          },
        ]}
      />
    </Card>
  );
}
