/**
 * Form Designer - JSON Schema Editor
 */

import React, { useState, useEffect } from "react";
import { Input, Button, message, theme } from "antd";
import type { RaosFormSchema } from "@/components/form-engine/types";
import { useDesigner } from "./DesignerContext";

const { TextArea } = Input;

interface JsonEditorProps {
  open: boolean;
}

export const JsonEditor: React.FC<JsonEditorProps> = ({ open }) => {
  const { state, setSchema, setFormMeta } = useDesigner();
  const { token } = theme.useToken();
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const schema: RaosFormSchema = {
      ...state.schema,
      title: state.formMeta.name || state.schema.title,
    };
    setText(JSON.stringify(schema, null, 2));
    setError(null);
  }, [state.schema, state.formMeta.name, open]);

  const handleApply = () => {
    try {
      const schema: RaosFormSchema = JSON.parse(text);
      if (!schema.type || schema.type !== "object") {
        setError("Schema 根类型必须是 object");
        return;
      }
      setSchema(schema);
      if (schema.title) {
        setFormMeta({ name: schema.title });
      }
      message.success("应用成功");
      setError(null);
    } catch (e: any) {
      setError(e.message);
    }
  };

  if (!open) return null;

  return (
    <div
      style={{
        width: 400,
        flexShrink: 0,
        borderLeft: `1px solid ${token.colorBorderSecondary}`,
        background: token.colorBgElevated,
        display: "flex",
        flexDirection: "column",
        height: "100%",
      }}
    >
      <div
        style={{
          padding: "12px 16px",
          borderBottom: `1px solid ${token.colorBorderSecondary}`,
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
        }}
      >
        <span style={{ fontWeight: 600 }}>JSON Schema</span>
        <Button type="primary" size="small" onClick={handleApply}>
          应用
        </Button>
      </div>
      <div style={{ flex: 1, padding: 12, overflow: "hidden" }}>
        <TextArea
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            setError(null);
          }}
          style={{
            width: "100%",
            height: "100%",
            fontFamily: "monospace",
            fontSize: 12,
            resize: "none",
          }}
        />
      </div>
      {error && (
        <div
          style={{
            padding: "8px 16px",
            background: token.colorErrorBg,
            color: token.colorError,
            fontSize: 12,
            borderTop: `1px solid ${token.colorErrorBorder}`,
          }}
        >
          {error}
        </div>
      )}
    </div>
  );
};
