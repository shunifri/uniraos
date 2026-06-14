import { Form, Typography } from "antd";
import { useI18nStore } from "@/i18n";
import CodeEditor from "@/components/CodeEditor";

const { Text } = Typography;

const DEFAULT_HANDLER = `async ({ params, context, deps }) => {
  // Your skill logic here
  // params: the input parameters defined in the Parameters tab
  // context: execution context with traceId, user, etc.
  // deps: resolved dependencies

  return { result: "" };
}`;

interface Props {
  value: string;
  onChange: (value: string) => void;
}

export default function HandlerTab({ value, onChange }: Props) {
  const t = useI18nStore((s) => s.t);

  return (
    <div style={{ height: "100%", display: "flex", flexDirection: "column" }}>
      <Text type="secondary" style={{ marginBottom: 8, fontSize: 12 }}>
        {t("handler_template_hint")}
      </Text>
      <div style={{ flex: 1 }}>
        <CodeEditor
          value={value || DEFAULT_HANDLER}
          onChange={onChange}
          rows={20}
          placeholder={DEFAULT_HANDLER}
        />
      </div>
    </div>
  );
}
