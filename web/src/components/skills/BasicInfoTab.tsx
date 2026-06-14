import { Form, Input, Select, Tag, Space, Button, Flex } from "antd";
import { useI18nStore } from "@/i18n";

interface Props {
  value: {
    name: string;
    description: string;
    version: string;
    tags: string[];
    visible: boolean;
    autonomy: string;
    dependencies: string[];
    timeout: number;
    icon: string;
  };
  onChange: (value: Props["value"]) => void;
  existingSkillNames: string[];
  isEditing: boolean;
}

const autonomyOptions = [
  { value: "MANUAL", label: "MANUAL" },
  { value: "AUTO_PRE", label: "AUTO_PRE" },
  { value: "AUTO_POST", label: "AUTO_POST" },
  { value: "GUARDIAN", label: "GUARDIAN" },
];

export default function BasicInfoTab({
  value,
  onChange,
  existingSkillNames,
  isEditing,
}: Props) {
  const t = useI18nStore((s) => s.t);

  const update = (partial: Partial<Props["value"]>) => {
    onChange({ ...value, ...partial });
  };

  return (
    <Form layout="vertical" size="small">
      <Form.Item
        label={t("name")}
        required
        validateStatus={
          value.name && existingSkillNames.includes(value.name) && !isEditing
            ? "error"
            : undefined
        }
        help={
          value.name && existingSkillNames.includes(value.name) && !isEditing
            ? "Skill name already exists"
            : undefined
        }
      >
        <Input
          value={value.name}
          onChange={(e) => update({ name: e.target.value })}
          placeholder={t("skill_name_placeholder")}
          disabled={isEditing}
        />
      </Form.Item>

      <Form.Item label={t("description")}>
        <Input.TextArea
          value={value.description}
          onChange={(e) => update({ description: e.target.value })}
          placeholder={t("skill_description_placeholder")}
          rows={3}
        />
      </Form.Item>

      <Flex gap={16}>
        <Form.Item label={t("version")} style={{ flex: 1 }}>
          <Input
            value={value.version}
            onChange={(e) => update({ version: e.target.value })}
            placeholder="1.0.0"
          />
        </Form.Item>

        <Form.Item label={t("icon")} style={{ flex: 1 }}>
          <Input
            value={value.icon}
            onChange={(e) => update({ icon: e.target.value })}
            placeholder="⚡"
          />
        </Form.Item>
      </Flex>

      <Form.Item label={t("tags")}>
        <Select
          mode="tags"
          value={value.tags}
          onChange={(tags) => update({ tags })}
          placeholder={t("tags")}
          tokenSeparators={[","]}
          style={{ width: "100%" }}
        />
      </Form.Item>

      <Flex gap={16}>
        <Form.Item label={t("visibility")} style={{ flex: 1 }}>
          <Select
            value={value.visible ? "public" : "private"}
            onChange={(v) => update({ visible: v === "public" })}
            options={[
              { value: "public", label: t("public") },
              { value: "private", label: t("private") },
              { value: "organization", label: t("organization") },
            ]}
          />
        </Form.Item>

        <Form.Item label={t("autonomy")} style={{ flex: 1 }}>
          <Select
            value={value.autonomy}
            onChange={(v) => update({ autonomy: v })}
            options={autonomyOptions}
          />
        </Form.Item>
      </Flex>

      <Form.Item label={t("timeout")}>
        <Input
          type="number"
          value={value.timeout}
          onChange={(e) => update({ timeout: Number(e.target.value) })}
          addonAfter="ms"
        />
      </Form.Item>

      <Form.Item label={t("dependencies")}>
        <Select
          mode="tags"
          value={value.dependencies}
          onChange={(deps) => update({ dependencies: deps })}
          placeholder={t("dependencies")}
          tokenSeparators={[","]}
          style={{ width: "100%" }}
        />
      </Form.Item>
    </Form>
  );
}
