/**
 * Form Designer - Canvas (Center Area)
 */

import React, { useState, useCallback } from "react";
import { Form, Col, theme, Empty, Tooltip, Button } from "antd";
import {
  DeleteOutlined,
  ArrowUpOutlined,
  ArrowDownOutlined,
  DragOutlined,
  EyeOutlined,
} from "@ant-design/icons";
import { getComponent, getComponentMeta } from "@/components/form-engine/registry/componentRegistry";
import { registerComponent } from "@/components/form-engine/registry/componentRegistry";
import type { RaosFieldSchema } from "@/components/form-engine/types";
import { useDesigner } from "./DesignerContext";


// ─── Simple layout components for designer ───

const DividerWidget: React.FC<any> = () => {
  const { token } = theme.useToken();
  return <div style={{ borderTop: `1px solid ${token.colorBorderSecondary}`, margin: "16px 0" }} />;
};

const SectionHeaderWidget: React.FC<any> = ({ schema }) => {
  const { token } = theme.useToken();
  return (
    <div
      style={{
        fontSize: 16,
        fontWeight: 600,
        padding: "16px 0 8px",
        borderBottom: `1px solid ${token.colorBorderSecondary}`,
        marginBottom: 8,
        color: token.colorTextHeading,
      }}
    >
      {schema.title || "区块标题"}
    </div>
  );
};

// Register layout widgets locally (won't affect global registry if already registered)
try {
  registerComponent("divider", DividerWidget, { name: "divider", displayName: "Divider", category: "layout" });
} catch {
  // already registered
}
try {
  registerComponent("sectionHeader", SectionHeaderWidget, { name: "sectionHeader", displayName: "Section Header", category: "layout" });
} catch {
  // already registered
}

// ─── Field Design Wrapper ───

interface DesignFieldWrapperProps {
  fieldKey: string;
  schema: RaosFieldSchema;
  isSelected: boolean;
  isFirst: boolean;
  isLast: boolean;
  onSelect: () => void;
  onRemove: () => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
  onDragStart: (e: React.DragEvent, key: string) => void;
  onDragOver: (e: React.DragEvent, key: string) => void;
  onDrop: (e: React.DragEvent, key: string) => void;
  dragOverKey: string | null;
}

const DesignFieldWrapper: React.FC<DesignFieldWrapperProps> = ({
  fieldKey,
  schema,
  isSelected,
  isFirst,
  isLast,
  onSelect,
  onRemove,
  onMoveUp,
  onMoveDown,
  onDragStart,
  onDragOver,
  onDrop,
  dragOverKey,
}) => {
  const { token } = theme.useToken();
  const [isHovered, setIsHovered] = useState(false);
  const widgetName = schema["ui:widget"] || "input";

  let Component: React.FC<any> | undefined;
  try {
    Component = getComponent(widgetName);
  } catch {
    Component = undefined;
  }

  const isLayout = widgetName === "divider" || widgetName === "sectionHeader";
  const showActions = isHovered || isSelected;

  return (
    <div
      draggable={!isLayout}
      onDragStart={(e) => onDragStart(e, fieldKey)}
      onDragOver={(e) => onDragOver(e, fieldKey)}
      onDrop={(e) => onDrop(e, fieldKey)}
      onClick={(e) => {
        e.stopPropagation();
        onSelect();
      }}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      style={{
        position: "relative",
        borderRadius: token.borderRadius,
        border: `2px solid ${
          isSelected
            ? token.colorPrimary
            : dragOverKey === fieldKey
            ? token.colorPrimaryBorderHover
            : "transparent"
        }`,
        background: isSelected ? token.colorPrimaryBg : "transparent",
        transition: "all 0.2s",
        padding: isLayout ? 0 : "8px 12px",
        marginBottom: 4,
        cursor: isLayout ? "default" : "move",
      }}
    >
      {/* Hover action bar */}
      {showActions && (
        <div
          style={{
            position: "absolute",
            top: -12,
            right: 8,
            display: "flex",
            gap: 4,
            zIndex: 10,
            background: token.colorBgContainer,
            borderRadius: token.borderRadiusSM,
            boxShadow: `0 2px 8px rgba(0,0,0,0.15)`,
            padding: "2px 4px",
          }}
        >
          {!isFirst && !isLayout && (
            <Tooltip title="上移">
              <Button type="text" size="small" icon={<ArrowUpOutlined />} onClick={(e) => { e.stopPropagation(); onMoveUp(); }} />
            </Tooltip>
          )}
          {!isLast && !isLayout && (
            <Tooltip title="下移">
              <Button type="text" size="small" icon={<ArrowDownOutlined />} onClick={(e) => { e.stopPropagation(); onMoveDown(); }} />
            </Tooltip>
          )}
          {!isLayout && (
            <Tooltip title="拖动">
              <Button type="text" size="small" icon={<DragOutlined />} style={{ cursor: "grab" }} />
            </Tooltip>
          )}
          <Tooltip title="删除">
            <Button type="text" size="small" danger icon={<DeleteOutlined />} onClick={(e) => { e.stopPropagation(); onRemove(); }} />
          </Tooltip>
        </div>
      )}

      {/* Field label (design mode) */}
      {!isLayout && (
        <div
          style={{
            fontSize: 12,
            color: token.colorTextSecondary,
            marginBottom: 4,
            display: "flex",
            alignItems: "center",
            gap: 4,
          }}
        >
          <span>
            {schema.title || fieldKey}
            {schema.required && <span style={{ color: token.colorError }}>*</span>}
          </span>
          <span style={{ fontSize: 11, opacity: 0.6 }}>({fieldKey})</span>
        </div>
      )}

      {/* Component preview */}
      {Component ? (
        <div style={{ pointerEvents: "none" }}>
          <Form.Item style={{ marginBottom: 0 }}>
            <Component
              schema={schema}
              name={fieldKey}
              value={undefined}
              onChange={() => {}}
              onBlur={() => {}}
              formData={{}}
              fieldState={{ visible: true, disabled: true, readonly: true, required: !!schema.required }}
              readOnly={true}
              disabled={true}
            />
          </Form.Item>
        </div>
      ) : (
        <div style={{ color: token.colorError, padding: 8, fontSize: 13 }}>
          未知组件: {widgetName}
        </div>
      )}
    </div>
  );
};

