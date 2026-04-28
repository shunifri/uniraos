import React from "react";
import { Select, theme } from "antd";
import type { FieldRendererProps } from "../registry/componentRegistry.js";

const chipStyle = (
  token: any,
  isSelected: boolean,
  isDisabled?: boolean
): React.CSSProperties => ({
  padding: `${token.paddingXS + 2}px ${token.paddingSM + 6}px`,
  borderRadius: token.borderRadiusSM * 5,
  fontSize: token.fontSize,
  fontWeight: token.fontWeightStrong ?? 500,
  cursor: isDisabled ? "default" : "pointer",
  opacity: isDisabled ? 0.6 : 1,
  transition: "all 0.25s cubic-bezier(0.4, 0, 0.2, 1)",
  background: isSelected ? token.colorPrimary : token.colorFillTertiary,
  color: isSelected ? "#fff" : token.colorText,
  border: `1px solid ${isSelected ? "transparent" : token.colorBorderSecondary}`,
  boxShadow: isSelected ? `0 2px 8px ${token.colorPrimaryBorderHover ?? token.colorPrimary}` : "none",
  whiteSpace: "nowrap" as const,
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  userSelect: "none",
});

export const SelectInput: React.FC<FieldRendererProps> = ({
  schema,
  value,
  onChange,
  fieldState,
  readOnly,
}) => {
  const options = fieldState.options || schema["x-dataSource"]?.options || [];
  const isDisabled = fieldState.disabled || readOnly;
  const variant = schema["ui:props"]?.variant || "segmented";
  const { token } = theme.useToken();

  // dropdown: 原生 Antd Select
  if (variant === "dropdown") {
    return (
      <Select
        value={value}
        onChange={onChange}
        disabled={isDisabled}
        placeholder={schema["ui:placeholder"] || "请选择"}
        style={{ width: "100%" }}
        options={options.map((opt: any) => ({ label: opt.label, value: opt.value }))}
        allowClear
      />
    );
  }

  // segmented / tag / default: chip 样式（保持向后兼容）
  return (
    <div style={{ display: "flex", gap: token.paddingXS, flexWrap: "wrap" }}>
      {options.map((opt: any) => {
        const isSelected = value === opt.value;
        return (
          <div
            key={String(opt.value)}
            onClick={() => {
              if (isDisabled) return;
              onChange(opt.value);
            }}
            style={chipStyle(token, isSelected, isDisabled)}
            onMouseEnter={(e) => {
              if (isDisabled || isSelected) return;
              e.currentTarget.style.background = token.colorFillSecondary;
              e.currentTarget.style.borderColor = token.colorPrimaryBorder;
            }}
            onMouseLeave={(e) => {
              if (isDisabled || isSelected) return;
              e.currentTarget.style.background = token.colorFillTertiary;
              e.currentTarget.style.borderColor = token.colorBorderSecondary;
            }}
          >
            {opt.label}
          </div>
        );
      })}
    </div>
  );
};
