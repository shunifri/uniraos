import React from "react";
import { Checkbox, Tag } from "antd";
import type { FieldRendererProps } from "../registry/componentRegistry.js";

export const CheckboxGroup: React.FC<FieldRendererProps> = ({
  schema,
  value,
  onChange,
  fieldState,
}) => {
  const options = fieldState.options || schema["x-dataSource"]?.options || [];
  const variant = schema["ui:props"]?.variant || "default";
  const currentValue: (string | number)[] = value || [];

  if (variant === "tag") {
    return (
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
        {options.map((opt) => {
          const isChecked = currentValue.includes(opt.value);
          return (
            <Tag.CheckableTag
              key={String(opt.value)}
              checked={isChecked}
              onChange={(checked) => {
                const next = checked
                  ? [...currentValue, opt.value]
                  : currentValue.filter((v) => v !== opt.value);
                onChange(next);
              }}
              disabled={fieldState.disabled || opt.disabled}
            >
              {opt.label}
            </Tag.CheckableTag>
          );
        })}
      </div>
    );
  }

  return (
    <Checkbox.Group
      value={currentValue}
      onChange={(val) => onChange(val)}
      disabled={fieldState.disabled}
      options={options.map((opt) => ({
        label: opt.label,
        value: opt.value,
        disabled: opt.disabled,
      }))}
    />
  );
};
