import { useState, useEffect, useCallback, useMemo } from "react";
import {
  Flex,
  Card,
  Tabs,
  Button,
  Space,
  App,
  Modal,
  Upload,
  Typography,
  Input,
} from "antd";
import {
  PlusOutlined,
  SaveOutlined,
  CopyOutlined,
  DeleteOutlined,
  CheckCircleOutlined,
  ImportOutlined,
  ExportOutlined,
  QuestionCircleOutlined,
} from "@ant-design/icons";
import type { UploadFile } from "antd/es/upload/interface";
import { useI18nStore } from "@/i18n";
import { getSkills, registerSkill, deleteSkill } from "@/api";
import SkillEditorSidebar, { type SkillListItem } from "@/components/skills/SkillEditorSidebar";
import BasicInfoTab from "@/components/skills/BasicInfoTab";
import ParametersTab, { type ParamSchema } from "@/components/skills/ParametersTab";
import HandlerTab from "@/components/skills/HandlerTab";
import TestTab from "@/components/skills/TestTab";
import HelpPanel from "@/components/skills/HelpPanel";

const { Text } = Typography;

interface SkillForm {
  name: string;
  description: string;
  version: string;
  tags: string[];
  visible: boolean;
  autonomy: string;
  dependencies: string[];
  timeout: number;
  paramSchema: ParamSchema;
  handler: string;
  icon: string;
}

const DEFAULT_FORM: SkillForm = {
  name: "",
  description: "",
  version: "1.0.0",
  tags: [],
  visible: true,
  autonomy: "MANUAL",
  dependencies: [],
  timeout: 30000,
  paramSchema: { properties: {}, required: [] },
  handler: `async ({ params, context, deps }) => {
  // Your skill logic here
  return { result: "" };
}`,
  icon: "⚡",
};

function formToApiPayload(form: SkillForm) {
  return {
    name: form.name,
    description: form.description,
    visible: form.visible,
    autonomy: form.autonomy,
    dependencies: form.dependencies,
    timeout: form.timeout,
    paramSchema: form.paramSchema,
    handler: form.handler,
    version: form.version,
    tags: form.tags,
    icon: form.icon,
  };
}

function apiSkillToForm(skill: SkillListItem & { paramSchema?: ParamSchema | null; handler?: string; version?: string; tags?: string[]; icon?: string }): SkillForm {
  return {
    name: skill.name,
    description: skill.description || "",
    version: skill.version || "1.0.0",
    tags: skill.tags || [],
    visible: skill.visible ?? true,
    autonomy: skill.autonomy || "MANUAL",
    dependencies: skill.dependencies || [],
    timeout: skill.timeout || 30000,
    paramSchema: skill.paramSchema || { properties: {}, required: [] },
    handler: skill.handler || DEFAULT_FORM.handler,
    icon: skill.icon || "⚡",
  };
}

