/**
 * Form Designer - Component Palette (Left Sidebar)
 */

import React from "react";
import { Card, Space, Tag, theme } from "antd";
import * as Icons from "@ant-design/icons";
import { FIELD_CATEGORIES, FIELD_TEMPLATES, WIDGET_ICONS } from "./constants";
import { useDesigner } from "./DesignerContext";

const PaletteItem: React.FC<{
  type: string;
  label: string;
  icon: string;
  onDragStart: (e: React.DragEvent, type: string) => void;
  onClick: () => void;
}> = ({ type, label, icon, onDragStart, onClick }) => {
  const { token } = theme.useToken();
  const IconComponent = ((Icons as unknown) as Record<string, React.FC<any>>)[icon] || Icons.QuestionCircleOutlined;

  return (
    <div
      draggable
      onDragStart={(e) => onDragStart(e, type)}
      onClick={onClick}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 8,
        padding: "8px 12px",
        borderRadius: token.borderRadius,
        border: `1px solid ${token.colorBorderSecondary}`,
        background: token.colorBgContainer,
        cursor: "grab",
        transition: "all 0.2s",
        userSelect: "none",
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.borderColor = token.colorPrimaryBorder;
        e.currentTarget.style.boxShadow = `0 2px 8px ${token.colorPrimaryBorderHover ?? "rgba(0,0,0,0.1)"}`;
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.borderColor = token.colorBorderSecondary;
        e.currentTarget.style.boxShadow = "none";
      }}
    >
      <IconComponent style={{ color: token.colorPrimary, fontSize: 16 }} />
      <span style={{ fontSize: 13, flex: 1 }}>{label}</span>
    </div>
  );
};

export const ComponentPalette: React.FC = () => {
  const { addField } = useDesigner();
  const { token } = theme.useToken();

  const handleDragStart = (e: React.DragEvent, type: string) => {
    e.dataTransfer.setData("fieldType", type);
    e.dataTransfer.effectAllowed = "copy";
  };

  return (
    <div
      style={{
        width: 220,
        flexShrink: 0,
        borderRight: `1px solid ${token.colorBorderSecondary}`,
        background: token.colorBgElevated,
        overflowY: "auto",
        height: "100%",
        padding: "16px 12px",
      }}
    >
      <Space direction="vertical" size="middle" style={{ width: "100%" }}>
        {FIELD_CATEGORIES.map((category) => {
          const items = FIELD_TEMPLATES.filter((t) => t.category === category.key);
          if (items.length === 0) return null;

          const CategoryIcon = ((Icons as unknown) as Record<string, React.FC<any>>)[category.icon] || Icons.AppstoreOutlined;

          return (
            <div key={category.key}>
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 6,
                  marginBottom: 10,
                  fontSize: 13,
                  fontWeight: 600,
                  color: token.colorTextSecondary,
                }}
              >
                <CategoryIcon />
                {category.label}
              </div>
              <Space direction="vertical" size="small" style={{ width: "100%" }}>
                {items.map((item) => (
                  <PaletteItem
                    key={item.type}
                    type={item.type}
                    label={item.label}
                    icon={item.icon}
                    onDragStart={handleDragStart}
                    onClick={() => addField(item.type)}
                  />
                ))}
              </Space>
            </div>
          );
        })}
      </Space>
    </div>
  );
};
