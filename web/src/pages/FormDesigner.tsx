/**
 * Form Designer Page
 */

import React, { useEffect, useState, useCallback } from "react";
import { useParams, useNavigate, useSearchParams } from "react-router-dom";
import { message, Spin, Modal } from "antd";
import {
  DesignerProvider,
  useDesigner,
  ComponentPalette,
  DesignerCanvas,
  PropertiesPanel,
  DesignerToolbar,
  JsonEditor,
  PreviewModal,
} from "@/components/form-designer";
import type { RaosFormSchema } from "@/components/form-engine/types";
import { api } from "@/api";

// ---------------------------------------------------------------------------
// Form API helpers
// ---------------------------------------------------------------------------

interface FormDefinition {
  id: string;
  key: string;
  name: string;
  description?: string;
  schema_json: RaosFormSchema;
}

async function fetchFormDefinition(id: string): Promise<FormDefinition | null> {
  try {
    const res = await api.get<{ success: boolean; data: FormDefinition }>(`/api/form/definitions/${id}`);
    return res.success ? res.data : null;
  } catch {
    return null;
  }
}

async function createFormDefinition(payload: {
  key: string;
  name: string;
  description?: string;
  schemaJson: RaosFormSchema;
}): Promise<{ success: boolean; data?: { id: string }; error?: string }> {
  try {
    const res = await api.post<{ success: boolean; data?: { id: string }; error?: string }>(
      "/api/form/definitions",
      payload
    );
    return res;
  } catch (err: any) {
    return { success: false, error: err.message };
  }
}

async function updateFormDefinition(
  id: string,
  payload: { key: string; name: string; description?: string; schemaJson: RaosFormSchema }
): Promise<{ success: boolean; error?: string }> {
  try {
    const res = await api.put<{ success: boolean; error?: string }>(`/api/form/definitions/${id}`, payload);
    return res;
  } catch (err: any) {
    return { success: false, error: err.message };
  }
}

// ---------------------------------------------------------------------------
// Inner Designer Page
// ---------------------------------------------------------------------------

const FormDesignerInner: React.FC = () => {
  const { state, newForm, loadForm, setFormMeta, dispatch } = useDesigner();
  const { id } = useParams<{ id?: string }>();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const keyParam = searchParams.get("key");

  const [previewOpen, setPreviewOpen] = useState(false);
  const [jsonOpen, setJsonOpen] = useState(false);
  const [loading, setLoading] = useState(false);

  // Load existing form if editing (by id or key)
  useEffect(() => {
    const formId = id || keyParam;
    if (formId) {
      setLoading(true);
      fetchFormDefinition(formId)
        .then((def) => {
          if (def) {
            loadForm(def.schema_json, {
              key: def.key,
              name: def.name,
              description: def.description || "",
            });
          } else {
            message.error("加载表单失败");
            navigate("/forms");
          }
        })
        .finally(() => setLoading(false));
    } else {
      newForm();
    }
  }, [id, keyParam]);

  const handleSave = useCallback(async () => {
    if (!state.formMeta.key.trim()) {
      message.error("请输入表单标识");
      return;
    }
    if (!state.formMeta.name.trim()) {
      message.error("请输入表单名称");
      return;
    }

    const schema: RaosFormSchema = {
      ...state.schema,
      title: state.formMeta.name,
      description: state.formMeta.description,
    };

    dispatch({ type: "SET_LOADING", isLoading: true });

    try {
      if (id) {
        const res = await updateFormDefinition(id, {
          key: state.formMeta.key,
          name: state.formMeta.name,
          description: state.formMeta.description,
          schemaJson: schema,
        });
        if (res.success) {
          message.success("更新成功");
          dispatch({ type: "SET_DIRTY", isDirty: false });
        } else {
          message.error(res.error || "更新失败");
        }
      } else {
        const res = await createFormDefinition({
          key: state.formMeta.key,
          name: state.formMeta.name,
          description: state.formMeta.description,
          schemaJson: schema,
        });
        if (res.success) {
          message.success("创建成功");
          dispatch({ type: "SET_DIRTY", isDirty: false });
          if (res.data?.id) {
            navigate(`/forms/designer/${res.data.id}`, { replace: true });
          }
        } else {
          message.error(res.error || "创建失败");
        }
      }
    } catch (err: any) {
      message.error(err.message || "保存失败");
    } finally {
      dispatch({ type: "SET_LOADING", isLoading: false });
    }
  }, [state, id, navigate, dispatch]);

  const previewSchema: RaosFormSchema = {
    ...state.schema,
    title: state.formMeta.name || state.schema.title,
  };

  if (loading) {
    return (
      <div style={{ display: "flex", justifyContent: "center", alignItems: "center", height: "100%" }}>
        <Spin size="large" />
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "calc(100vh - 80px)", minHeight: 600 }}>
      <DesignerToolbar
        onNew={() => {
          if (state.isDirty) {
            Modal.confirm({
              title: "确认新建",
              content: "当前表单有未保存的更改，确定要新建吗？",
              onOk: () => {
                newForm();
                navigate("/forms/designer", { replace: true });
              },
            });
          } else {
            newForm();
            navigate("/forms/designer", { replace: true });
          }
        }}
        onSave={handleSave}
        onPreview={() => setPreviewOpen(true)}
        onJsonToggle={() => setJsonOpen((v) => !v)}
        jsonOpen={jsonOpen}
      />

      <div style={{ display: "flex", flex: 1, overflow: "hidden" }}>
        <ComponentPalette />
        <DesignerCanvas />
        <PropertiesPanel />
        <JsonEditor open={jsonOpen} />
      </div>

      <PreviewModal
        open={previewOpen}
        schema={previewSchema}
        onClose={() => setPreviewOpen(false)}
      />
    </div>
  );
};

// ---------------------------------------------------------------------------
// Exported Page
// ---------------------------------------------------------------------------

const FormDesignerPage: React.FC = () => {
  return (
    <DesignerProvider>
      <FormDesignerInner />
    </DesignerProvider>
  );
};

export default FormDesignerPage;