// ─── Canvas ───

export const DesignerCanvas: React.FC = () => {
  const { state, selectField, removeField, moveField, addField, reorderFields } = useDesigner();
  const { token } = theme.useToken();
  const [dragOverKey, setDragOverKey] = useState<string | null>(null);
  const [draggedKey, setDraggedKey] = useState<string | null>(null);

  const fieldEntries = Object.entries(state.schema.properties);

  const handleDragStart = useCallback((e: React.DragEvent, key: string) => {
    setDraggedKey(key);
    e.dataTransfer.setData("fieldType", "");
    e.dataTransfer.effectAllowed = "move";
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent, key: string) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    if (draggedKey && draggedKey !== key) {
      setDragOverKey(key);
    }
  }, [draggedKey]);

  const handleDrop = useCallback(
    (e: React.DragEvent, targetKey: string) => {
      e.preventDefault();
      const fieldType = e.dataTransfer.getData("fieldType");

      if (fieldType) {
        // Dropping from palette
        const targetIndex = fieldEntries.findIndex(([k]) => k === targetKey);
        addField(fieldType, targetIndex + 1);
      } else if (draggedKey && draggedKey !== targetKey) {
        // Reordering within canvas
        const fromIndex = fieldEntries.findIndex(([k]) => k === draggedKey);
        const toIndex = fieldEntries.findIndex(([k]) => k === targetKey);
        if (fromIndex !== -1 && toIndex !== -1) {
          const entries = [...fieldEntries];
          const [removed] = entries.splice(fromIndex, 1);
          entries.splice(toIndex, 0, removed);
          reorderFields(entries.map(([k]) => k));
        }
      }

      setDragOverKey(null);
      setDraggedKey(null);
    },
    [draggedKey, fieldEntries, addField]
  );

  const handleCanvasDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      const fieldType = e.dataTransfer.getData("fieldType");
      if (fieldType) {
        addField(fieldType);
      }
      setDragOverKey(null);
      setDraggedKey(null);
    },
    [addField]
  );

  const handleCanvasDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "copy";
  }, []);

  if (fieldEntries.length === 0) {
    return (
      <div
        style={{
          flex: 1,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: token.colorBgLayout,
          borderRadius: token.borderRadiusLG,
          margin: 16,
        }}
        onDrop={handleCanvasDrop}
        onDragOver={handleCanvasDragOver}
      >
        <Empty
          description="从左侧拖拽组件到此处"
          image={Empty.PRESENTED_IMAGE_SIMPLE}
        />
      </div>
    );
  }

  return (
    <div
      style={{
        flex: 1,
        overflowY: "auto",
        padding: 16,
        background: token.colorBgLayout,
      }}
      onDrop={handleCanvasDrop}
      onDragOver={handleCanvasDragOver}
      onClick={() => selectField(null)}
    >
      <div
        style={{
          background: token.colorBgContainer,
          borderRadius: token.borderRadiusLG,
          padding: 24,
          minHeight: "100%",
          boxShadow: `0 1px 2px rgba(0,0,0,0.06)`,
        }}
      >
        <div
          style={{
            fontSize: 18,
            fontWeight: 600,
            marginBottom: 24,
            textAlign: "center",
            color: token.colorTextHeading,
          }}
        >
          {state.schema.title || state.formMeta.name || "未命名表单"}
        </div>

        <Form layout={state.schema.layout?.type === "horizontal" ? "horizontal" : "vertical"}>
          {fieldEntries.map(([key, schema], index) => (
            <DesignFieldWrapper
              key={key}
              fieldKey={key}
              schema={schema}
              isSelected={state.selectedFieldKey === key}
              isFirst={index === 0}
              isLast={index === fieldEntries.length - 1}
              onSelect={() => selectField(key)}
              onRemove={() => removeField(key)}
              onMoveUp={() => moveField(key, "up")}
              onMoveDown={() => moveField(key, "down")}
              onDragStart={handleDragStart}
              onDragOver={handleDragOver}
              onDrop={handleDrop}
              dragOverKey={dragOverKey}
            />
          ))}
        </Form>
      </div>
    </div>
  );
};