export default function SkillEditorPage() {
  const t = useI18nStore((s) => s.t);
  const { message, modal } = App.useApp();

  const [skills, setSkills] = useState<SkillListItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedSkill, setSelectedSkill] = useState<SkillListItem | null>(null);
  const [form, setForm] = useState<SkillForm>({ ...DEFAULT_FORM });
  const [isEditing, setIsEditing] = useState(false);
  const [helpCollapsed, setHelpCollapsed] = useState(true);
  const [activeTab, setActiveTab] = useState("basic");
  const [saveAsOpen, setSaveAsOpen] = useState(false);
  const [saveAsName, setSaveAsName] = useState("");

  const loadSkills = useCallback(async () => {
    setLoading(true);
    try {
      const data = await getSkills();
      setSkills(Array.isArray(data) ? data : []);
    } catch {
      message.error(t("load_failed"));
    }
    setLoading(false);
  }, [message, t]);

  useEffect(() => {
    loadSkills();
  }, [loadSkills]);

  const existingNames = useMemo(
    () => skills.map((s) => s.name),
    [skills]
  );

  const handleSelect = (skill: SkillListItem) => {
    setSelectedSkill(skill);
    setForm(apiSkillToForm(skill as any));
    setIsEditing(true);
    setActiveTab("basic");
  };

  const handleNew = () => {
    setSelectedSkill(null);
    setForm({ ...DEFAULT_FORM });
    setIsEditing(false);
    setActiveTab("basic");
  };

  const handleSave = async () => {
    if (!form.name.trim()) {
      message.error(t("name") + " " + t("required"));
      return;
    }
    if (!isEditing && existingNames.includes(form.name.trim())) {
      message.error("Skill name already exists");
      return;
    }

    try {
      if (isEditing) {
        // Backend does not support update; delete then recreate
        await deleteSkill(form.name);
      }
      await registerSkill(formToApiPayload(form));
      message.success(t("skill_saved"));
      await loadSkills();
      setIsEditing(true);
      setSelectedSkill({
        name: form.name,
        description: form.description,
        autonomy: form.autonomy,
        visible: form.visible,
        dependencies: form.dependencies,
        timeout: form.timeout,
      });
    } catch (err: any) {
      message.error(err.message || t("error"));
    }
  };

  const handleSaveAs = () => {
    setSaveAsName(form.name + "_copy");
    setSaveAsOpen(true);
  };

  const handleConfirmSaveAs = async () => {
    const newName = saveAsName.trim();
    if (!newName || existingNames.includes(newName)) {
      message.error("Invalid or duplicate name");
      return;
    }
    try {
      await registerSkill(formToApiPayload({ ...form, name: newName }));
      message.success(t("skill_saved"));
      setSaveAsOpen(false);
      await loadSkills();
    } catch (err: any) {
      message.error(err.message || t("error"));
    }
  };

  const handleDuplicate = () => {
    setSelectedSkill(null);
    setForm({ ...form, name: form.name + "_copy" });
    setIsEditing(false);
    setActiveTab("basic");
  };

  const handleDelete = () => {
    if (!form.name) return;
    modal.confirm({
      title: t("confirm_delete_skill"),
      content: form.name,
      okText: t("delete"),
      okType: "danger",
      onOk: async () => {
        try {
          await deleteSkill(form.name);
          message.success(t("skill_deleted"));
          handleNew();
          await loadSkills();
        } catch (err: any) {
          message.error(err.message || t("error"));
        }
      },
    });
  };

  const handleValidate = () => {
    try {
      // Validate handler is parseable as function expression
      new Function("return " + form.handler)();
      // Validate paramSchema
      if (form.paramSchema && form.paramSchema.properties) {
        Object.entries(form.paramSchema.properties).forEach(([name, prop]) => {
          if (!prop.type) throw new Error(`Parameter "${name}" missing type`);
        });
      }
      message.success(t("validation_ok"));
    } catch (err: any) {
      message.error(t("validation_error") + ": " + err.message);
    }
  };

  const handleExport = () => {
    const blob = new Blob([JSON.stringify(formToApiPayload(form), null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${form.name || "skill"}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleImport = (file: UploadFile) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const parsed = JSON.parse(e.target?.result as string);
        setForm({
          name: parsed.name || "",
          description: parsed.description || "",
          version: parsed.version || "1.0.0",
          tags: parsed.tags || [],
          visible: parsed.visible ?? true,
          autonomy: parsed.autonomy || "MANUAL",
          dependencies: parsed.dependencies || [],
          timeout: parsed.timeout || 30000,
          paramSchema: parsed.paramSchema || { properties: {}, required: [] },
          handler: parsed.handler || DEFAULT_FORM.handler,
          icon: parsed.icon || "⚡",
        });
        setIsEditing(false);
        setSelectedSkill(null);
        message.success(t("success"));
      } catch {
        message.error(t("invalid_json"));
      }
    };
    reader.readAsText(file.originFileObj!);
    return false;
  };

  const tabItems = [
    {
      key: "basic",
      label: t("basic_info"),
      children: (
        <BasicInfoTab
          value={form}
          onChange={(v) => setForm((prev) => ({ ...prev, ...v }))}
          existingSkillNames={existingNames}
          isEditing={isEditing}
        />
      ),
    },
    {
      key: "parameters",
      label: t("parameters_tab"),
      children: (
        <ParametersTab
          value={form.paramSchema}
          onChange={(paramSchema) => setForm((prev) => ({ ...prev, paramSchema }))}
        />
      ),
    },
    {
      key: "handler",
      label: t("handler_tab"),
      children: (
        <HandlerTab
          value={form.handler}
          onChange={(handler) => setForm((prev) => ({ ...prev, handler }))}
        />
      ),
    },
    {
      key: "test",
      label: t("test_tab"),
      children: <TestTab skillName={form.name} paramSchema={form.paramSchema} />,
    },
  ];

  return (
    <Flex gap={16} style={{ height: "calc(100vh - 112px)" }}>
      <SkillEditorSidebar
        skills={skills}
        selected={selectedSkill}
        onSelect={handleSelect}
        onNew={handleNew}
        loading={loading}
      />

      <Flex vertical flex={1} gap={12} style={{ overflow: "hidden" }}>
        {/* Toolbar */}
        <Card size="small" bodyStyle={{ padding: "8px 12px" }}>
          <Flex align="center" justify="space-between" wrap="wrap" gap={8}>
            <Space wrap>
              <Button
                type="primary"
                icon={<PlusOutlined />}
                size="small"
                onClick={handleNew}
              >
                {t("new_skill")}
              </Button>
              <Button
                type="primary"
                icon={<SaveOutlined />}
                size="small"
                onClick={handleSave}
              >
                {t("save")}
              </Button>
              <Button icon={<CopyOutlined />} size="small" onClick={handleSaveAs}>
                {t("save_as")}
              </Button>
              <Button icon={<CopyOutlined />} size="small" onClick={handleDuplicate}>
                {t("duplicate")}
              </Button>
              <Button
                danger
                icon={<DeleteOutlined />}
                size="small"
                onClick={handleDelete}
                disabled={!form.name}
              >
                {t("delete")}
              </Button>
            </Space>

            <Space wrap>
              <Button
                icon={<CheckCircleOutlined />}
                size="small"
                onClick={handleValidate}
              >
                {t("validate")}
              </Button>
              <Upload
                accept=".json"
                showUploadList={false}
                beforeUpload={handleImport}
              >
                <Button icon={<ImportOutlined />} size="small">
                  {t("import_json")}
                </Button>
              </Upload>
              <Button
                icon={<ExportOutlined />}
                size="small"
                onClick={handleExport}
              >
                {t("export_json")}
              </Button>
              <Button
                type={helpCollapsed ? "default" : "primary"}
                icon={<QuestionCircleOutlined />}
                size="small"
                onClick={() => setHelpCollapsed((v) => !v)}
              >
                {t("help")}
              </Button>
            </Space>
          </Flex>
        </Card>

        {/* Tabs */}
        <Card
          size="small"
          className="glass-card"
          style={{ flex: 1, overflow: "hidden", display: "flex", flexDirection: "column" }}
          styles={{ body: { flex: 1, overflow: "auto", padding: 12 } }}
          title={
            <Flex align="center" gap={8}>
              <span>{isEditing ? t("edit") : t("create")}</span>
              {form.name && (
                <Text strong style={{ fontSize: 14 }}>
                  {form.icon} {form.name}
                </Text>
              )}
            </Flex>
          }
        >
          <Tabs
            activeKey={activeTab}
            onChange={setActiveTab}
            items={tabItems}
            size="small"
            style={{ height: "100%" }}
          />
        </Card>
      </Flex>

      <HelpPanel collapsed={helpCollapsed} />

      <Modal
        title={t("save_as")}
        open={saveAsOpen}
        onOk={handleConfirmSaveAs}
        onCancel={() => setSaveAsOpen(false)}
        okText={t("save")}
        cancelText={t("cancel")}
      >
        <Input
          placeholder={t("name")}
          value={saveAsName}
          onChange={(e) => setSaveAsName(e.target.value)}
          onPressEnter={handleConfirmSaveAs}
          autoFocus
        />
      </Modal>
    </Flex>
  );
}
