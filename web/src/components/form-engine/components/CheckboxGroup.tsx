import React from "react";
import { Checkbox, theme } from "antd";
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
  color: isSelected ? token.colorTextLightSolid : token.colorText,
  border: `1px solid ${isSelected ? "transparent" : token.colorBorderSecondary}`,
  boxShadow: isSelected ? `0 2px 8px ${token.colorPrimaryBorderHover ?? token.colorPrimary}` : "none",
  whiteSpace: "nowrap" as const,
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  userSelect: "none",
});

export const CheckboxGroup: React.FC<FieldRendererProps> = ({
  schema,
  value,
  onChange,
  fieldState,
  readOnly,
}) => {
  const options = fieldState.options || schema["x-dataSource"]?.options || [];
  const currentValue: (string | number)[] = value || [];
  const isDisabled = fieldState.disabled || readOnly;
  const variant = schema["ui:props"]?.variant || "tag";
  const { token } = theme.useToken();

  // checkbox: 原生 Antd Checkbox.Group
  if (variant === "checkbox") {
    return (
      <Checkbox.Group
        value={currentValue}
        onChange={(checkedValues) => onChange(checkedValues)}
        disabled={isDisabled}
        options={options.map((opt: any) => ({ label: opt.label, value: opt.value }))}
      />
    );
  }

  // tag / default: chip 样式（保持向后兼容）
  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: token.paddingXS }}>
      {options.map((opt: any) => {
        const isChecked = currentValue.includes(opt.value);
        return (
          <div
            key={String(opt.value)}
            onClick={() => {
              if (isDisabled) return;
              const next = isChecked
                ? currentValue.filter((v) => v !== opt.value)
                : [...currentValue, opt.value];
              onChange(next);
            }}
            style={chipStyle(token, isChecked, isDisabled)}
            onMouseEnter={(e) => {
              if (isDisabled || isChecked) return;
              e.currentTarget.style.background = token.colorFillSecondary;
              e.currentTarget.style.borderColor = token.colorPrimaryBorder;
            }}
            onMouseLeave={(e) => {
              if (isDisabled || isChecked) return;
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
