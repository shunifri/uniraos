/**
 * Form Designer - Preview Modal
 */

import React from "react";
import { Modal, Button, Empty, Tabs, message } from "antd";
import { FormRenderer } from "@/components/form-engine";
import type { RaosFormSchema } from "@/components/form-engine/types";

interface PreviewModalProps {
  open: boolean;
  schema: RaosFormSchema | null;
  onClose: () => void;
}

export const PreviewModal: React.FC<PreviewModalProps> = ({ open, schema, onClose }) => {
  const handleSubmit = (data: Record<string, any>) => {
    message.success("表单验证通过（预览模式）");
    // debug: console.log("Preview submit:", data);
  };

  return (
    <Modal
      title="表单预览"
      open={open}
      onCancel={onClose}
      width={900}
      footer={[
        <Button key="close" onClick={onClose}>
          关闭
        </Button>,
      ]}
    >
      {schema ? (
        <Tabs
          defaultActiveKey="preview"
          items={[
            {
              key: "preview",
              label: "预览",
              children: (
                <FormRenderer
                  schema={schema}
                  initialData={{}}
                  onSubmit={handleSubmit}
                />
              ),
            },
            {
              key: "json",
              label: "Schema JSON",
              children: (
                <pre
                  style={{
                    background: "#f5f5f5",
                    padding: 16,
                    borderRadius: 8,
                    overflow: "auto",
                    maxHeight: 500,
                    fontSize: 12,
                  }}
                >
                  {JSON.stringify(schema, null, 2)}
                </pre>
              ),
            },
          ]}
        />
      ) : (
        <Empty description="无法加载表单" />
      )}
    </Modal>
  );
};
